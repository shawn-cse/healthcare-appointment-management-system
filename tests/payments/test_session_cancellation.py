from datetime import date, time, timedelta
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone

from accounts.models import User, Profile, AuditLog
from bookings.models import Booking
from doctors.models.schedules import DoctorAvailabilityException, DoctorWeeklySchedule
from payments.models import PaymentTransaction, RefundRequest
from payments.services.session_cancellation_service import cancel_doctor_consultation_session


class SessionCancellationTests(TestCase):
    def setUp(self):
        # Doctor
        self.doctor = User.objects.create_user(
            username="dr_session_test",
            first_name="Farhan",
            last_name="Kabir",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
        )

        # 3 Patients
        self.patient1 = User.objects.create_user(
            username="patient_s1",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient2 = User.objects.create_user(
            username="patient_s2",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient3 = User.objects.create_user(
            username="patient_s3",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        self.target_date = timezone.now().date() + timedelta(days=3)

        # Weekly schedule
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=self.target_date.weekday(),
            session_name="General Session",
            start_time=time(9, 0),
            end_time=time(13, 0),
            slot_duration=30,
            max_capacity=10,
            is_active=True,
        )

        # Patient 1: Paid Online (1200.00 BDT)
        self.booking1 = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=self.target_date,
            appointment_time=time(9, 30),
            fee_amount=Decimal("1200.00"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        PaymentTransaction.objects.create(
            booking=self.booking1,
            patient=self.patient1,
            doctor=self.doctor,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            status=PaymentTransaction.Status.SUCCESS,
        )

        # Patient 2: Paid Cash at Chamber (1200.00 BDT)
        self.booking2 = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient2,
            appointment_date=self.target_date,
            appointment_time=time(10, 0),
            fee_amount=Decimal("1200.00"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        PaymentTransaction.objects.create(
            booking=self.booking2,
            patient=self.patient2,
            doctor=self.doctor,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.CASH,
            status=PaymentTransaction.Status.SUCCESS,
        )

        # Patient 3: Unpaid Pay at Chamber (800.00 BDT)
        self.booking3 = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient3,
            appointment_date=self.target_date,
            appointment_time=time(10, 30),
            fee_amount=Decimal("800.00"),
            payment_status=Booking.PaymentStatus.UNPAID,
            status=Booking.StatusChoices.CONFIRMED,
        )

    def test_cancel_session_with_multiple_paid_and_unpaid_patients(self):
        """Cancels entire session, creates availability exception, generates 100% refund requests for paid patients only."""
        reason = "Dr. Farhan attending emergency surgery."
        summary = cancel_doctor_consultation_session(
            doctor=self.doctor,
            target_date=self.target_date,
            reason=reason,
            actor=self.doctor,
        )

        self.assertEqual(summary["total_affected"], 3)
        self.assertEqual(summary["paid_count"], 2)
        self.assertEqual(summary["unpaid_count"], 1)
        self.assertEqual(summary["total_refundable_amount"], Decimal("2400.00"))

        # Verify Availability Exception was created to block future bookings
        exception = DoctorAvailabilityException.objects.filter(
            doctor=self.doctor,
            start_date=self.target_date,
            is_active=True,
        ).first()
        self.assertIsNotNone(exception)
        self.assertEqual(exception.reason, reason)

        # Verify all 3 appointments were cancelled and NOT erased
        self.booking1.refresh_from_db()
        self.booking2.refresh_from_db()
        self.booking3.refresh_from_db()
        self.assertEqual(self.booking1.status, Booking.StatusChoices.CANCELLED)
        self.assertEqual(self.booking2.status, Booking.StatusChoices.CANCELLED)
        self.assertEqual(self.booking3.status, Booking.StatusChoices.CANCELLED)
        self.assertEqual(self.booking1.cancellation_reason, reason)

        # Verify paid patients received 100% refund requests
        refund1 = RefundRequest.objects.filter(booking=self.booking1).first()
        self.assertIsNotNone(refund1)
        self.assertEqual(refund1.eligible_refund_percentage, 100)
        self.assertEqual(refund1.requested_amount, Decimal("1200.00"))
        self.assertEqual(refund1.cancellation_type, "doctor")

        refund2 = RefundRequest.objects.filter(booking=self.booking2).first()
        self.assertIsNotNone(refund2)
        self.assertEqual(refund2.eligible_refund_percentage, 100)
        self.assertEqual(refund2.requested_amount, Decimal("1200.00"))

        # Verify unpaid patient (Patient 3) has NO monetary refund request
        refund3 = RefundRequest.objects.filter(booking=self.booking3).first()
        self.assertIsNone(refund3)

        # Audit log verified
        audit = AuditLog.objects.filter(
            action=AuditLog.ActionChoices.SESSION_CANCELLED,
            actor=self.doctor,
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.details.get("cancelled_appointments_count"), 3)
