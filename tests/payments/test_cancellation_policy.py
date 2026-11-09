from datetime import datetime, date, time, timedelta
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone

from accounts.models import User
from bookings.models import Booking
from doctors.services.availability import DHAKA_TZ
from payments.models import PaymentTransaction
from payments.services.cancellation_policy import calculate_cancellation_refund_eligibility


class CancellationPolicyTests(TestCase):
    def setUp(self):
        # Doctor & Patient
        self.doctor = User.objects.create_user(
            username="dr_policy_test",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient = User.objects.create_user(
            username="patient_policy_test",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        self.appointment_date = date(2026, 11, 20)
        self.appointment_time = time(14, 0)  # 2:00 PM Dhaka

        # Appointment start datetime in Asia/Dhaka
        self.appointment_start = datetime.combine(
            self.appointment_date, self.appointment_time
        ).replace(tzinfo=DHAKA_TZ)

        # Create paid booking with 1000.00 BDT fee
        self.booking = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient,
            appointment_date=self.appointment_date,
            appointment_time=self.appointment_time,
            fee_amount=Decimal("1000.00"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        PaymentTransaction.objects.create(
            booking=self.booking,
            patient=self.patient,
            doctor=self.doctor,
            billed_fee=Decimal("1000.00"),
            amount=Decimal("1000.00"),
            currency="BDT",
            status=PaymentTransaction.Status.SUCCESS,
        )

    def test_exactly_24_hours_yields_100_percent_refund(self):
        """At exactly 24 hours before appointment start, the correct refund is 100%."""
        cancel_time = self.appointment_start - timedelta(hours=24)

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertTrue(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 100)
        self.assertEqual(result.refundable_amount, Decimal("1000.00"))
        self.assertEqual(result.original_paid_amount, Decimal("1000.00"))
        self.assertEqual(result.hours_before_start, Decimal("24.0000"))

    def test_24_hours_plus_one_second_yields_100_percent_refund(self):
        """At 24 hours plus 1 second before start, refund is 100%."""
        cancel_time = self.appointment_start - (timedelta(hours=24) + timedelta(seconds=1))

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertTrue(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 100)
        self.assertEqual(result.refundable_amount, Decimal("1000.00"))

    def test_24_hours_minus_one_second_yields_80_percent_refund(self):
        """At 24 hours minus 1 second before start, refund is strictly 80%."""
        cancel_time = self.appointment_start - (timedelta(hours=24) - timedelta(seconds=1))

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertTrue(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 80)
        self.assertEqual(result.refundable_amount, Decimal("800.00"))

    def test_patient_cancellation_less_than_24h_before_start(self):
        """Less than 24 hours before start (e.g. 5 hours before), refund is 80%."""
        cancel_time = self.appointment_start - timedelta(hours=5)

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertTrue(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 80)
        self.assertEqual(result.refundable_amount, Decimal("800.00"))

    def test_patient_cancellation_at_appointment_start(self):
        """At exactly appointment start (0 seconds remaining), no automatic refund; admin exception review only."""
        cancel_time = self.appointment_start

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertFalse(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 0)
        self.assertEqual(result.refundable_amount, Decimal("0.00"))
        self.assertEqual(result.policy_rule, "patient_cancellation_after_start_admin_exception_only")

    def test_patient_cancellation_after_appointment_start(self):
        """After appointment start (e.g. 1 hour past), no automatic refund; admin exception review only."""
        cancel_time = self.appointment_start + timedelta(hours=1)

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertFalse(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 0)
        self.assertEqual(result.refundable_amount, Decimal("0.00"))

    def test_doctor_and_hospital_cancellation_always_100_percent(self):
        """Doctor or hospital cancellation guarantees 100% refund regardless of time."""
        # 1 hour after start
        cancel_time = self.appointment_start + timedelta(hours=1)

        result = calculate_cancellation_refund_eligibility(
            booking=self.booking,
            current_time=cancel_time,
            cancellation_actor_type="doctor",
        )

        self.assertTrue(result.is_eligible_for_refund)
        self.assertEqual(result.refund_percentage, 100)
        self.assertEqual(result.refundable_amount, Decimal("1000.00"))

    def test_unpaid_chamber_booking_has_nothing_to_refund(self):
        """An unpaid appointment has nothing to refund and eligible amount is 0 BDT."""
        unpaid_booking = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient,
            appointment_date=self.appointment_date,
            appointment_time=time(16, 0),
            fee_amount=Decimal("1200.00"),
            payment_status=Booking.PaymentStatus.UNPAID,
            status=Booking.StatusChoices.CONFIRMED,
        )

        cancel_time = self.appointment_start - timedelta(hours=30)
        result = calculate_cancellation_refund_eligibility(
            booking=unpaid_booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertTrue(result.is_unpaid)
        self.assertFalse(result.is_eligible_for_refund)
        self.assertEqual(result.refundable_amount, Decimal("0.00"))
        self.assertEqual(result.original_paid_amount, Decimal("0.00"))

    def test_eighty_percent_calculation_and_decimal_rounding(self):
        """Verify decimal precision and half-up rounding for 80% refunds."""
        # 333.33 BDT * 0.80 = 266.664 -> 266.66 BDT
        odd_time = time(16, 0)
        odd_start = datetime.combine(self.appointment_date, odd_time).replace(tzinfo=DHAKA_TZ)
        odd_booking = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient,
            appointment_date=self.appointment_date,
            appointment_time=odd_time,
            fee_amount=Decimal("333.33"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        PaymentTransaction.objects.create(
            booking=odd_booking,
            patient=self.patient,
            doctor=self.doctor,
            billed_fee=Decimal("333.33"),
            amount=Decimal("333.33"),
            currency="BDT",
            status=PaymentTransaction.Status.SUCCESS,
        )

        cancel_time = odd_start - timedelta(hours=10)
        result = calculate_cancellation_refund_eligibility(
            booking=odd_booking,
            current_time=cancel_time,
            cancellation_actor_type="patient",
        )

        self.assertEqual(result.refund_percentage, 80)
        self.assertEqual(result.refundable_amount, Decimal("266.66"))
