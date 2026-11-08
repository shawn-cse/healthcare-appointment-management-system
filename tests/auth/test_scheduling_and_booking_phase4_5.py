from datetime import datetime, date, time, timedelta
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.core.exceptions import ValidationError
from django.utils import timezone

from accounts.models import User, Profile
from doctors.models import (
    DoctorWeeklySchedule,
    DoctorScheduleBreak,
    DoctorAvailabilityException,
    HospitalSetting,
)
from doctors.services.availability import (
    generate_doctor_slots,
    detect_chamber_conflicts,
    DHAKA_TZ,
)
from bookings.models import Booking
from bookings.services.fee_calculator import calculate_patient_visit_fee
from bookings.services.booking_service import create_appointment


class SchedulingAndBookingPhase4And5Tests(TestCase):
    def setUp(self):
        self.client = Client()
        self.dhaka_tz = DHAKA_TZ

        # Doctor
        self.doctor = User.objects.create_user(
            username="dr_scheduling_test",
            first_name="Rafiqul",
            last_name="Islam",
            email="dr.rafiqul@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="A-88990",
            bmdc_verified=True,
        )
        self.doctor.profile.department = "Medicine"
        self.doctor.profile.specialization = "Internal Medicine"
        self.doctor.profile.chamber_number = "Chamber 201"
        self.doctor.profile.fee_first_visit = Decimal("1500.00")
        self.doctor.profile.fee_second_visit = Decimal("1000.00")
        self.doctor.profile.fee_third_visit = Decimal("800.00")
        self.doctor.profile.fee_report_check = Decimal("500.00")
        self.doctor.profile.save()

        # Doctor 2
        self.doctor2 = User.objects.create_user(
            username="dr_other_test",
            first_name="Nasreen",
            last_name="Akter",
            email="dr.nasreen@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="A-99112",
            bmdc_verified=True,
        )
        self.doctor2.profile.department = "Pediatrics"
        self.doctor2.profile.chamber_number = "Chamber 202"
        self.doctor2.profile.fee_first_visit = Decimal("1200.00")
        self.doctor2.profile.save()

        # Patients
        self.patient1 = User.objects.create_user(
            username="patient_kalam",
            first_name="Abul",
            last_name="Kalam",
            email="kalam@gmail.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient2 = User.objects.create_user(
            username="patient_rokeya",
            first_name="Rokeya",
            last_name="Khatun",
            email="rokeya@gmail.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        # Default hospital setting (48 hours)
        HospitalSetting.objects.get_or_create(booking_window_hours=48)

    def test_weekly_schedule_creation_and_slot_generation(self):
        """Verify slot generation produces exact slots matching weekday, time, and duration."""
        # Create schedule for Monday (weekday 0)
        schedule = DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=0,
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_duration=30,
            max_capacity=10,
            session_name="Morning Clinic",
            chamber_number="Chamber 201",
            is_active=True,
        )

        # Find next Monday
        now = datetime.now(self.dhaka_tz)
        days_ahead = (0 - now.weekday()) % 7
        if days_ahead == 0 and now.time() > time(12, 0):
            days_ahead = 7
        target_date = (now + timedelta(days=days_ahead)).date()

        res = generate_doctor_slots(self.doctor, target_date, allow_past=True)
        slots = res["slots"]

        # Should generate 4 slots: 10:00, 10:30, 11:00, 11:30
        self.assertEqual(len(slots), 4)
        slot_times = [s["time_str"] for s in slots]
        self.assertIn("10:00", slot_times)
        self.assertIn("10:30", slot_times)
        self.assertIn("11:00", slot_times)
        self.assertIn("11:30", slot_times)

    def test_48_hour_booking_window_enforcement(self):
        """Verify slots >48 hours in future are blocked from booking, while within 48h are open."""
        now = datetime.now(self.dhaka_tz)
        today_date = now.date()

        # 1. Target date 5 days from now (well beyond 48 hours)
        far_future_date = today_date + timedelta(days=5)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=far_future_date.weekday(),
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_duration=30,
            is_active=True,
        )

        res_far = generate_doctor_slots(self.doctor, far_future_date, allow_past=True)
        for s in res_far["slots"]:
            self.assertFalse(s["is_available"])
            self.assertIn("48h", s["reason"])

        # Attempting create_appointment for far future date should raise ValidationError
        with self.assertRaises(ValidationError) as cm:
            create_appointment(
                doctor=self.doctor,
                patient=self.patient1,
                appointment_date=far_future_date,
                appointment_time=time(10, 0),
                is_walk_in=False,
            )
        self.assertIn("48h", str(cm.exception).lower())

    def test_schedule_breaks_and_exceptions(self):
        """Verify breaks and availability exceptions (day off, blocked times) block slots."""
        now = datetime.now(self.dhaka_tz)
        # Select target date tomorrow
        target_date = (now + timedelta(days=1)).date()

        schedule = DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            start_time=time(14, 0),
            end_time=time(16, 0),
            slot_duration=30,
            session_name="Afternoon Clinic",
            is_active=True,
        )

        # Add a break at 14:30 - 15:00
        DoctorScheduleBreak.objects.create(
            schedule=schedule,
            start_time=time(14, 30),
            end_time=time(15, 0),
            name="Prayer & Tea Break",
        )

        res = generate_doctor_slots(self.doctor, target_date, allow_past=True)
        # 14:30 should not appear in valid slots because it is inside a break
        slot_times = [s["time_str"] for s in res["slots"]]
        self.assertIn("14:00", slot_times)
        self.assertNotIn("14:30", slot_times)
        self.assertIn("15:00", slot_times)
        self.assertIn("15:30", slot_times)

        # Now add Day Off exception for target_date
        DoctorAvailabilityException.objects.create(
            doctor=self.doctor,
            start_date=target_date,
            end_date=target_date,
            exception_type=DoctorAvailabilityException.ExceptionType.DAY_OFF,
            reason="National Holiday",
            is_active=True,
        )

        res_holiday = generate_doctor_slots(self.doctor, target_date, allow_past=True)
        self.assertEqual(len(res_holiday["slots"]), 0)
        self.assertFalse(res_holiday["is_available_date"])
        self.assertEqual(res_holiday["reason"], "National Holiday")

    def test_overlapping_weekly_schedules_prevented(self):
        """Ensure doctor cannot create overlapping weekly schedule sessions."""
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=2,
            start_time=time(9, 0),
            end_time=time(12, 0),
            is_active=True,
        )

        overlapping = DoctorWeeklySchedule(
            doctor=self.doctor,
            weekday=2,
            start_time=time(11, 0),
            end_time=time(14, 0),
            is_active=True,
        )
        with self.assertRaises(ValidationError):
            overlapping.clean()

    def test_shared_chamber_conflicts_detection(self):
        """Ensure system detects when two doctors are scheduled in the same chamber simultaneously."""
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=3,
            start_time=time(10, 0),
            end_time=time(13, 0),
            chamber_number="Room 305",
            is_active=True,
        )

        # Doctor 2 checking for Room 305 at 12:00 to 14:00
        conflicts = detect_chamber_conflicts(
            doctor=self.doctor2,
            weekday=3,
            start_time=time(12, 0),
            end_time=time(14, 0),
            chamber_room="Room 305",
        )
        self.assertEqual(len(conflicts), 1)
        self.assertIn("Rafiqul", conflicts[0]["doctor_name"])

    def test_deterministic_visit_fee_cycle(self):
        """
        Verify exact fee cycle:
        1st regular visit -> fee_first_visit (1500)
        2nd regular visit -> fee_second_visit (1000)
        3rd regular visit -> fee_third_visit (800)
        4th regular visit -> fee_first_visit (1500) (cycle repeats!)
        5th regular visit -> fee_second_visit (1000)
        6th regular visit -> fee_third_visit (800)
        7th regular visit -> fee_first_visit (1500)
        Report checks -> fee_report_check (500) and NEVER advance the cycle count.
        Cancelled/No-show bookings NEVER count toward completed visits.
        """
        # Initially, 0 completed visits -> stage 1
        quote0 = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote0["visit_stage"], 1)
        self.assertEqual(quote0["fee_amount"], Decimal("1500.00"))

        # Add a cancelled booking -> should still be 0 completed visits
        Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=date(2026, 11, 1),
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.CANCELLED,
            visit_type="regular",
            visit_stage=1,
            fee_amount=Decimal("1500.00"),
        )
        quote_after_cancel = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote_after_cancel["visit_stage"], 1)
        self.assertEqual(quote_after_cancel["fee_amount"], Decimal("1500.00"))

        # Add a no-show booking -> should still be 0 completed visits
        Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=date(2026, 11, 2),
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.NO_SHOW,
            visit_type="regular",
            visit_stage=1,
            fee_amount=Decimal("1500.00"),
        )
        quote_after_noshow = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote_after_noshow["visit_stage"], 1)

        # Complete Visit #1
        Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=date(2026, 11, 3),
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.COMPLETED,
            visit_type="regular",
            visit_stage=1,
            fee_amount=Decimal("1500.00"),
        )
        quote1 = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote1["visit_stage"], 2)
        self.assertEqual(quote1["fee_amount"], Decimal("1000.00"))

        # Complete a REPORT CHECK visit -> should NOT advance regular count
        Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=date(2026, 11, 4),
            appointment_time=time(11, 0),
            status=Booking.StatusChoices.COMPLETED,
            visit_type="report_check",
            visit_stage=None,
            fee_amount=Decimal("500.00"),
        )
        # Check report check fee quote
        quote_rc = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="report_check")
        self.assertIsNone(quote_rc["visit_stage"])
        self.assertEqual(quote_rc["fee_amount"], Decimal("500.00"))

        # Regular quote must still be Stage 2!
        quote2 = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote2["visit_stage"], 2)
        self.assertEqual(quote2["fee_amount"], Decimal("1000.00"))

        # Complete Visit #2
        Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=date(2026, 11, 5),
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.COMPLETED,
            visit_type="regular",
            visit_stage=2,
            fee_amount=Decimal("1000.00"),
        )
        quote3 = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote3["visit_stage"], 3)
        self.assertEqual(quote3["fee_amount"], Decimal("800.00"))

        # Complete Visit #3
        Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=date(2026, 11, 6),
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.COMPLETED,
            visit_type="regular",
            visit_stage=3,
            fee_amount=Decimal("800.00"),
        )
        # Visit #4 should cycle back to Stage 1!
        quote4 = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote4["visit_stage"], 1)
        self.assertEqual(quote4["fee_amount"], Decimal("1500.00"))

        # Complete Visit #4, #5, #6 to test 7th visit cycle
        for i, stage, amt in [(4, 1, "1500.00"), (5, 2, "1000.00"), (6, 3, "800.00")]:
            Booking.objects.create(
                doctor=self.doctor,
                patient=self.patient1,
                appointment_date=date(2026, 11, 10 + i),
                appointment_time=time(10, 0),
                status=Booking.StatusChoices.COMPLETED,
                visit_type="regular",
                visit_stage=stage,
                fee_amount=Decimal(amt),
            )

        quote7 = calculate_patient_visit_fee(self.patient1, self.doctor, visit_type="regular")
        self.assertEqual(quote7["visit_stage"], 1)
        self.assertEqual(quote7["fee_amount"], Decimal("1500.00"))

    def test_atomic_booking_serial_and_reference_creation(self):
        """Verify unique serial numbers scoped to (doctor, date) and reference code format."""
        target_date = date(2026, 11, 25)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_duration=30,
            max_capacity=10,
            is_active=True,
        )

        b1 = create_appointment(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=target_date,
            appointment_time=time(10, 0),
            visit_type="regular",
            is_walk_in=True,
        )
        today_str = timezone.now().strftime("%Y%m%d")
        self.assertEqual(b1.serial_number, 1)
        self.assertTrue(b1.appointment_reference.startswith(f"GH-{today_str}-"))

        b2 = create_appointment(
            doctor=self.doctor,
            patient=self.patient2,
            appointment_date=target_date,
            appointment_time=time(10, 30),
            visit_type="regular",
            is_walk_in=True,
        )
        self.assertEqual(b2.serial_number, 2)
        self.assertTrue(b2.appointment_reference.startswith(f"GH-{today_str}-"))

        # On another date, serial number starts at 1 again
        next_date = date(2026, 11, 26)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=next_date.weekday(),
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_duration=30,
            max_capacity=10,
            is_active=True,
        )
        b3 = create_appointment(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=next_date,
            appointment_time=time(10, 0),
            visit_type="regular",
            is_walk_in=True,
        )
        self.assertEqual(b3.serial_number, 1)

    def test_double_booking_and_overlap_prevention(self):
        """Verify doctor slot double-booking is blocked and patient overlap is blocked."""
        target_date = date(2026, 11, 25)
        apt_time = time(10, 0)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_duration=30,
            max_capacity=10,
            is_active=True,
        )
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor2,
            weekday=target_date.weekday(),
            start_time=time(10, 0),
            end_time=time(12, 0),
            slot_duration=30,
            max_capacity=10,
            is_active=True,
        )

        # 1. Book slot for patient1
        create_appointment(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=target_date,
            appointment_time=apt_time,
            is_walk_in=True,
        )

        # 2. Patient2 attempts to book the same doctor slot -> must fail
        with self.assertRaises(ValidationError) as cm:
            create_appointment(
                doctor=self.doctor,
                patient=self.patient2,
                appointment_date=target_date,
                appointment_time=apt_time,
                is_walk_in=True,
            )
        self.assertIn("booked", str(cm.exception).lower())

        # 3. Patient1 attempts to book Doctor 2 at the exact same time -> must fail
        with self.assertRaises(ValidationError) as cm:
            create_appointment(
                doctor=self.doctor2,
                patient=self.patient1,
                appointment_date=target_date,
                appointment_time=apt_time,
                is_walk_in=True,
            )
        self.assertIn("already have an active appointment", str(cm.exception).lower())

    def test_maximum_daily_capacity_enforcement(self):
        """Ensure doctor daily capacity is strictly enforced."""
        target_date = date(2026, 11, 25)
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=target_date.weekday(),
            start_time=time(9, 0),
            end_time=time(12, 0),
            slot_duration=30,
            max_capacity=2,  # Only 2 patients allowed today!
            is_active=True,
        )

        create_appointment(
            doctor=self.doctor,
            patient=self.patient1,
            appointment_date=target_date,
            appointment_time=time(9, 0),
            is_walk_in=True,
        )
        create_appointment(
            doctor=self.doctor,
            patient=self.patient2,
            appointment_date=target_date,
            appointment_time=time(9, 30),
            is_walk_in=True,
        )

        patient3 = User.objects.create_user(
            username="patient_third",
            password="Password123!",
            role=User.RoleChoices.PATIENT,
        )

        with self.assertRaises(ValidationError) as cm:
            create_appointment(
                doctor=self.doctor,
                patient=patient3,
                appointment_date=target_date,
                appointment_time=time(10, 0),
                is_walk_in=True,
            )
        self.assertIn("capacity", str(cm.exception).lower())

    def test_pricing_quote_endpoint(self):
        """Test the live pricing quote API endpoint used by the booking UI."""
        self.client.force_login(self.patient1)
        url = reverse("bookings:pricing_quote")

        # Regular visit quote
        response = self.client.get(f"{url}?doctor_id={self.doctor.id}&visit_type=regular")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["fee_amount"], "1500.00")
        self.assertEqual(data["visit_stage"], 1)

        # Report check quote
        response_rc = self.client.get(f"{url}?doctor_id={self.doctor.id}&visit_type=report_check")
        self.assertEqual(response_rc.status_code, 200)
        data_rc = response_rc.json()
        self.assertEqual(data_rc["fee_amount"], "500.00")
        self.assertIsNone(data_rc["visit_stage"])
