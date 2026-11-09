from datetime import date, time, timedelta
from decimal import Decimal
from django.test import TestCase, RequestFactory
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking
from bookings.services.booking_service import create_appointment
from doctors.models import DoctorWeeklySchedule
from doctors.services.availability import generate_doctor_slots
from payments.models import PaymentTransaction
from payments.services.payment_service import (
    expire_abandoned_online_sessions,
    initiate_online_payment,
)


class BookingConsistencyTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

        # Doctor
        self.doctor = User.objects.create_user(
            username="dr_consistency_test",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_verified=True,
        )
        self.doctor.profile.fee_first_visit = Decimal("1000.00")
        self.doctor.profile.save()

        # Patient 1 & 2
        self.patient1 = User.objects.create_user(
            username="patient_c1",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient2 = User.objects.create_user(
            username="patient_c2",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        self.target_date = timezone.now().date() + timedelta(days=1)
        self.target_time = time(11, 0)

        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=self.target_date.weekday(),
            session_name="General Session",
            start_time=time(9, 0),
            end_time=time(17, 0),
            slot_duration=30,
            max_capacity=10,
            is_active=True,
        )

    def test_abandoned_online_session_expires_and_releases_capacity(self):
        """Unpaid pending online checkout session expires after timeout, cancelling booking and releasing slot."""
        # Patient 1 books online
        booking_online = create_appointment(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=self.target_date,
            appointment_time=self.target_time,
            payment_method=Booking.PaymentMethod.ONLINE,
            actor=self.patient1,
        )
        self.assertEqual(booking_online.status, Booking.StatusChoices.PENDING)

        request = self.factory.get("/")
        request.user = self.patient1
        initiate_online_payment(booking_online, request=request, provider="mock")

        tx = PaymentTransaction.objects.get(booking=booking_online)
        self.assertEqual(tx.status, PaymentTransaction.Status.PENDING)

        # Simulate time passing: session expired 20 minutes ago
        tx.expires_at = timezone.now() - timedelta(minutes=20)
        tx.save()

        # Run expiration cleanup
        expired_count = expire_abandoned_online_sessions()
        self.assertGreaterEqual(expired_count, 1)

        # Verify transaction cancelled and booking cancelled
        tx.refresh_from_db()
        booking_online.refresh_from_db()
        self.assertEqual(tx.status, PaymentTransaction.Status.CANCELLED)
        self.assertEqual(booking_online.status, Booking.StatusChoices.CANCELLED)

        # Doctor's slot is now free! Patient 2 can now book this exact slot
        booking_patient2 = create_appointment(
            doctor=self.doctor,
            patient=self.patient2,
            appointment_date=self.target_date,
            appointment_time=self.target_time,
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patient2,
        )
        self.assertIsNotNone(booking_patient2)
        self.assertEqual(booking_patient2.patient, self.patient2)
        self.assertEqual(booking_patient2.status, Booking.StatusChoices.CONFIRMED)

    def test_retains_confirmed_pay_at_chamber_bookings(self):
        """Expiration cleanup strictly does NOT cancel confirmed Pay at Chamber bookings."""
        booking_chamber = create_appointment(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=self.target_date,
            appointment_time=time(11, 30),
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patient1,
        )
        self.assertEqual(booking_chamber.status, Booking.StatusChoices.CONFIRMED)
        self.assertEqual(booking_chamber.payment_status, Booking.PaymentStatus.UNPAID)

        # Run cleanup
        expire_abandoned_online_sessions()

        # Must still be confirmed and unpaid
        booking_chamber.refresh_from_db()
        self.assertEqual(booking_chamber.status, Booking.StatusChoices.CONFIRMED)
        self.assertEqual(booking_chamber.payment_status, Booking.PaymentStatus.UNPAID)
