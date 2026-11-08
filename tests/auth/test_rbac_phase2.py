from datetime import date, time
from django.contrib.auth import get_user_model
from django.test import TestCase, Client
from django.urls import reverse

from accounts.models import (
    User,
    ReceptionistDoctorAssignment,
    AuditLog,
)
from bookings.models import Booking


class RBACPhase2Tests(TestCase):
    def setUp(self):
        self.client = Client()

        # 1. Super Admin
        self.super_admin = User.objects.create_superuser(
            username="superadmin",
            email="superadmin@greenhospital.com",
            password="Password123!",
            first_name="Super",
            last_name="Admin",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # 2. Hospital Admin
        self.hospital_admin = User.objects.create_user(
            username="hospadmin",
            email="hospadmin@greenhospital.com",
            password="Password123!",
            first_name="Hospital",
            last_name="Admin",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
            is_staff=True,
        )

        # 3. Doctors
        self.doctor1 = User.objects.create_user(
            username="doctor1",
            email="doctor1@greenhospital.com",
            password="Password123!",
            first_name="Doctor",
            last_name="One",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
        )
        self.doctor2 = User.objects.create_user(
            username="doctor2",
            email="doctor2@greenhospital.com",
            password="Password123!",
            first_name="Doctor",
            last_name="Two",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
        )

        # 4. Receptionist
        self.receptionist = User.objects.create_user(
            username="receptionist1",
            email="receptionist1@greenhospital.com",
            password="Password123!",
            first_name="Receptionist",
            last_name="One",
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )

        # 5. Patients
        self.patient1 = User.objects.create_user(
            username="patient1",
            email="patient1@greenhospital.com",
            password="Password123!",
            first_name="Patient",
            last_name="One",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient2 = User.objects.create_user(
            username="patient2",
            email="patient2@greenhospital.com",
            password="Password123!",
            first_name="Patient",
            last_name="Two",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        # Sample Bookings
        self.booking_doc1_pat1 = Booking.objects.create(
            doctor=self.doctor1,
            patient=self.patient1,
            appointment_date=date(2026, 11, 20),
            appointment_time=time(10, 0),
            status="pending",
        )
        self.booking_doc2_pat2 = Booking.objects.create(
            doctor=self.doctor2,
            patient=self.patient2,
            appointment_date=date(2026, 11, 21),
            appointment_time=time(11, 0),
            status="pending",
        )

    def test_existing_account_compatibility(self):
        """Ensure existing accounts and flags map smoothly to new RBAC roles."""
        self.assertTrue(self.doctor1.is_doctor)
        self.assertFalse(self.doctor1.is_patient)
        self.assertTrue(self.patient1.is_patient)
        self.assertFalse(self.patient1.is_doctor)
        self.assertTrue(self.super_admin.is_super_admin)
        self.assertTrue(self.hospital_admin.is_hospital_admin)
        self.assertTrue(self.receptionist.is_receptionist)

        # Standard legacy superuser with role='patient' should still resolve is_super_admin=True
        legacy_admin = User.objects.create_user(
            username="legacyadmin",
            password="Password123!",
            role="patient",
            is_superuser=True,
            is_staff=True,
        )
        self.assertTrue(legacy_admin.is_super_admin)
        self.assertTrue(legacy_admin.is_staff_admin)
        self.assertTrue(legacy_admin.can_approve_refunds)

    def test_public_privilege_escalation_impossible(self):
        """Public doctor or patient registration must never grant staff or admin privileges."""
        # Tampered doctor registration payload
        doc_payload = {
            "first_name": "Malicious",
            "last_name": "Doctor",
            "username": "hacker_doc",
            "email": "hacker_doc@example.com",
            "bmdc_number": "A-77665",
            "qualifications": "MBBS",
            "department": "Surgery",
            "specialization": "General Surgery",
            "phone": "+8801700000001",
            "office_phone": "+8801800000001",
            "password1": "SecurePass123!",
            "password2": "SecurePass123!",
            "role": "super_admin",
            "is_staff": "true",
            "is_superuser": "true",
            "status": "active",
        }
        response = self.client.post(reverse("accounts:doctor-register"), doc_payload)
        user = User.objects.get(email="hacker_doc@example.com")
        self.assertEqual(user.role, User.RoleChoices.DOCTOR)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertEqual(user.status, User.StatusChoices.PENDING_APPROVAL)

        # Tampered patient registration payload
        pat_payload = {
            "first_name": "Malicious",
            "last_name": "Patient",
            "username": "hacker_pat",
            "password1": "SecurePass123!",
            "password2": "SecurePass123!",
            "role": "hospital_admin",
            "is_staff": "true",
            "is_superuser": "true",
        }
        response = self.client.post(reverse("accounts:patient-register"), pat_payload)
        user_pat = User.objects.get(username="hacker_pat")
        self.assertEqual(user_pat.role, User.RoleChoices.PATIENT)
        self.assertFalse(user_pat.is_staff)
        self.assertFalse(user_pat.is_superuser)
        self.assertEqual(user_pat.status, User.StatusChoices.ACTIVE)

    def test_unauthorized_and_cross_role_access_denied(self):
        """Cross-role access is denied across patient, doctor, and admin areas."""
        # Unauthenticated user visiting doctor dashboard -> redirected
        resp = self.client.get(reverse("doctors:dashboard"))
        self.assertEqual(resp.status_code, 302)

        # Patient visiting doctor dashboard -> denied
        self.client.force_login(self.patient1)
        resp = self.client.get(reverse("doctors:dashboard"))
        self.assertRedirects(resp, reverse("core:home"))

        # Patient visiting admin dashboard -> denied
        resp = self.client.get(reverse("admin-dashboard"))
        self.assertRedirects(resp, reverse("core:home"))

        # Doctor visiting admin dashboard -> denied
        self.client.force_login(self.doctor1)
        resp = self.client.get(reverse("admin-dashboard"))
        self.assertRedirects(resp, reverse("core:home"))

        # Doctor visiting patient dashboard -> denied
        resp = self.client.get(reverse("patients:dashboard"))
        self.assertRedirects(resp, reverse("core:home"))

        # Hospital admin CAN access admin dashboard
        self.client.force_login(self.hospital_admin)
        resp = self.client.get(reverse("admin-dashboard"))
        self.assertEqual(resp.status_code, 200)

    def test_doctor_to_doctor_data_isolation(self):
        """Doctor cannot view or mutate another doctor's private appointment."""
        self.client.force_login(self.doctor1)

        # Doctor 1 can view own appointment
        resp = self.client.get(
            reverse("doctors:appointment-detail", kwargs={"pk": self.booking_doc1_pat1.id})
        )
        self.assertEqual(resp.status_code, 200)

        # Doctor 1 CANNOT view Doctor 2's appointment
        resp = self.client.get(
            reverse("doctors:appointment-detail", kwargs={"pk": self.booking_doc2_pat2.id})
        )
        self.assertEqual(resp.status_code, 404)

        # Doctor 1 CANNOT cancel/accept Doctor 2's appointment (403 Forbidden)
        resp = self.client.post(
            reverse(
                "doctors:appointment-action",
                kwargs={"pk": self.booking_doc2_pat2.id, "action": "cancel"},
            )
        )
        self.assertEqual(resp.status_code, 403)

    def test_patient_to_patient_data_isolation(self):
        """Patient cannot view, print, or cancel another patient's appointment."""
        self.client.force_login(self.patient1)

        # Patient 1 can view own appointment
        resp = self.client.get(
            reverse("patients:appointment-detail", kwargs={"pk": self.booking_doc1_pat1.id})
        )
        self.assertEqual(resp.status_code, 200)

        # Patient 1 CANNOT view Patient 2's appointment
        resp = self.client.get(
            reverse("patients:appointment-detail", kwargs={"pk": self.booking_doc2_pat2.id})
        )
        self.assertEqual(resp.status_code, 404)

        # Patient 1 CANNOT view Patient 2's invoice
        resp = self.client.get(
            reverse("bookings:booking-invoice", kwargs={"booking_id": self.booking_doc2_pat2.id})
        )
        self.assertEqual(resp.status_code, 404)

        # Patient 1 CANNOT cancel Patient 2's appointment
        resp = self.client.post(
            reverse("patients:appointment-cancel", kwargs={"pk": self.booking_doc2_pat2.id})
        )
        self.assertEqual(resp.status_code, 404)

    def test_receptionist_assignment_restrictions(self):
        """Receptionist can only access doctors to whom they are explicitly assigned."""
        # Initially unassigned
        self.assertFalse(self.receptionist.can_access_doctor(self.doctor1))
        self.assertFalse(self.receptionist.can_access_doctor(self.doctor2))

        self.client.force_login(self.receptionist)
        # Attempting to view Doctor 1's appointments without assignment -> 403
        resp = self.client.get(
            reverse(
                "accounts:receptionist-doctor-appointments",
                kwargs={"doctor_id": self.doctor1.id},
            )
        )
        self.assertEqual(resp.status_code, 403)

        # Assign receptionist to Doctor 1 only
        ReceptionistDoctorAssignment.objects.create(
            receptionist=self.receptionist,
            doctor=self.doctor1,
            assigned_by=self.hospital_admin,
        )

        self.assertTrue(self.receptionist.can_access_doctor(self.doctor1))
        self.assertFalse(self.receptionist.can_access_doctor(self.doctor2))

        # Can now view Doctor 1 appointments
        resp = self.client.get(
            reverse(
                "accounts:receptionist-doctor-appointments",
                kwargs={"doctor_id": self.doctor1.id},
            )
        )
        self.assertEqual(resp.status_code, 200)

        # Still cannot view Doctor 2 appointments -> 403
        resp = self.client.get(
            reverse(
                "accounts:receptionist-doctor-appointments",
                kwargs={"doctor_id": self.doctor2.id},
            )
        )
        self.assertEqual(resp.status_code, 403)

        # Check-in patient for Doctor 1 succeeds
        resp = self.client.post(
            reverse("accounts:receptionist-check-in", kwargs={"pk": self.booking_doc1_pat1.id})
        )
        self.booking_doc1_pat1.refresh_from_db()
        self.assertEqual(self.booking_doc1_pat1.status, Booking.StatusChoices.CHECKED_IN)

        # Check-in patient for Doctor 2 fails with 403
        resp = self.client.post(
            reverse("accounts:receptionist-check-in", kwargs={"pk": self.booking_doc2_pat2.id})
        )
        self.assertEqual(resp.status_code, 403)

    def test_hospital_admin_cannot_approve_refunds(self):
        """Hospital Administrators cannot approve refunds. Only Super Admin can approve."""
        self.assertFalse(self.hospital_admin.can_approve_refunds)
        self.assertTrue(self.super_admin.can_approve_refunds)

        # Hospital Admin attempt -> 403 Forbidden
        self.client.force_login(self.hospital_admin)
        resp = self.client.post(
            reverse(
                "admin-refund-approve",
                kwargs={"booking_id": self.booking_doc1_pat1.id},
            )
        )
        self.assertEqual(resp.status_code, 403)

        # Super Admin attempt -> Success (redirect)
        self.client.force_login(self.super_admin)
        resp = self.client.post(
            reverse(
                "admin-refund-approve",
                kwargs={"booking_id": self.booking_doc1_pat1.id},
            )
        )
        self.assertEqual(resp.status_code, 302)

        # Audit log verification
        log = AuditLog.objects.filter(action=AuditLog.ActionChoices.REFUND_ACTION).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.actor, self.super_admin)

    def test_only_super_admin_can_grant_privileged_staff_roles(self):
        """Only Super Admin can access staff management and modify staff roles."""
        # Hospital Admin cannot access staff management
        self.client.force_login(self.hospital_admin)
        resp = self.client.get(reverse("admin-staff-management"))
        self.assertRedirects(resp, reverse("core:home"))

        # Super Admin can access staff management
        self.client.force_login(self.super_admin)
        resp = self.client.get(reverse("admin-staff-management"))
        self.assertEqual(resp.status_code, 200)

        # Super Admin can promote a user to Hospital Admin
        promote_resp = self.client.post(
            reverse("admin-staff-role-change", kwargs={"pk": self.patient2.id}),
            {"role": "hospital_admin", "status": "active"},
        )
        self.patient2.refresh_from_db()
        self.assertEqual(self.patient2.role, User.RoleChoices.HOSPITAL_ADMIN)
        self.assertTrue(self.patient2.is_staff)

        # Audit log verified
        log = AuditLog.objects.filter(
            action=AuditLog.ActionChoices.ROLE_CHANGE, target_user=self.patient2
        ).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.actor, self.super_admin)

    def test_suspended_and_rejected_accounts_blocked(self):
        """Suspended and rejected users cannot log in."""
        self.patient1.status = User.StatusChoices.SUSPENDED
        self.patient1.save()

        login_resp = self.client.post(
            reverse("accounts:login"),
            {"username": self.patient1.username, "password": "Password123!"},
        )
        self.assertFalse(login_resp.wsgi_request.user.is_authenticated)
        self.assertContains(login_resp, "account has been suspended")
