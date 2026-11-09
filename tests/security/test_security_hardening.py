from datetime import timedelta
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.exceptions import ValidationError, PermissionDenied
from django.utils import timezone

from accounts.models import User, AuditLog, log_audit_event
from accounts.forms import UserLoginForm
from bookings.models import Booking
from payments.models import PaymentTransaction, RefundRequest
from complaints.models import Complaint
from complaints.services import submit_complaint
from utils.file_utils import validate_image_file


class SecurityHardeningTests(TestCase):
    def setUp(self):
        self.client = Client()

        # Super Admin
        self.super_admin = User.objects.create_superuser(
            username="super_guard",
            first_name="Super",
            last_name="Admin",
            email="superguard@greenhospital.org",
            password="StrongPass123!",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Hospital Admin
        self.hospital_admin = User.objects.create_user(
            username="hosp_admin_sec",
            first_name="Hosp",
            last_name="Admin",
            email="hospadmin@greenhospital.org",
            password="StrongPass123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Approved Doctor
        self.doctor = User.objects.create_user(
            username="dr_secure",
            first_name="Secure",
            last_name="Doctor",
            email="dr.secure@greenhospital.org",
            password="StrongPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-554433",
            bmdc_verified=True,
        )

        # Pending Unapproved Doctor
        self.pending_doctor = User.objects.create_user(
            username="dr_pending_sec",
            first_name="Pending",
            last_name="Doctor",
            email="dr.pending@greenhospital.org",
            password="StrongPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.PENDING_APPROVAL,
            bmdc_number="BMDC-998811",
            bmdc_verified=False,
        )

        # Patient 1
        self.patient1 = User.objects.create_user(
            username="patient_one",
            first_name="Patient",
            last_name="One",
            email="patient1@example.com",
            password="StrongPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

        # Patient 2
        self.patient2 = User.objects.create_user(
            username="patient_two",
            first_name="Patient",
            last_name="Two",
            email="patient2@example.com",
            password="StrongPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )

    def test_login_open_redirect_sanitization(self):
        """Validates that external URLs in next parameter are rejected (Open Redirect prevention)."""
        malicious_url = "https://malicious-phishing-attacker.com/steal"

        response = self.client.post(
            f"{reverse('accounts:login')}?next={malicious_url}",
            {
                "username": "patient_one",
                "password": "StrongPass123!",
            },
        )
        self.assertEqual(response.status_code, 302)
        # Must NOT redirect to external phishing URL
        self.assertNotEqual(response.url, malicious_url)
        # Falls back to safe default
        self.assertEqual(response.url, "/")

        # Safe relative redirect should be honored
        safe_url = "/patients/dashboard/"
        safe_resp = self.client.post(
            f"{reverse('accounts:login')}?next={safe_url}",
            {
                "username": "patient_one",
                "password": "StrongPass123!",
            },
        )
        self.assertEqual(safe_resp.status_code, 302)
        self.assertEqual(safe_resp.url, safe_url)

    def test_login_anti_brute_force_lockout(self):
        """Validates that 5 failed login attempts trigger an anti-brute-force account lockout."""
        # Simulate 5 failed login attempts
        for _ in range(5):
            log_audit_event(
                actor=None,
                action=AuditLog.ActionChoices.LOGIN_FAILED,
                target_user=self.patient1,
                details={"reason": "invalid_password"},
            )

        # Form attempt (even with correct password) should be locked out
        form = UserLoginForm(
            data={"username": "patient_one", "password": "StrongPass123!"}
        )
        self.assertFalse(form.is_valid())
        self.assertIn("Account temporarily locked", str(form.errors))

    def test_super_admin_cannot_demote_or_suspend_self(self):
        """Super Admin cannot demote or suspend their own account to prevent lockout."""
        self.client.force_login(self.super_admin)
        url = reverse("admin-staff-role-change", kwargs={"pk": self.super_admin.pk})

        # Attempt self-demotion
        resp = self.client.post(url, {"role": User.RoleChoices.PATIENT})
        self.assertEqual(resp.status_code, 302)
        self.super_admin.refresh_from_db()
        self.assertEqual(self.super_admin.role, User.RoleChoices.SUPER_ADMIN)

        # Attempt self-suspension
        resp2 = self.client.post(url, {"status": User.StatusChoices.SUSPENDED})
        self.assertEqual(resp2.status_code, 302)
        self.super_admin.refresh_from_db()
        self.assertEqual(self.super_admin.status, User.StatusChoices.ACTIVE)

    def test_avatar_file_upload_validation(self):
        """Executable or malicious script uploads must be rejected."""
        # 1. Executable file
        bad_file = SimpleUploadedFile("payload.exe", b"MZ\x90\x00\x03\x00\x00\x00", content_type="application/octet-stream")
        with self.assertRaises(ValidationError) as ctx:
            validate_image_file(bad_file)
        self.assertIn("Unsupported file format", str(ctx.exception))

        # 2. PHP script
        php_file = SimpleUploadedFile("shell.php", b"<?php phpinfo(); ?>", content_type="application/x-php")
        with self.assertRaises(ValidationError) as ctx:
            validate_image_file(php_file)
        self.assertIn("Unsupported file format", str(ctx.exception))

        # 3. Valid PNG image
        good_file = SimpleUploadedFile("avatar.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", content_type="image/png")
        # Should not raise exception
        validate_image_file(good_file)

    def test_unapproved_doctor_cannot_manage_schedules(self):
        """Unapproved/pending doctor is blocked from accessing doctor scheduling."""
        self.client.force_login(self.pending_doctor)
        response = self.client.get(reverse("doctors:manage-schedules"))
        # Blocked and redirected to home with error
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.url, reverse("core:home"))

    def test_unauthorized_user_cannot_approve_refund(self):
        """Hospital Administrator is blocked from approving refunds."""
        booking = Booking.objects.create(
            patient=self.patient1,
            doctor=self.doctor,
            appointment_date=timezone.now().date() + timedelta(days=2),
            appointment_time=timezone.now().time(),
            status=Booking.StatusChoices.CANCELLED,
            payment_status=Booking.PaymentStatus.PAID,
            fee_amount=Decimal("1200.00"),
        )
        tx = PaymentTransaction.objects.create(
            booking=booking,
            patient=self.patient1,
            doctor=self.doctor,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            status=PaymentTransaction.Status.SUCCESS,
            transaction_reference="TRX-SEC-001",
        )
        refund_req = RefundRequest.objects.create(
            refund_reference="REF-SEC-001",
            booking=booking,
            payment_transaction=tx,
            patient=self.patient1,
            doctor=self.doctor,
            original_paid_amount=Decimal("1200.00"),
            eligible_refund_percentage=100,
            eligible_refund_amount=Decimal("1200.00"),
            requested_amount=Decimal("1200.00"),
            status=RefundRequest.Status.REQUESTED,
        )

        approve_url = reverse(
            "payments:superadmin-refund-approve",
            kwargs={"refund_reference": refund_req.refund_reference},
        )

        # Hospital Admin attempt -> 403 Forbidden
        self.client.force_login(self.hospital_admin)
        resp = self.client.post(approve_url)
        self.assertEqual(resp.status_code, 403)

        # Regular Doctor attempt -> 403 Forbidden
        self.client.force_login(self.doctor)
        resp2 = self.client.post(approve_url)
        self.assertEqual(resp2.status_code, 403)

        # Super Admin succeeds
        self.client.force_login(self.super_admin)
        resp3 = self.client.post(approve_url)
        self.assertEqual(resp3.status_code, 302)
        refund_req.refresh_from_db()
        self.assertEqual(refund_req.status, RefundRequest.Status.APPROVED)

    def test_object_level_data_isolation(self):
        """Cross-patient and cross-doctor data isolation checks."""
        # Booking for Patient 1
        booking1 = Booking.objects.create(
            patient=self.patient1,
            doctor=self.doctor,
            appointment_date=timezone.now().date() + timedelta(days=1),
            appointment_time=timezone.now().time(),
            status=Booking.StatusChoices.CONFIRMED,
            fee_amount=Decimal("1200.00"),
        )

        # Patient 2 attempts to view Patient 1's appointment detail -> 404
        self.client.force_login(self.patient2)
        resp1 = self.client.get(
            reverse("patients:appointment-detail", kwargs={"pk": booking1.pk})
        )
        self.assertEqual(resp1.status_code, 404)

        # Patient 1 lodges a complaint against Doctor
        complaint = submit_complaint(
            patient=self.patient1,
            doctor=self.doctor,
            category=Complaint.CategoryChoices.WAIT_TIME,
            subject="Wait time concern",
            description="Waited too long.",
            booking=booking1,
        )

        # Patient 2 attempts to view Patient 1's complaint -> 404
        resp2 = self.client.get(
            reverse("complaints:patient-detail", kwargs={"pk": complaint.pk})
        )
        self.assertEqual(resp2.status_code, 404)

        # Doctor cannot view private complaints against themselves -> 403
        self.client.force_login(self.doctor)
        resp3 = self.client.get(
            reverse("complaints:patient-detail", kwargs={"pk": complaint.pk})
        )
        self.assertEqual(resp3.status_code, 403)
        resp4 = self.client.get(reverse("complaints:admin-list"))
        self.assertEqual(resp4.status_code, 403)
