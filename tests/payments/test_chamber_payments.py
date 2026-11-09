from datetime import date, time, timedelta
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from accounts.models import User, Profile, ReceptionistDoctorAssignment, AuditLog
from bookings.models import Booking
from bookings.services.booking_service import create_appointment
from doctors.models import DoctorWeeklySchedule
from payments.models import PaymentTransaction, Receipt
from payments.services.payment_service import record_chamber_payment_collection


class ChamberPaymentTests(TestCase):
    def setUp(self):
        self.client = Client()

        # Doctor 1
        self.doctor1 = User.objects.create_user(
            username="dr_chamber_1",
            first_name="Monir",
            last_name="Hossain",
            email="dr.monir@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-112233",
            bmdc_verified=True,
        )
        self.doctor1.profile.fee_first_visit = Decimal("1200.00")
        self.doctor1.profile.save()

        # Doctor 2 (Unassigned to receptionist)
        self.doctor2 = User.objects.create_user(
            username="dr_chamber_2",
            first_name="Nasir",
            last_name="Ahmed",
            email="dr.nasir@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-445566",
            bmdc_verified=True,
        )
        self.doctor2.profile.fee_first_visit = Decimal("800.00")
        self.doctor2.profile.save()

        # Weekly schedules
        self.target_date = timezone.now().date() + timedelta(days=1)
        target_weekday = self.target_date.weekday()
        for doc in (self.doctor1, self.doctor2):
            DoctorWeeklySchedule.objects.create(
                doctor=doc,
                weekday=target_weekday,
                session_name="General Session",
                start_time=time(9, 0),
                end_time=time(17, 0),
                slot_duration=30,
                max_capacity=20,
                is_active=True,
            )

        # Receptionist assigned ONLY to Doctor 1
        self.receptionist = User.objects.create_user(
            username="recep_chamber_1",
            first_name="Shamima",
            last_name="Akter",
            email="shamima@greenhospital.org",
            password="RecepPass123!",
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )
        ReceptionistDoctorAssignment.objects.create(
            receptionist=self.receptionist,
            doctor=self.doctor1,
        )

        # Hospital Admin
        self.hospital_admin = User.objects.create_user(
            username="hosp_admin_chamber",
            first_name="Admin",
            last_name="Hospital",
            email="admin@greenhospital.org",
            password="AdminPass123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Patient
        self.patient = User.objects.create_user(
            username="patient_chamber_test",
            first_name="Arif",
            last_name="Hasan",
            email="arif@gmail.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        # Booking with Doctor 1 (Pay at Chamber)
        self.booking_doc1 = create_appointment(
            doctor=self.doctor1,
            patient=self.patient,
            appointment_date=self.target_date,
            appointment_time=time(10, 0),
            visit_type="regular",
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patient,
        )

        # Booking with Doctor 2 (Pay at Chamber)
        self.booking_doc2 = create_appointment(
            doctor=self.doctor2,
            patient=self.patient,
            appointment_date=self.target_date,
            appointment_time=time(11, 0),
            visit_type="regular",
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patient,
        )

    def test_booking_without_online_payment_remains_unpaid_confirmed(self):
        """A patient can book without online payment; appointment remains valid with UNPAID status."""
        self.assertEqual(self.booking_doc1.status, Booking.StatusChoices.CONFIRMED)
        self.assertEqual(self.booking_doc1.payment_status, Booking.PaymentStatus.UNPAID)
        self.assertEqual(self.booking_doc1.payment_method, Booking.PaymentMethod.PAY_AT_CHAMBER)
        self.assertEqual(self.booking_doc1.fee_amount, Decimal("1200.00"))

    def test_assigned_receptionist_can_record_cash_collection(self):
        """Assigned receptionist records cash chamber payment, generates receipt, preserves staff identity."""
        tx, receipt = record_chamber_payment_collection(
            booking=self.booking_doc1,
            collected_by=self.receptionist,
            amount=Decimal("1200.00"),
            method="cash",
            notes="Collected at Room 301 front desk",
        )

        self.assertEqual(tx.status, PaymentTransaction.Status.SUCCESS)
        self.assertEqual(tx.amount, Decimal("1200.00"))
        self.assertEqual(tx.billed_fee, Decimal("1200.00"))
        self.assertEqual(tx.payment_method, PaymentTransaction.PaymentMethod.CASH)
        self.assertEqual(tx.collected_by, self.receptionist)
        self.assertIsNotNone(tx.collected_at)

        # Receipt checks
        self.assertEqual(receipt.receipt_number, tx.receipt.receipt_number)
        self.assertEqual(receipt.collected_amount, Decimal("1200.00"))
        self.assertEqual(receipt.issued_by, self.receptionist)
        self.assertEqual(receipt.patient, self.patient)
        self.assertEqual(receipt.doctor, self.doctor1)

        # Booking marked PAID
        self.booking_doc1.refresh_from_db()
        self.assertEqual(self.booking_doc1.payment_status, Booking.PaymentStatus.PAID)

        # Audit log preserved
        audit = AuditLog.objects.filter(
            action=AuditLog.ActionChoices.PAYMENT_COLLECTED,
            target_user=self.patient,
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.receptionist)

    def test_unassigned_receptionist_cannot_collect_chamber_payment(self):
        """Receptionist CANNOT record collection for an unassigned doctor (raises PermissionDenied)."""
        with self.assertRaises(PermissionDenied):
            record_chamber_payment_collection(
                booking=self.booking_doc2,  # Dr. 2 is unassigned
                collected_by=self.receptionist,
                amount=Decimal("800.00"),
                method="cash",
            )

    def test_patient_cannot_record_own_chamber_payment(self):
        """Patients cannot mark their own appointments as collected (raises PermissionDenied)."""
        with self.assertRaises(PermissionDenied):
            record_chamber_payment_collection(
                booking=self.booking_doc1,
                collected_by=self.patient,
                amount=Decimal("1200.00"),
                method="cash",
            )

    def test_hospital_admin_can_collect_for_any_doctor(self):
        """Hospital Administrator can record chamber payment for any doctor."""
        tx, receipt = record_chamber_payment_collection(
            booking=self.booking_doc2,
            collected_by=self.hospital_admin,
            amount=Decimal("800.00"),
            method="chamber_pos",
        )
        self.assertEqual(tx.status, PaymentTransaction.Status.SUCCESS)
        self.assertEqual(tx.payment_method, PaymentTransaction.PaymentMethod.CHAMBER_POS)
        self.booking_doc2.refresh_from_db()
        self.assertEqual(self.booking_doc2.payment_status, Booking.PaymentStatus.PAID)

    def test_prevent_duplicate_chamber_payment(self):
        """Attempting to record chamber payment again for an already paid booking raises ValidationError."""
        record_chamber_payment_collection(
            booking=self.booking_doc1,
            collected_by=self.receptionist,
            amount=Decimal("1200.00"),
            method="cash",
        )

        with self.assertRaises(ValidationError) as cm:
            record_chamber_payment_collection(
                booking=self.booking_doc1,
                collected_by=self.receptionist,
                amount=Decimal("1200.00"),
                method="cash",
            )
        self.assertIn("already been collected", str(cm.exception))

    def test_underpayment_and_amount_mismatch_rejected(self):
        """Attempting to collect less than the locked snapshot fee raises ValidationError."""
        with self.assertRaises(ValidationError) as cm:
            record_chamber_payment_collection(
                booking=self.booking_doc1,
                collected_by=self.receptionist,
                amount=Decimal("600.00"),  # Fee is 1200.00
                method="cash",
            )
        self.assertIn("must exactly match the appointment fee", str(cm.exception))
