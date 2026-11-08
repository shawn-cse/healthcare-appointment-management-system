from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.core.exceptions import PermissionDenied
from django.utils import timezone

from accounts.models import User, Profile, DoctorFeeHistory, AuditLog
from accounts.forms import DoctorRegistrationForm
from doctors.forms import DoctorProfileForm


class DoctorPhase3Tests(TestCase):
    def setUp(self):
        self.client = Client()

        # Super Admin
        self.super_admin = User.objects.create_superuser(
            username="superadmin_test",
            email="superadmin@greenhospital.org",
            password="AdminPassword123!",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Hospital Admin
        self.hospital_admin = User.objects.create_user(
            username="hosp_admin_test",
            email="hospadmin@greenhospital.org",
            password="HospAdminPass123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Approved Doctor
        self.doctor = User.objects.create_user(
            username="dr_salim",
            first_name="Salim",
            last_name="Khan",
            email="salim@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="A-45678",
            bmdc_verified=True,
        )
        self.doctor.profile.department = "Cardiology"
        self.doctor.profile.specialization = "Interventional Cardiology"
        self.doctor.profile.chamber_number = "Room 302"
        self.doctor.profile.fee_first_visit = Decimal("1200.00")
        self.doctor.profile.fee_second_visit = Decimal("900.00")
        self.doctor.profile.fee_third_visit = Decimal("700.00")
        self.doctor.profile.fee_report_check = Decimal("400.00")
        self.doctor.profile.save()

        # Another Doctor
        self.doctor2 = User.objects.create_user(
            username="dr_fatima",
            first_name="Fatima",
            last_name="Begum",
            email="fatima@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="A-99887",
            bmdc_verified=True,
        )

    def test_doctor_registration_form_initial_status_pending(self):
        """Registering doctor has status PENDING_APPROVAL and bmdc_verified False."""
        form_data = {
            "first_name": "Tariq",
            "last_name": "Rahman",
            "username": "dr_tariq",
            "email": "tariq@hospital.com",
            "phone": "+8801711122233",
            "office_phone": "+88029876543",
            "qualifications": "MBBS, FCPS (Medicine)",
            "department": "Neurology",
            "specialization": "Clinical Neurology",
            "bmdc_number": "A-77712",
            "experience_notes": "5 years at Dhaka Medical College",
            "password1": "SecureDocPass123!",
            "password2": "SecureDocPass123!",
        }
        form = DoctorRegistrationForm(data=form_data)
        self.assertTrue(form.is_valid(), form.errors)
        user = form.save()

        self.assertEqual(user.role, User.RoleChoices.DOCTOR)
        self.assertEqual(user.status, User.StatusChoices.PENDING_APPROVAL)
        self.assertFalse(user.bmdc_verified)
        self.assertFalse(user.is_approved_doctor)
        self.assertEqual(user.bmdc_number, "A-77712")
        self.assertEqual(user.profile.department, "Neurology")
        self.assertEqual(user.profile.specialization, "Clinical Neurology")
        self.assertEqual(user.profile.office_phone, "+88029876543")

    def test_bmdc_number_uniqueness_enforced(self):
        """Duplicate BMDC registration numbers are rejected."""
        form_data = {
            "first_name": "Imposter",
            "last_name": "Doctor",
            "username": "dr_fake",
            "email": "fake@hospital.com",
            "phone": "+8801700000000",
            "qualifications": "MBBS",
            "department": "Cardiology",
            "specialization": "Cardiology",
            "bmdc_number": "A-45678",  # Already owned by dr_salim
            "password1": "SecureDocPass123!",
            "password2": "SecureDocPass123!",
        }
        form = DoctorRegistrationForm(data=form_data)
        self.assertFalse(form.is_valid())
        self.assertIn("bmdc_number", form.errors)

    def test_doctor_cannot_approve_themselves(self):
        """Server-side restriction: doctors cannot approve themselves."""
        pending_doc = User.objects.create_user(
            username="dr_pending",
            password="DocPassword123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
            bmdc_number="A-11111",
        )
        self.client.login(username="dr_pending", password="DocPassword123!")
        url = reverse("admin-doctor-approve", kwargs={"pk": pending_doc.id})
        resp = self.client.post(url)
        # Doctor is not an admin, gets 302 or 403
        self.assertIn(resp.status_code, [302, 403])
        pending_doc.refresh_from_db()
        self.assertEqual(pending_doc.status, User.StatusChoices.PENDING_APPROVAL)

    def test_hospital_admin_can_approve_doctor(self):
        """Hospital Administrator can approve a pending doctor."""
        pending_doc = User.objects.create_user(
            username="dr_pending2",
            password="DocPassword123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
            bmdc_number="A-22222",
        )
        self.client.login(username="hosp_admin_test", password="HospAdminPass123!")
        url = reverse("admin-doctor-approve", kwargs={"pk": pending_doc.id})
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, 302)

        pending_doc.refresh_from_db()
        self.assertEqual(pending_doc.status, User.StatusChoices.ACTIVE)
        self.assertTrue(pending_doc.is_approved_doctor)
        self.assertEqual(pending_doc.approved_by, self.hospital_admin)

    def test_hospital_admin_can_reject_doctor_with_reason(self):
        """Hospital Administrator can reject a registration with an explicit reason."""
        pending_doc = User.objects.create_user(
            username="dr_rejected",
            password="DocPassword123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
            bmdc_number="A-33333",
        )
        self.client.login(username="hosp_admin_test", password="HospAdminPass123!")
        url = reverse("admin-doctor-reject", kwargs={"pk": pending_doc.id})
        resp = self.client.post(url, {"rejection_reason": "BMDC number not found in registry."})
        self.assertEqual(resp.status_code, 302)

        pending_doc.refresh_from_db()
        self.assertEqual(pending_doc.status, User.StatusChoices.REJECTED)
        self.assertEqual(pending_doc.rejection_reason, "BMDC number not found in registry.")

    def test_manual_bmdc_verification_workflow(self):
        """Hospital Administrator can manually verify BMDC registration without automated claim."""
        unverified_doc = User.objects.create_user(
            username="dr_unverified",
            password="DocPassword123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
            bmdc_number="A-44444",
            bmdc_verified=False,
        )
        self.client.login(username="hosp_admin_test", password="HospAdminPass123!")
        url = reverse("admin-doctor-verify-bmdc", kwargs={"pk": unverified_doc.id})
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, 302)

        unverified_doc.refresh_from_db()
        self.assertTrue(unverified_doc.bmdc_verified)
        self.assertEqual(unverified_doc.bmdc_verified_by, self.hospital_admin)
        self.assertIsNotNone(unverified_doc.bmdc_verified_at)

    def test_doctor_profile_updating_bmdc_requires_reverification(self):
        """When a doctor edits their BMDC registration number, status reverts to PENDING_APPROVAL."""
        form_data = {
            "first_name": "Salim",
            "last_name": "Khan",
            "email": "salim@greenhospital.org",
            "bmdc_number": "A-99999",  # Changed from A-45678
            "phone": "+8801711111111",
            "office_phone": "+88028888888",
            "specialization": "Interventional Cardiology",
            "chamber_number": "Room 302",
            "fee_first_visit": "1200.00",
            "fee_second_visit": "900.00",
            "fee_third_visit": "700.00",
            "fee_report_check": "400.00",
        }
        form = DoctorProfileForm(instance=self.doctor, data=form_data)
        self.assertTrue(form.is_valid(), form.errors)
        saved_doc = form.save()

        saved_doc.refresh_from_db()
        self.assertEqual(saved_doc.bmdc_number, "A-99999")
        self.assertFalse(saved_doc.bmdc_verified)
        self.assertEqual(saved_doc.status, User.StatusChoices.PENDING_APPROVAL)
        self.assertFalse(saved_doc.is_approved_doctor)

    def test_consultation_fees_decimal_safety_and_history(self):
        """Updating consultation fees records an entry in DoctorFeeHistory."""
        initial_history_count = DoctorFeeHistory.objects.filter(doctor=self.doctor).count()
        form_data = {
            "first_name": "Salim",
            "last_name": "Khan",
            "email": "salim@greenhospital.org",
            "bmdc_number": "A-45678",  # Unchanged
            "fee_first_visit": "1500.00",
            "fee_second_visit": "1100.00",
            "fee_third_visit": "850.00",
            "fee_report_check": "500.00",
        }
        form = DoctorProfileForm(instance=self.doctor, data=form_data)
        self.assertTrue(form.is_valid(), form.errors)
        form.save()

        self.doctor.profile.refresh_from_db()
        self.assertEqual(self.doctor.profile.fee_first_visit, Decimal("1500.00"))
        self.assertEqual(self.doctor.profile.fee_second_visit, Decimal("1100.00"))
        self.assertEqual(self.doctor.profile.fee_third_visit, Decimal("850.00"))
        self.assertEqual(self.doctor.profile.fee_report_check, Decimal("500.00"))

        new_history = DoctorFeeHistory.objects.filter(doctor=self.doctor)
        self.assertEqual(new_history.count(), initial_history_count + 1)
        latest = new_history.first()
        self.assertEqual(latest.fee_first_visit, Decimal("1500.00"))
        self.assertEqual(latest.fee_report_check, Decimal("500.00"))

    def test_unapproved_doctors_hidden_from_public_directory(self):
        """Unapproved and suspended doctors do not appear in public doctor list."""
        unapproved = User.objects.create_user(
            username="dr_hidden",
            first_name="Secret",
            last_name="Doctor",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
            bmdc_number="A-00001",
        )
        resp = self.client.get(reverse("doctors:list"))
        self.assertEqual(resp.status_code, 200)
        doctor_list = resp.context["doctors"]
        doctor_ids = [d.id for d in doctor_list]
        self.assertIn(self.doctor.id, doctor_ids)
        self.assertNotIn(unapproved.id, doctor_ids)
