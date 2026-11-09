from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest import mock
from django.core.exceptions import ValidationError
from django.test import TestCase, RequestFactory
from django.utils import timezone

from accounts.models import User, Profile
from bookings.models import Booking
from bookings.services.booking_service import create_appointment
from doctors.models import DoctorWeeklySchedule, HospitalSetting
from doctors.services.availability import DHAKA_TZ, generate_doctor_slots
from payments.models import PaymentTransaction, Receipt
from payments.services.cancellation_policy import calculate_cancellation_refund_eligibility
from payments.services.payment_service import initiate_online_payment, process_gateway_callback


class ConcurrencyAndBoundaryTests(TestCase):
    """
    Validates concurrency safeguards, exact booking-window boundaries,
    and exact financial refund percentage boundaries for Green Hospital.
    """

    def setUp(self):
        self.factory = RequestFactory()

        # Doctor
        self.doctor = User.objects.create_user(
            username="dr_boundary",
            email="dr.boundary@greenhospital.org",
            password="DoctorPassword123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            first_name="Rafiqul",
            last_name="Islam",
            bmdc_number="A-889900",
            bmdc_verified=True,
        )
        self.doctor.profile.phone = "+8801700112233"
        self.doctor.profile.chamber_number = "Room 101"
        self.doctor.profile.fee_first_visit = Decimal("1000.00")
        self.doctor.profile.fee_second_visit = Decimal("800.00")
        self.doctor.profile.fee_third_visit = Decimal("500.00")
        self.doctor.profile.fee_report_check = Decimal("200.00")
        self.doctor.profile.save()

        # Patients
        self.patients = [
            User.objects.create_user(
                username=f"pt_boundary_{i}",
                email=f"pt{i}@example.com",
                password="PatientPassword123!",
                role=User.RoleChoices.PATIENT,
                status=User.StatusChoices.ACTIVE,
                first_name=f"Patient{i}",
                last_name="Test",
            )
            for i in range(1, 6)
        ]
        for idx, p in enumerate(self.patients, 1):
            p.profile.phone = f"+880171100000{idx}"
            p.profile.save()

    def test_exact_48_hour_booking_window_boundaries(self):
        """
        Tests the authoritative 48-hour booking window boundary:
        - > 48 hours in advance: outside window, unavailable.
        - Exactly 48.0 hours in advance: available.
        - < 48 hours in advance: available.
        - In the past (<= now): unavailable.
        """
        # Ensure default setting is 48 hours
        HospitalSetting.objects.all().delete()
        HospitalSetting.objects.create(booking_window_hours=48)

        # Target appointment start: 2026-11-20 10:00:00 Asia/Dhaka
        target_date = date(2026, 11, 20)
        target_time = time(10, 0)
        appointment_dt = timezone.make_aware(datetime.combine(target_date, target_time), DHAKA_TZ)

        schedule = DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            session_name="Morning Consultations",
            start_time=time(10, 0),
            end_time=time(11, 0),
            slot_duration=30,
            max_capacity=5,
            chamber_number="Room 101",
        )

        # Case 1: Exactly 48 hours + 1 minute before appointment (48.016 hours) -> OUTSIDE WINDOW
        simulated_now_outside = appointment_dt - timedelta(hours=48, minutes=1)
        with mock.patch("doctors.services.availability.get_dhaka_now", return_value=simulated_now_outside):
            res_outside = generate_doctor_slots(self.doctor, target_date)
            slot_10_outside = next(s for s in res_outside["slots"] if s["time"] == target_time)
            self.assertFalse(slot_10_outside["is_available"])
            self.assertEqual(slot_10_outside["reason"], "Booking opens 48h before appointment")

        # Case 2: Exactly 48.0 hours before appointment (48 hours 0 seconds) -> WITHIN WINDOW (boundary condition)
        # Note: (slot_aware_dt - 48h) == now_dhaka, so outside_window (slot - 48h > now) is False
        simulated_now_exact_48 = appointment_dt - timedelta(hours=48)
        with mock.patch("doctors.services.availability.get_dhaka_now", return_value=simulated_now_exact_48):
            res_exact_48 = generate_doctor_slots(self.doctor, target_date)
            slot_10_exact = next(s for s in res_exact_48["slots"] if s["time"] == target_time)
            self.assertTrue(slot_10_exact["is_available"])

        # Case 3: 24 hours before appointment -> WITHIN WINDOW
        simulated_now_24h = appointment_dt - timedelta(hours=24)
        with mock.patch("doctors.services.availability.get_dhaka_now", return_value=simulated_now_24h):
            res_24h = generate_doctor_slots(self.doctor, target_date)
            slot_10_24h = next(s for s in res_24h["slots"] if s["time"] == target_time)
            self.assertTrue(slot_10_24h["is_available"])

        # Case 4: 1 minute before appointment -> WITHIN WINDOW
        simulated_now_1min = appointment_dt - timedelta(minutes=1)
        with mock.patch("doctors.services.availability.get_dhaka_now", return_value=simulated_now_1min):
            res_1min = generate_doctor_slots(self.doctor, target_date)
            slot_10_1min = next(s for s in res_1min["slots"] if s["time"] == target_time)
            self.assertTrue(slot_10_1min["is_available"])

        # Case 5: Exactly at appointment start -> PAST (unavailable)
        simulated_now_start = appointment_dt
        with mock.patch("doctors.services.availability.get_dhaka_now", return_value=simulated_now_start):
            res_start = generate_doctor_slots(self.doctor, target_date)
            slot_10_start = next(s for s in res_start["slots"] if s["time"] == target_time)
            self.assertFalse(slot_10_start["is_available"])
            self.assertEqual(slot_10_start["reason"], "Past Slot")

    def test_exact_cancellation_refund_percentage_boundaries(self):
        """
        Tests the strict financial cancellation policy:
        - >= 24 hours before appointment start -> 100% refund.
        - Exactly 24.0 hours before appointment start -> 100% refund.
        - Less than 24 hours before start -> 80% refund.
        - At or after appointment start -> 0% automatic refund (admin exception review only).
        """
        target_date = date(2026, 12, 1)
        target_time = time(14, 0)
        appointment_start = timezone.make_aware(datetime.combine(target_date, target_time), DHAKA_TZ)

        booking = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patients[0],
            appointment_date=target_date,
            appointment_time=target_time,
            serial_number=1,
            fee_amount=Decimal("1000.00"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        PaymentTransaction.objects.create(
            booking=booking,
            patient=self.patients[0],
            doctor=self.doctor,
            billed_fee=Decimal("1000.00"),
            amount=Decimal("1000.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            status=PaymentTransaction.Status.SUCCESS,
        )

        # 1. Exactly 24 hours and 1 minute before start -> 100% refund
        res1 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start - timedelta(hours=24, minutes=1),
            cancellation_actor_type="patient",
        )
        self.assertTrue(res1.is_eligible_for_refund)
        self.assertEqual(res1.refund_percentage, 100)
        self.assertEqual(res1.refundable_amount, Decimal("1000.00"))

        # 2. Exactly 24.0 hours before start (boundary requirement) -> 100% refund
        res2 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start - timedelta(hours=24),
            cancellation_actor_type="patient",
        )
        self.assertTrue(res2.is_eligible_for_refund)
        self.assertEqual(res2.refund_percentage, 100)
        self.assertEqual(res2.refundable_amount, Decimal("1000.00"))

        # 3. 23 hours and 59 minutes before start (under 24h boundary) -> 80% refund
        res3 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start - timedelta(hours=23, minutes=59),
            cancellation_actor_type="patient",
        )
        self.assertTrue(res3.is_eligible_for_refund)
        self.assertEqual(res3.refund_percentage, 80)
        self.assertEqual(res3.refundable_amount, Decimal("800.00"))

        # 4. 1 minute before start -> 80% refund
        res4 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start - timedelta(minutes=1),
            cancellation_actor_type="patient",
        )
        self.assertTrue(res4.is_eligible_for_refund)
        self.assertEqual(res4.refund_percentage, 80)
        self.assertEqual(res4.refundable_amount, Decimal("800.00"))

        # 5. Exactly at appointment start -> 0% automatic refund
        res5 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start,
            cancellation_actor_type="patient",
        )
        self.assertFalse(res5.is_eligible_for_refund)
        self.assertEqual(res5.refund_percentage, 0)
        self.assertEqual(res5.refundable_amount, Decimal("0.00"))

        # 6. 15 minutes after appointment start -> 0% automatic refund
        res6 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start + timedelta(minutes=15),
            cancellation_actor_type="patient",
        )
        self.assertFalse(res6.is_eligible_for_refund)
        self.assertEqual(res6.refund_percentage, 0)
        self.assertEqual(res6.refundable_amount, Decimal("0.00"))

        # 7. Doctor cancellation: Always 100% refund even 10 minutes before start
        res7 = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=appointment_start - timedelta(minutes=10),
            cancellation_actor_type="doctor",
        )
        self.assertTrue(res7.is_eligible_for_refund)
        self.assertEqual(res7.refund_percentage, 100)
        self.assertEqual(res7.refundable_amount, Decimal("1000.00"))

    def test_concurrency_serial_allocation_and_capacity_enforcement(self):
        """
        Validates concurrency-safe monotonic serial allocation (#1, #2, #3)
        and strict enforcement of session capacity.
        """
        target_date = timezone.now().date() + timedelta(days=1)
        schedule = DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            session_name="Capacity Limited Session",
            start_time=time(14, 0),
            end_time=time(16, 0),
            slot_duration=30,
            max_capacity=3,  # Strict maximum of 3 bookings
            chamber_number="Room 101",
        )

        slots = [time(14, 0), time(14, 30), time(15, 0)]
        bookings = []

        for i in range(3):
            b = create_appointment(
                doctor=self.doctor,
                patient=self.patients[i],
                appointment_date=target_date,
                appointment_time=slots[i],
                visit_type=Booking.VisitType.REGULAR,
                payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
                actor=self.patients[i],
            )
            bookings.append(b)

        # Verify serials are strictly sequential and unique
        self.assertEqual([b.serial_number for b in bookings], [1, 2, 3])

        # Attempting a 4th booking on an extra available slot or time must fail capacity check
        with self.assertRaises(ValidationError) as ctx:
            create_appointment(
                doctor=self.doctor,
                patient=self.patients[3],
                appointment_date=target_date,
                appointment_time=time(15, 30),
                visit_type=Booking.VisitType.REGULAR,
                payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
                actor=self.patients[3],
            )
        self.assertIn("capacity", str(ctx.exception).lower())

    def test_duplicate_booking_prevention(self):
        """
        Ensures duplicate bookings are strictly prevented:
        1. A slot cannot be booked twice by any patient.
        2. A patient cannot have two active appointments at the same date and time.
        """
        target_date = timezone.now().date() + timedelta(days=1)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            session_name="Session A",
            start_time=time(9, 0),
            end_time=time(11, 0),
            slot_duration=30,
            max_capacity=10,
            chamber_number="Room 101",
        )

        # First booking succeeds
        create_appointment(
            doctor=self.doctor,
            patient=self.patients[0],
            appointment_date=target_date,
            appointment_time=time(9, 0),
            visit_type=Booking.VisitType.REGULAR,
            payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
            actor=self.patients[0],
        )

        # 1. Attempting to book the same slot again must be rejected (already booked)
        with self.assertRaises(ValidationError) as ctx1:
            create_appointment(
                doctor=self.doctor,
                patient=self.patients[1],
                appointment_date=target_date,
                appointment_time=time(9, 0),
                visit_type=Booking.VisitType.REGULAR,
                payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
                actor=self.patients[1],
            )
        self.assertIn("already booked", str(ctx1.exception).lower())

        # 2. Patient attempting another booking at the exact same time with a second doctor must be rejected
        doctor2 = User.objects.create_user(
            username="dr_boundary_2",
            email="dr2@example.com",
            password="DoctorPassword123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            first_name="Hasan",
            last_name="Ali",
            bmdc_number="A-112299",
            bmdc_verified=True,
        )
        doctor2.profile.chamber_number = "Room 102"
        doctor2.profile.save()
        DoctorWeeklySchedule.objects.create(
            doctor=doctor2,
            weekday=target_date.weekday(),
            session_name="Session B",
            start_time=time(9, 0),
            end_time=time(11, 0),
            slot_duration=30,
            max_capacity=10,
            chamber_number="Room 102",
        )

        with self.assertRaises(ValidationError) as ctx2:
            create_appointment(
                doctor=doctor2,
                patient=self.patients[0],
                appointment_date=target_date,
                appointment_time=time(9, 0),
                visit_type=Booking.VisitType.REGULAR,
                payment_method=Booking.PaymentMethod.PAY_AT_CHAMBER,
                actor=self.patients[0],
            )
        self.assertIn("already have an active appointment", str(ctx2.exception).lower())

    def test_duplicate_gateway_callback_idempotency(self):
        """
        Validates that duplicate callbacks or IPNs for the same transaction
        do not double-credit, double-process, or create duplicate receipts.
        """
        target_date = timezone.now().date() + timedelta(days=1)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            session_name="Session IPN",
            start_time=time(9, 0),
            end_time=time(11, 0),
            slot_duration=30,
            max_capacity=5,
            chamber_number="Room 101",
        )
        booking = create_appointment(
            doctor=self.doctor,
            patient=self.patients[0],
            appointment_date=target_date,
            appointment_time=time(9, 0),
            visit_type=Booking.VisitType.REGULAR,
            payment_method=Booking.PaymentMethod.ONLINE,
            actor=self.patients[0],
        )

        request = self.factory.get("/")
        request.user = self.patients[0]
        init_res = initiate_online_payment(booking, request=request, provider="mock")
        tx = PaymentTransaction.objects.get(booking=booking)

        callback_data = {
            "status": "VALID",
            "val_id": "MOCK-IDEMPOTENT-001",
            "tran_id": tx.transaction_reference,
            "amount": "1000.00",
            "currency": "BDT",
        }

        # First callback processing
        success1, tx1, receipt1, msg1 = process_gateway_callback(
            tran_id=tx.transaction_reference,
            val_id="MOCK-IDEMPOTENT-001",
            raw_post_data=callback_data,
            provider="mock",
        )
        self.assertTrue(success1)
        self.assertIsNotNone(receipt1)
        initial_receipt_count = Receipt.objects.filter(booking=booking).count()
        self.assertEqual(initial_receipt_count, 1)

        # Second callback with exact same transaction ID
        success2, tx2, receipt2, msg2 = process_gateway_callback(
            tran_id=tx.transaction_reference,
            val_id="MOCK-IDEMPOTENT-001",
            raw_post_data=callback_data,
            provider="mock",
        )
        self.assertTrue(success2)
        # Receipt count remains exactly 1; no duplicate receipt
        after_receipt_count = Receipt.objects.filter(booking=booking).count()
        self.assertEqual(after_receipt_count, 1)
        self.assertEqual(receipt2.receipt_number, receipt1.receipt_number)
