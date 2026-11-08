from datetime import datetime, date, time, timedelta
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from accounts.models import User, Profile, AuditLog, ReceptionistDoctorAssignment
from bookings.models import Booking, Prescription
from doctors.models import DoctorWeeklySchedule
from doctors.services.availability import DHAKA_TZ


class DashboardsAndWorkflowsPhase6Tests(TestCase):
    def setUp(self):
        self.client = Client()

        # Doctor 1 (Dr. Salim)
        self.doctor1 = User.objects.create_user(
            username="dr_salim_phase6",
            first_name="Salim",
            last_name="Khan",
            email="salim.phase6@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="A-11223",
            bmdc_verified=True,
        )
        self.doctor1.profile.department = "Cardiology"
        self.doctor1.profile.chamber_number = "Room 301"
        self.doctor1.profile.fee_first_visit = Decimal("1200.00")
        self.doctor1.profile.fee_second_visit = Decimal("900.00")
        self.doctor1.profile.fee_third_visit = Decimal("700.00")
        self.doctor1.profile.fee_report_check = Decimal("400.00")
        self.doctor1.profile.save()

        # Doctor 2 (Dr. Fatima)
        self.doctor2 = User.objects.create_user(
            username="dr_fatima_phase6",
            first_name="Fatima",
            last_name="Begum",
            email="fatima.phase6@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="A-33445",
            bmdc_verified=True,
        )
        self.doctor2.profile.department = "Neurology"
        self.doctor2.profile.chamber_number = "Room 401"
        self.doctor2.profile.fee_first_visit = Decimal("1500.00")
        self.doctor2.profile.save()

        # Receptionist (Assigned ONLY to Doctor 1)
        self.receptionist = User.objects.create_user(
            username="receptionist_tania",
            first_name="Tania",
            last_name="Sultana",
            email="tania@greenhospital.org",
            password="StaffPass123!",
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )
        ReceptionistDoctorAssignment.objects.create(
            receptionist=self.receptionist,
            doctor=self.doctor1,
        )

        # Patients
        self.patient_a = User.objects.create_user(
            username="patient_anis",
            first_name="Anisur",
            last_name="Rahman",
            email="anis@gmail.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient_b = User.objects.create_user(
            username="patient_bithi",
            first_name="Bithi",
            last_name="Akter",
            email="bithi@gmail.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        self.today = timezone.now().date()

        # Schedule for Doctor 1 today
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor1,
            weekday=self.today.weekday(),
            start_time=time(9, 0),
            end_time=time(13, 0),
            slot_duration=30,
            max_capacity=10,
            chamber_number="Room 301",
            is_active=True,
        )

        # Bookings for Doctor 1 today
        self.booking_d1_p1 = Booking.objects.create(
            doctor=self.doctor1,
            patient=self.patient_a,
            appointment_date=self.today,
            appointment_time=time(9, 0),
            serial_number=1,
            chamber="Room 301",
            visit_type="regular",
            visit_stage=1,
            fee_amount=Decimal("1200.00"),
            status=Booking.StatusChoices.CONFIRMED,
        )
        self.booking_d1_p2 = Booking.objects.create(
            doctor=self.doctor1,
            patient=self.patient_b,
            appointment_date=self.today,
            appointment_time=time(9, 30),
            serial_number=2,
            chamber="Room 301",
            visit_type="regular",
            visit_stage=1,
            fee_amount=Decimal("1200.00"),
            status=Booking.StatusChoices.CONFIRMED,
        )

        # Booking for Doctor 2 today
        self.booking_d2_p1 = Booking.objects.create(
            doctor=self.doctor2,
            patient=self.patient_a,
            appointment_date=self.today,
            appointment_time=time(14, 0),
            serial_number=1,
            chamber="Room 401",
            visit_type="regular",
            visit_stage=1,
            fee_amount=Decimal("1500.00"),
            status=Booking.StatusChoices.CONFIRMED,
        )

    def test_doctor_dashboard_scoping_and_serial_ordering(self):
        """Doctor dashboard shows only own appointments ordered by serial number."""
        self.client.force_login(self.doctor1)
        response = self.client.get(reverse("doctors:dashboard"))
        self.assertEqual(response.status_code, 200)

        # Appointments in context must be strictly Doctor 1's
        today_appointments = response.context["today_appointments"]
        self.assertEqual(len(today_appointments), 2)
        self.assertEqual(today_appointments[0].id, self.booking_d1_p1.id)
        self.assertEqual(today_appointments[1].id, self.booking_d1_p2.id)

        # Ensure Doctor 2's booking is NOT in Doctor 1's dashboard
        booking_ids = [b.id for b in today_appointments]
        self.assertNotIn(self.booking_d2_p1.id, booking_ids)

        # Check capacity metrics in context
        self.assertEqual(response.context["today_patients"], 2)
        self.assertEqual(response.context["daily_max_capacity"], 10)
        self.assertEqual(response.context["daily_remaining_capacity"], 8)

    def test_doctor_completes_consultation_and_records_prescription(self):
        """Doctor completes consultation, creates prescription, and advances visit cycle."""
        self.client.force_login(self.doctor1)
        url = reverse("doctors:appointment-complete", kwargs={"pk": self.booking_d1_p1.id})

        response = self.client.post(
            url,
            {
                "diagnosis": "Essential Hypertension",
                "symptoms": "Occasional headaches, elevated BP 145/95",
                "medications": "Tab. Amlodipine 5mg 1+0+0 for 30 days",
                "notes": "Reduce salt intake and review after 1 month.",
            },
            follow=True,
        )
        self.assertEqual(response.status_code, 200)

        self.booking_d1_p1.refresh_from_db()
        self.assertEqual(self.booking_d1_p1.status, Booking.StatusChoices.COMPLETED)
        self.assertIsNotNone(self.booking_d1_p1.completed_at)

        # Verify prescription was created
        prescription = Prescription.objects.get(booking=self.booking_d1_p1)
        self.assertEqual(prescription.doctor, self.doctor1)
        self.assertEqual(prescription.patient, self.patient_a)
        self.assertEqual(prescription.diagnosis, "Essential Hypertension")

        # Verify audit log was recorded
        audit = AuditLog.objects.filter(
            action=AuditLog.ActionChoices.APPOINTMENT_COMPLETED,
            actor=self.doctor1,
        ).first()
        self.assertIsNotNone(audit)

    def test_doctor_marks_no_show_and_cancels(self):
        """Doctor marks appointment as no-show or cancelled."""
        self.client.force_login(self.doctor1)

        # No Show
        url_noshow = reverse("doctors:appointment-no-show", kwargs={"pk": self.booking_d1_p1.id})
        self.client.post(url_noshow, follow=True)
        self.booking_d1_p1.refresh_from_db()
        self.assertEqual(self.booking_d1_p1.status, Booking.StatusChoices.NO_SHOW)

        # Cancel
        url_cancel = reverse("doctors:appointment-cancel", kwargs={"pk": self.booking_d1_p2.id})
        self.client.post(url_cancel, {"cancellation_reason": "Patient called to cancel."}, follow=True)
        self.booking_d1_p2.refresh_from_db()
        self.assertEqual(self.booking_d1_p2.status, Booking.StatusChoices.CANCELLED)
        self.assertEqual(self.booking_d1_p2.cancellation_reason, "Patient called to cancel.")

    def test_receptionist_dashboard_assigned_doctors_scoping(self):
        """Receptionist sees only assigned doctors' appointments; unassigned doctor access denied."""
        self.client.force_login(self.receptionist)
        response = self.client.get(reverse("accounts:receptionist-dashboard"))
        self.assertEqual(response.status_code, 200)

        # Assigned doctors list must contain Doctor 1 and NOT Doctor 2
        assigned_doctors = response.context["assigned_doctors"]
        self.assertIn(self.doctor1, assigned_doctors)
        self.assertNotIn(self.doctor2, assigned_doctors)

        # Today's appointments on receptionist dashboard must only have Doctor 1's appointments
        dashboard_bookings = response.context["today_appointments"]
        d_ids = [b.id for b in dashboard_bookings]
        self.assertIn(self.booking_d1_p1.id, d_ids)
        self.assertNotIn(self.booking_d2_p1.id, d_ids)

        # Receptionist attempts to view unassigned Doctor 2's appointments -> PermissionDenied (403)
        url_d2 = reverse(
            "accounts:receptionist-doctor-appointments",
            kwargs={"doctor_id": self.doctor2.id},
        )
        response_d2 = self.client.get(url_d2)
        self.assertEqual(response_d2.status_code, 403)

    def test_receptionist_patient_check_in(self):
        """Receptionist checks in patient for assigned doctor, but is blocked for unassigned doctor."""
        self.client.force_login(self.receptionist)

        # Check-in for assigned doctor
        url_checkin = reverse("accounts:receptionist-check-in", kwargs={"pk": self.booking_d1_p1.id})
        res = self.client.post(url_checkin, follow=True)
        self.assertEqual(res.status_code, 200)

        self.booking_d1_p1.refresh_from_db()
        self.assertEqual(self.booking_d1_p1.status, Booking.StatusChoices.CHECKED_IN)
        self.assertIsNotNone(self.booking_d1_p1.checked_in_at)

        # Attempting check-in on unassigned doctor's appointment -> 403
        url_checkin_unassigned = reverse(
            "accounts:receptionist-check-in",
            kwargs={"pk": self.booking_d2_p1.id},
        )
        res_unassigned = self.client.post(url_checkin_unassigned)
        self.assertEqual(res_unassigned.status_code, 403)

    def test_receptionist_walk_in_booking_creation(self):
        """Receptionist creates walk-in booking for assigned doctor; respects slot & fee calculation."""
        self.client.force_login(self.receptionist)
        url = reverse(
            "accounts:receptionist-walk-in-doctor",
            kwargs={"doctor_id": self.doctor1.id},
        )

        response = self.client.post(
            url,
            {
                "patient_type": "existing",
                "patient_id": self.patient_a.id,
                "appointment_date": str(self.today),
                "appointment_time": "10:00",
                "visit_type": "regular",
                "admin_notes": "Walk-in patient registered at desk.",
            },
            follow=True,
        )
        self.assertEqual(response.status_code, 200)

        # Check created booking
        new_booking = Booking.objects.get(
            doctor=self.doctor1,
            patient=self.patient_a,
            appointment_date=self.today,
            appointment_time=time(10, 0),
        )
        self.assertEqual(new_booking.serial_number, 3)
        self.assertEqual(new_booking.chamber, "Room 301")
        self.assertEqual(new_booking.fee_amount, Decimal("1200.00"))
        self.assertEqual(new_booking.status, Booking.StatusChoices.CONFIRMED)

    def test_booking_state_machine_validations(self):
        """Verify strict state machine transitions and rejections of illegal transitions."""
        booking = self.booking_d1_p1

        # confirmed -> checked_in (valid)
        self.assertTrue(booking.can_transition_to(Booking.StatusChoices.CHECKED_IN))
        booking.transition_to(Booking.StatusChoices.CHECKED_IN, actor=self.receptionist)
        self.assertEqual(booking.status, Booking.StatusChoices.CHECKED_IN)

        # checked_in -> completed (valid)
        self.assertTrue(booking.can_transition_to(Booking.StatusChoices.COMPLETED))
        booking.transition_to(Booking.StatusChoices.COMPLETED, actor=self.doctor1)
        self.assertEqual(booking.status, Booking.StatusChoices.COMPLETED)

        # completed -> confirmed (ILLEGAL! Completed is terminal)
        self.assertFalse(booking.can_transition_to(Booking.StatusChoices.CONFIRMED))
        with self.assertRaises(ValidationError):
            booking.transition_to(Booking.StatusChoices.CONFIRMED, actor=self.doctor1)

        # completed -> cancelled (ILLEGAL!)
        self.assertFalse(booking.can_transition_to(Booking.StatusChoices.CANCELLED))
        with self.assertRaises(ValidationError):
            booking.transition_to(Booking.StatusChoices.CANCELLED, actor=self.doctor1)
