from datetime import date, time, timedelta
from decimal import Decimal
from django.test import TestCase, Client, RequestFactory
from django.urls import reverse
from django.utils import timezone

from accounts.models import User, Profile, ReceptionistDoctorAssignment, AuditLog
from accounts.forms import DoctorRegistrationForm
from bookings.models import Booking
from bookings.services.booking_service import create_appointment
from bookings.services.fee_calculator import calculate_visit_stage_and_fee
from doctors.models import DoctorWeeklySchedule
from payments.models import PaymentTransaction, Receipt, RefundRequest, RefundTransaction
from payments.services.payment_service import (
    initiate_online_payment,
    process_gateway_callback,
    record_chamber_payment_collection,
)
from payments.services.refund_service import (
    create_refund_request,
    review_refund_request,
    approve_refund_request,
    process_approved_refund,
)
from payments.services.session_cancellation_service import cancel_doctor_consultation_session
from complaints.models import Complaint
from complaints.services import submit_complaint, review_complaint
from notifications.models import Notification


class EndToEndHospitalLifecycleTests(TestCase):
    """
    Validates the complete end-to-end lifecycle of Green Hospital:
    1. Doctor registration with BMDC credentials.
    2. Administrative verification & approval.
    3. Doctor schedule creation.
    4. Patient booking (Visit Stage 1 fee calculation & Serial #1 allocation).
    5. Payment processing and verifiable receipt generation.
    6. Front-desk receptionist check-in.
    7. Doctor consultation completion.
    8. Subsequent visit pricing cycle (Stage 2 pricing & Report Check non-advancement).
    9. Cancellation, 24-hour refund calculation, Super Admin approval, and payout.
    10. Patient complaint submission and administrative resolution.
    11. Doctor consultation session cancellation with automated patient refund handling.
    """

    def setUp(self):
        self.client = Client()
        self.factory = RequestFactory()

        # Super Admin
        self.super_admin = User.objects.create_superuser(
            username="dir_green",
            first_name="Hospital",
            last_name="Director",
            email="director@greenhospital.org",
            password="DirectorPassword123!",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Hospital Admin
        self.hospital_admin = User.objects.create_user(
            username="admin_kamal",
            first_name="Kamal",
            last_name="Hossain",
            email="kamal@greenhospital.org",
            password="AdminPassword123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Receptionist
        self.receptionist = User.objects.create_user(
            username="rec_nasrin",
            first_name="Nasrin",
            last_name="Akter",
            email="nasrin@greenhospital.org",
            password="StaffPassword123!",
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )

        # Patient
        self.patient = User.objects.create_user(
            username="patient_kader",
            first_name="Abdul",
            last_name="Kader",
            email="kader@example.com",
            password="PatientPassword123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient.profile.phone = "01712345678"
        self.patient.profile.save()

    def test_complete_hospital_clinical_and_financial_lifecycle(self):
        # ----------------------------------------------------------------------
        # Step 1: Doctor Registration
        # ----------------------------------------------------------------------
        doc_reg_data = {
            "first_name": "Mahmudul",
            "last_name": "Hasan",
            "username": "dr_mahmud",
            "email": "mahmud@greenhospital.org",
            "phone": "+8801722334455",
            "office_phone": "+88029988776",
            "qualifications": "MBBS, FCPS (Cardiology)",
            "department": "Cardiology",
            "specialization": "Interventional Cardiology",
            "bmdc_number": "BMDC-A-98765",
            "password1": "DoctorPass123!",
            "password2": "DoctorPass123!",
        }
        form = DoctorRegistrationForm(data=doc_reg_data)
        self.assertTrue(form.is_valid(), form.errors)
        doctor = form.save()

        # Doctor is created in PENDING_APPROVAL status with unverified BMDC
        self.assertEqual(doctor.status, User.StatusChoices.PENDING_APPROVAL)
        self.assertFalse(doctor.bmdc_verified)
        self.assertFalse(doctor.is_approved_doctor)

        # ----------------------------------------------------------------------
        # Step 2: Administrative Verification and Approval
        # ----------------------------------------------------------------------
        self.client.force_login(self.hospital_admin)

        # Verify BMDC
        verify_url = reverse("admin-doctor-verify-bmdc", kwargs={"pk": doctor.pk})
        self.client.post(verify_url)
        doctor.refresh_from_db()
        self.assertTrue(doctor.bmdc_verified)

        # Approve Doctor
        approve_url = reverse("admin-doctor-approve", kwargs={"pk": doctor.pk})
        self.client.post(approve_url)
        doctor.refresh_from_db()
        self.assertEqual(doctor.status, User.StatusChoices.ACTIVE)
        self.assertTrue(doctor.is_approved_doctor)

        # Configure consultation fee schedule for doctor
        doctor.profile.fee_first_visit = Decimal("1200.00")
        doctor.profile.fee_second_visit = Decimal("900.00")
        doctor.profile.fee_third_visit = Decimal("600.00")
        doctor.profile.fee_report_check = Decimal("300.00")
        doctor.profile.chamber_number = "Chamber 402"
        doctor.profile.save()

        # Assign Receptionist to Doctor
        ReceptionistDoctorAssignment.objects.create(
            receptionist=self.receptionist,
            doctor=doctor,
            assigned_by=self.super_admin,
        )

        # ----------------------------------------------------------------------
        # Step 3: Weekly Schedule Creation
        # ----------------------------------------------------------------------
        target_date_1 = timezone.now().date() + timedelta(days=1)
        schedule = DoctorWeeklySchedule.objects.create(
            doctor=doctor,
            weekday=target_date_1.weekday(),
            session_name="Morning Consultations",
            start_time=time(9, 0),
            end_time=time(13, 0),
            slot_duration=30,
            max_capacity=10,
            chamber_number="Chamber 402",
        )
        self.assertIsNotNone(schedule.id)

        # ----------------------------------------------------------------------
        # Step 4: Patient Books 1st Regular Appointment (Stage 1 Fee & Serial #1)
        # ----------------------------------------------------------------------
        booking_1 = create_appointment(
            doctor=doctor,
            patient=self.patient,
            appointment_date=target_date_1,
            appointment_time=time(9, 30),
            visit_type=Booking.VisitType.REGULAR,
            payment_method=Booking.PaymentMethod.ONLINE,
            actor=self.patient,
        )
        self.assertEqual(booking_1.serial_number, 1)
        self.assertEqual(booking_1.visit_stage, 1)
        self.assertEqual(booking_1.fee_amount, Decimal("1200.00"))
        self.assertEqual(booking_1.payment_status, Booking.PaymentStatus.UNPAID)
        self.assertEqual(booking_1.status, Booking.StatusChoices.PENDING)

        # ----------------------------------------------------------------------
        # Step 5: Online Payment via Gateway / Mock Service
        # ----------------------------------------------------------------------
        request = self.factory.get("/")
        request.user = self.patient
        init_res = initiate_online_payment(booking_1, request=request, provider="mock")
        self.assertTrue(init_res.success)

        tx1 = PaymentTransaction.objects.get(booking=booking_1)
        self.assertEqual(tx1.status, PaymentTransaction.Status.PENDING)

        # Simulate verified gateway callback
        callback_payload = {
            "status": "VALID",
            "val_id": "MOCK-VAL-001",
            "tran_id": tx1.transaction_reference,
            "amount": "1200.00",
            "currency": "BDT",
            "card_type": "VISA-Mock",
            "bank_tran_id": "BANK-TRX-101",
        }
        success, tx1, receipt1, msg = process_gateway_callback(
            tran_id=tx1.transaction_reference,
            val_id="MOCK-VAL-001",
            raw_post_data=callback_payload,
            provider="mock",
        )
        self.assertTrue(success)
        self.assertEqual(tx1.status, PaymentTransaction.Status.SUCCESS)

        booking_1.refresh_from_db()
        self.assertEqual(booking_1.payment_status, Booking.PaymentStatus.PAID)
        self.assertEqual(booking_1.status, Booking.StatusChoices.CONFIRMED)
        self.assertIsNotNone(receipt1)
        self.assertEqual(receipt1.collected_amount, Decimal("1200.00"))

        # ----------------------------------------------------------------------
        # Step 6: Receptionist Check-In
        # ----------------------------------------------------------------------
        self.client.force_login(self.receptionist)
        check_in_url = reverse("accounts:receptionist-check-in", kwargs={"pk": booking_1.pk})
        resp_check_in = self.client.post(check_in_url)
        self.assertEqual(resp_check_in.status_code, 302)

        booking_1.refresh_from_db()
        self.assertEqual(booking_1.status, Booking.StatusChoices.CHECKED_IN)
        self.assertIsNotNone(booking_1.checked_in_at)

        # ----------------------------------------------------------------------
        # Step 7: Doctor Completes Consultation
        # ----------------------------------------------------------------------
        booking_1.transition_to(
            Booking.StatusChoices.COMPLETED,
            actor=doctor,
            reason="Consultation and prescription finished.",
        )
        booking_1.refresh_from_db()
        self.assertEqual(booking_1.status, Booking.StatusChoices.COMPLETED)
        self.assertIsNotNone(booking_1.completed_at)

        # ----------------------------------------------------------------------
        # Step 8: Subsequent Visit Pricing Cycle (Stage 2 Fee & Report Check)
        # ----------------------------------------------------------------------
        # Next regular visit should deterministically calculate Stage 2 (900 BDT)
        next_regular = calculate_visit_stage_and_fee(
            patient=self.patient,
            doctor=doctor,
            visit_type=Booking.VisitType.REGULAR,
        )
        self.assertEqual(next_regular["visit_stage"], 2)
        self.assertEqual(next_regular["fee_amount"], Decimal("900.00"))

        # Report check fee should be 300 BDT and not advance the stage
        report_check = calculate_visit_stage_and_fee(
            patient=self.patient,
            doctor=doctor,
            visit_type=Booking.VisitType.REPORT_CHECK,
        )
        self.assertEqual(report_check["fee_amount"], Decimal("300.00"))
        self.assertIsNone(report_check["visit_stage"])

        # ----------------------------------------------------------------------
        # Step 9: Cancellation & Strict Financial Refund Workflow
        # ----------------------------------------------------------------------
        # Patient books appointment 2 for 2 days in the future
        target_date_2 = timezone.now().date() + timedelta(days=2)
        schedule2 = DoctorWeeklySchedule.objects.create(
            doctor=doctor,
            weekday=target_date_2.weekday(),
            session_name="Afternoon Consultations",
            start_time=time(14, 0),
            end_time=time(18, 0),
            slot_duration=30,
            max_capacity=10,
            chamber_number="Chamber 402",
        )
        booking_2 = create_appointment(
            doctor=doctor,
            patient=self.patient,
            appointment_date=target_date_2,
            appointment_time=time(14, 30),
            visit_type=Booking.VisitType.REGULAR,
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patient,
        )
        self.assertEqual(booking_2.fee_amount, Decimal("900.00"))

        # Pay at chamber by receptionist
        record_chamber_payment_collection(
            booking=booking_2,
            collected_by=self.receptionist,
            amount=Decimal("900.00"),
            method="cash",
        )
        booking_2.refresh_from_db()
        self.assertEqual(booking_2.payment_status, Booking.PaymentStatus.PAID)

        # Patient cancels > 24 hours prior
        booking_2.transition_to(
            Booking.StatusChoices.CANCELLED,
            actor=self.patient,
            reason="Patient personal conflict",
        )

        # Create refund request (100% eligibility since > 24h before start)
        refund_req = create_refund_request(
            booking=booking_2,
            patient=self.patient,
            reason="Cancelled 48 hours prior",
            cancellation_type="patient",
            current_time=timezone.now(),
            actor=self.patient,
        )
        self.assertIsNotNone(refund_req)
        self.assertEqual(refund_req.eligible_refund_percentage, 100)
        self.assertEqual(refund_req.requested_amount, Decimal("900.00"))
        self.assertEqual(refund_req.status, RefundRequest.Status.REQUESTED)

        # Hospital Admin reviews and forwards
        review_refund_request(refund_req, reviewed_by=self.hospital_admin, review_notes="Verified timely cancellation.")
        refund_req.refresh_from_db()
        self.assertEqual(refund_req.status, RefundRequest.Status.UNDER_REVIEW)

        # Super Admin approves refund
        approve_refund_request(refund_req, approved_by=self.super_admin, approval_notes="Approved 100% refund.")
        refund_req.refresh_from_db()
        self.assertEqual(refund_req.status, RefundRequest.Status.APPROVED)

        # Execute refund payout
        success, refund_req, msg = process_approved_refund(
            refund_req,
            processed_by=self.super_admin,
            manual_reference="VOUCHER-CHAMBER-900",
            repayment_method="cash",
            notes="Chamber cash payout completed.",
        )
        self.assertTrue(success)
        refund_req.refresh_from_db()
        self.assertEqual(refund_req.status, RefundRequest.Status.SUCCEEDED)

        # ----------------------------------------------------------------------
        # Step 10: Patient Complaint and Administrative Review
        # ----------------------------------------------------------------------
        complaint = submit_complaint(
            patient=self.patient,
            doctor=doctor,
            category=Complaint.CategoryChoices.CHAMBER_CLEANLINESS,
            subject="Waiting area hygiene",
            description="The waiting room outside Chamber 402 needed sanitation.",
            booking=booking_1,
        )
        self.assertEqual(complaint.status, Complaint.StatusChoices.SUBMITTED)

        # Hospital Admin reviews and responds to patient
        review_complaint(
            complaint=complaint,
            admin_user=self.hospital_admin,
            new_status=Complaint.StatusChoices.RESOLVED,
            admin_notes="Instructed housekeeping team on regular 30-min sanitization rounds.",
            admin_response="Thank you for bringing this to our attention. Sanitization protocols have been escalated.",
        )
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.StatusChoices.RESOLVED)
        self.assertIn("Sanitization protocols", complaint.admin_response)

        # ----------------------------------------------------------------------
        # Step 11: Doctor Consultation Session Cancellation
        # ----------------------------------------------------------------------
        target_date_3 = timezone.now().date() + timedelta(days=1)
        schedule3 = DoctorWeeklySchedule.objects.create(
            doctor=doctor,
            weekday=target_date_3.weekday(),
            session_name="Evening Shift",
            start_time=time(18, 0),
            end_time=time(21, 0),
            slot_duration=30,
            max_capacity=5,
            chamber_number="Chamber 402",
        )
        booking_3 = create_appointment(
            doctor=doctor,
            patient=self.patient,
            appointment_date=target_date_3,
            appointment_time=time(18, 30),
            visit_type=Booking.VisitType.REGULAR,
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patient,
        )

        # Doctor cancels entire session
        cancel_result = cancel_doctor_consultation_session(
            doctor=doctor,
            target_date=target_date_3,
            session_name="Evening Shift",
            reason="Called into emergency surgery.",
            actor=doctor,
        )
        self.assertEqual(cancel_result["total_affected"], 1)
        booking_3.refresh_from_db()
        self.assertEqual(booking_3.status, Booking.StatusChoices.CANCELLED)
        self.assertIn("emergency surgery", booking_3.cancellation_reason)
