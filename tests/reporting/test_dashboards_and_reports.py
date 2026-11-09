from datetime import date, time, timedelta
from decimal import Decimal
import csv
import io
from django.test import TestCase, Client
from django.urls import reverse
from django.utils import timezone

from accounts.models import User, Profile, ReceptionistDoctorAssignment
from bookings.models import Booking
from doctors.models import DoctorWeeklySchedule
from doctors.models.schedules import HospitalSetting
from payments.models import PaymentTransaction, Receipt, RefundRequest, RefundTransaction
from complaints.models import Complaint
from complaints.services import submit_complaint


class ReportingAndDashboardTests(TestCase):
    def setUp(self):
        self.client = Client()

        # Super Admin
        self.super_admin = User.objects.create_superuser(
            username="super_director",
            first_name="Hospital",
            last_name="Director",
            email="director@greenhospital.org",
            password="DirectorPass123!",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Hospital Admin
        self.hospital_admin = User.objects.create_user(
            username="hosp_manager",
            first_name="Operation",
            last_name="Manager",
            email="manager@greenhospital.org",
            password="ManagerPass123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Doctor 1
        self.doctor1 = User.objects.create_user(
            username="dr_anwar",
            first_name="Anwar",
            last_name="Hossain",
            email="dr.anwar@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-12345",
            bmdc_verified=True,
        )
        self.doctor1.profile.fee_first_visit = Decimal("1200.00")
        self.doctor1.profile.save()

        # Doctor 2 (Different doctor, not assigned to receptionist)
        self.doctor2 = User.objects.create_user(
            username="dr_shirin",
            first_name="Shirin",
            last_name="Akter",
            email="dr.shirin@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-67890",
            bmdc_verified=True,
        )
        self.doctor2.profile.fee_first_visit = Decimal("800.00")
        self.doctor2.profile.save()

        # Receptionist
        self.receptionist = User.objects.create_user(
            username="reception_roksana",
            first_name="Roksana",
            last_name="Begum",
            email="roksana@greenhospital.org",
            password="StaffPass123!",
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )
        # Assign receptionist strictly to Doctor 1
        ReceptionistDoctorAssignment.objects.create(
            receptionist=self.receptionist,
            doctor=self.doctor1,
            assigned_by=self.super_admin,
        )

        # Patient 1
        self.patient1 = User.objects.create_user(
            username="patient_salim",
            first_name="Salim",
            last_name="Khan",
            email="salim@example.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient1.profile.phone = "01733333333"
        self.patient1.profile.save()

        # Patient 2
        self.patient2 = User.objects.create_user(
            username="patient_mita",
            first_name="Mita",
            last_name="Haque",
            email="mita@example.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient2.profile.phone = "01744444444"
        self.patient2.profile.save()

        # Target dates
        self.today = timezone.now().date()
        self.upcoming = self.today + timedelta(days=2)

        # Weekly schedules
        for doc in (self.doctor1, self.doctor2):
            DoctorWeeklySchedule.objects.create(
                doctor=doc,
                weekday=self.today.weekday(),
                session_name="Morning Consultations",
                start_time=time(9, 0),
                end_time=time(13, 0),
                slot_duration=30,
                max_capacity=10,
            )

        # Booking 1: Doctor 1, Patient 1 (Today, Paid Online)
        self.b1 = Booking.objects.create(
            patient=self.patient1,
            doctor=self.doctor1,
            appointment_date=self.today,
            appointment_time=time(9, 30),
            status=Booking.StatusChoices.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            visit_type=Booking.VisitType.REGULAR,
            fee_amount=Decimal("1200.00"),
            payment_method=Booking.PaymentMethod.ONLINE,
            serial_number=1,
            chamber="Chamber 201",
        )
        self.tx1 = PaymentTransaction.objects.create(
            booking=self.b1,
            patient=self.patient1,
            doctor=self.doctor1,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            status=PaymentTransaction.Status.SUCCESS,
            transaction_reference="TRX-ONL-1200",
        )
        Receipt.objects.create(
            transaction=self.tx1,
            booking=self.b1,
            patient=self.patient1,
            doctor=self.doctor1,
            billed_fee=Decimal("1200.00"),
            collected_amount=Decimal("1200.00"),
            currency="BDT",
            payment_method="online",
            transaction_reference=self.tx1.transaction_reference,
            payment_status="PAID",
        )

        # Booking 2: Doctor 1, Patient 2 (Today, Paid at Chamber)
        self.b2 = Booking.objects.create(
            patient=self.patient2,
            doctor=self.doctor1,
            appointment_date=self.today,
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.CHECKED_IN,
            payment_status=Booking.PaymentStatus.PAID,
            visit_type=Booking.VisitType.REGULAR,
            fee_amount=Decimal("1200.00"),
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            serial_number=2,
            chamber="Chamber 201",
        )
        self.tx2 = PaymentTransaction.objects.create(
            booking=self.b2,
            patient=self.patient2,
            doctor=self.doctor1,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.CASH,
            status=PaymentTransaction.Status.SUCCESS,
            transaction_reference="TRX-CHM-1200",
        )
        Receipt.objects.create(
            transaction=self.tx2,
            booking=self.b2,
            patient=self.patient2,
            doctor=self.doctor1,
            billed_fee=Decimal("1200.00"),
            collected_amount=Decimal("1200.00"),
            currency="BDT",
            payment_method="chamber_cash",
            transaction_reference=self.tx2.transaction_reference,
            payment_status="PAID",
            issued_by=self.receptionist,
        )

        # Booking 3: Doctor 2, Patient 1 (Today, UNPAID chamber booking)
        self.b3 = Booking.objects.create(
            patient=self.patient1,
            doctor=self.doctor2,
            appointment_date=self.today,
            appointment_time=time(11, 0),
            status=Booking.StatusChoices.CONFIRMED,
            payment_status=Booking.PaymentStatus.UNPAID,
            visit_type=Booking.VisitType.REGULAR,
            fee_amount=Decimal("800.00"),
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            serial_number=1,
            chamber="Chamber 305",
        )

        # Booking 4: Cancelled Booking with Refund (Doctor 1, Patient 2)
        self.b4 = Booking.objects.create(
            patient=self.patient2,
            doctor=self.doctor1,
            appointment_date=self.today - timedelta(days=1),
            appointment_time=time(14, 0),
            status=Booking.StatusChoices.CANCELLED,
            payment_status=Booking.PaymentStatus.REFUNDED,
            visit_type=Booking.VisitType.REGULAR,
            fee_amount=Decimal("1200.00"),
            payment_method=Booking.PaymentMethod.ONLINE,
            serial_number=3,
        )
        self.tx4 = PaymentTransaction.objects.create(
            booking=self.b4,
            patient=self.patient2,
            doctor=self.doctor1,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            status=PaymentTransaction.Status.REFUNDED,
            transaction_reference="TRX-REF-1200",
        )
        self.refund_req = RefundRequest.objects.create(
            refund_reference="REF-TEST-0001",
            booking=self.b4,
            payment_transaction=self.tx4,
            patient=self.patient2,
            doctor=self.doctor1,
            original_paid_amount=Decimal("1200.00"),
            eligible_refund_percentage=100,
            eligible_refund_amount=Decimal("1200.00"),
            requested_amount=Decimal("1200.00"),
            refunded_amount=Decimal("1200.00"),
            status=RefundRequest.Status.SUCCEEDED,
            approved_by=self.super_admin,
            approved_at=timezone.now(),
        )
        RefundTransaction.objects.create(
            refund_request=self.refund_req,
            payment_transaction=self.tx4,
            amount=Decimal("1200.00"),
            currency="BDT",
            method="online_reversal",
            status="succeeded",
            reference="RFX-TEST-0001",
            executed_by=self.super_admin,
        )

        # Patient Complaint against Doctor 1
        self.complaint = submit_complaint(
            patient=self.patient1,
            doctor=self.doctor1,
            category=Complaint.CategoryChoices.WAIT_TIME,
            subject="Doctor was late",
            description="Waited over 40 minutes for serial #1.",
            booking=self.b1,
        )

    def test_super_admin_dashboard_metrics(self):
        self.client.force_login(self.super_admin)
        response = self.client.get(reverse("admin-dashboard"))
        self.assertEqual(response.status_code, 200)

        ctx = response.context
        # User counts
        self.assertEqual(ctx["doctors_count"], 2)
        self.assertEqual(ctx["approved_doctors_count"], 2)
        self.assertEqual(ctx["patients_count"], 2)
        self.assertEqual(ctx["receptionists_count"], 1)

        # Appointments
        self.assertEqual(ctx["today_appointments_count"], 3)  # b1, b2, b3
        self.assertEqual(ctx["cancelled_appointments_count"], 1)  # b4

        # Financial totals
        # Total collected: 1200 (tx1) + 1200 (tx2) + 1200 (tx4) = 3600.00
        self.assertEqual(ctx["total_collected"], Decimal("3600.00"))
        # Total refunded: 1200.00
        self.assertEqual(ctx["total_refunded"], Decimal("1200.00"))
        # Net revenue: 3600 - 1200 = 2400.00
        self.assertEqual(ctx["net_revenue"], Decimal("2400.00"))
        # Outstanding unpaid bookings: b3 (800.00)
        self.assertEqual(ctx["unpaid_bookings_count"], 1)
        self.assertEqual(ctx["unpaid_bookings_amount"], Decimal("800.00"))

        # Complaints
        self.assertEqual(ctx["complaint_counts"]["total"], 1)

        # Hospital setting
        self.assertIn("booking_window_hours", ctx)

    def test_hospital_admin_cannot_approve_refund(self):
        # Create pending refund request
        pending_refund = RefundRequest.objects.create(
            refund_reference="REF-PENDING-0002",
            booking=self.b1,
            payment_transaction=self.tx1,
            patient=self.patient1,
            doctor=self.doctor1,
            original_paid_amount=Decimal("1200.00"),
            eligible_refund_percentage=100,
            eligible_refund_amount=Decimal("1200.00"),
            requested_amount=Decimal("1200.00"),
            status=RefundRequest.Status.REQUESTED,
        )

        # Hospital Admin attempts to approve refund -> 403 Forbidden
        self.client.force_login(self.hospital_admin)
        approve_url = reverse(
            "payments:superadmin-refund-approve",
            kwargs={"refund_reference": pending_refund.refund_reference},
        )
        response = self.client.post(approve_url)
        self.assertEqual(response.status_code, 403)

        # Super Admin CAN approve refund
        self.client.force_login(self.super_admin)
        super_resp = self.client.post(approve_url)
        self.assertEqual(super_resp.status_code, 302)
        pending_refund.refresh_from_db()
        self.assertEqual(pending_refund.status, RefundRequest.Status.APPROVED)
        self.assertEqual(pending_refund.approved_by, self.super_admin)

    def test_doctor_reports_data_isolation(self):
        self.client.force_login(self.doctor1)
        response = self.client.get(reverse("doctors:reports"))
        self.assertEqual(response.status_code, 200)

        # Doctor 1 sees their consultations (b1, b2, b4)
        consultations = response.context["consultations"]
        doctor_ids = {a.doctor_id for a in consultations}
        self.assertEqual(doctor_ids, {self.doctor1.id})

        # Test CSV export
        csv_response = self.client.get(reverse("doctors:reports") + "?export=csv")
        self.assertEqual(csv_response.status_code, 200)
        self.assertEqual(csv_response["Content-Type"], "text/csv")
        self.assertIn("attachment; filename=", csv_response["Content-Disposition"])

        content = csv_response.content.decode("utf-8")
        # Doctor 1's appointments should be present
        self.assertIn("Salim Khan", content)
        self.assertIn("Mita Haque", content)
        # Doctor 2's appointments must NOT be present
        self.assertNotIn("dr_shirin", content)

    def test_receptionist_reports_scoped_to_assigned_doctors(self):
        self.client.force_login(self.receptionist)
        response = self.client.get(reverse("accounts:receptionist-reports"))
        self.assertEqual(response.status_code, 200)

        # Assigned doctors list contains ONLY Doctor 1
        assigned_docs = list(response.context["assigned_doctors"])
        self.assertEqual(assigned_docs, [self.doctor1])

        # Appointments listed contain Doctor 1 appointments only
        appointments = response.context["appointments"]
        for a in appointments:
            self.assertEqual(a.doctor, self.doctor1)

        # Test CSV export
        csv_response = self.client.get(reverse("accounts:receptionist-reports") + "?export=csv")
        self.assertEqual(csv_response.status_code, 200)
        self.assertEqual(csv_response["Content-Type"], "text/csv")
        content = csv_response.content.decode("utf-8")
        self.assertIn("Anwar Hossain", content)
        self.assertNotIn("Shirin Akter", content)

    def test_admin_reports_csv_exports(self):
        self.client.force_login(self.super_admin)

        # Appointments CSV report
        appt_csv = self.client.get(reverse("admin-appointment-report") + "?export=csv")
        self.assertEqual(appt_csv.status_code, 200)
        self.assertEqual(appt_csv["Content-Type"], "text/csv")

        # Revenue CSV report
        rev_csv = self.client.get(reverse("admin-revenue-report") + "?export=csv")
        self.assertEqual(rev_csv.status_code, 200)
        self.assertEqual(rev_csv["Content-Type"], "text/csv")

    def test_patient_dashboard_tabs(self):
        self.client.force_login(self.patient1)
        response = self.client.get(reverse("patients:dashboard"))
        self.assertEqual(response.status_code, 200)

        ctx = response.context
        self.assertIn("refund_requests", ctx)
        self.assertIn("complaints", ctx)
        self.assertIn("appointments", ctx)

        # HTML contains Refund Progress and Complaints tabs
        self.assertContains(response, "Refund Progress")
        self.assertContains(response, "Complaints")
