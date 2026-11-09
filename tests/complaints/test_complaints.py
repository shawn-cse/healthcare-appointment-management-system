from datetime import date, time, timedelta
from decimal import Decimal
from django.test import TestCase, Client
from django.urls import reverse
from django.core.exceptions import ValidationError, PermissionDenied
from django.utils import timezone

from accounts.models import User, Profile, AuditLog
from bookings.models import Booking
from complaints.models import Complaint
from complaints.services import submit_complaint, review_complaint
from notifications.models import Notification


class ComplaintTests(TestCase):
    def setUp(self):
        self.client = Client()

        # Create Patient A
        self.patient_a = User.objects.create_user(
            username="patient_a",
            first_name="Rahim",
            last_name="Uddin",
            email="rahim@example.com",
            password="TestPassword123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient_a.profile.phone = "01711111111"
        self.patient_a.profile.save()

        # Create Patient B
        self.patient_b = User.objects.create_user(
            username="patient_b",
            first_name="Karim",
            last_name="Chowdhury",
            email="karim@example.com",
            password="TestPassword123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient_b.profile.phone = "01722222222"
        self.patient_b.profile.save()

        # Create Doctor 1
        self.doctor1 = User.objects.create_user(
            username="dr_tariq",
            first_name="Tariq",
            last_name="Islam",
            email="dr.tariq@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-778899",
            bmdc_verified=True,
        )

        # Create Doctor 2
        self.doctor2 = User.objects.create_user(
            username="dr_farhana",
            first_name="Farhana",
            last_name="Begum",
            email="dr.farhana@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-112244",
            bmdc_verified=True,
        )

        # Create Receptionist
        self.receptionist = User.objects.create_user(
            username="receptionist_jenny",
            first_name="Jenny",
            last_name="Akter",
            email="jenny@greenhospital.org",
            password="StaffPass123!",
            role=User.RoleChoices.RECEPTIONIST,
            status=User.StatusChoices.ACTIVE,
        )

        # Create Hospital Administrator
        self.hospital_admin = User.objects.create_user(
            username="hosp_admin",
            first_name="Kamal",
            last_name="Ahmed",
            email="admin.kamal@greenhospital.org",
            password="AdminPass123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Create Super Admin
        self.super_admin = User.objects.create_superuser(
            username="super_admin",
            first_name="CEO",
            last_name="Green",
            email="superadmin@greenhospital.org",
            password="SuperPass123!",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

        # Create an appointment for Patient A with Doctor 1
        self.booking_a1 = Booking.objects.create(
            patient=self.patient_a,
            doctor=self.doctor1,
            appointment_date=timezone.now().date() + timedelta(days=2),
            appointment_time=time(10, 0),
            status=Booking.StatusChoices.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            visit_type=Booking.VisitType.REGULAR,
            fee_amount=Decimal("1200.00"),
            payment_method=Booking.PaymentMethod.ONLINE,
            serial_number=1,
        )

    def test_submit_complaint_creates_record_and_auto_reference(self):
        complaint = submit_complaint(
            patient=self.patient_a,
            doctor=self.doctor1,
            category=Complaint.CategoryChoices.UNPROFESSIONAL_BEHAVIOR,
            subject="Doctor arrived 45 minutes late",
            description="The doctor arrived very late and was dismissive during the consultation.",
            booking=self.booking_a1,
        )

        self.assertIsNotNone(complaint.id)
        self.assertTrue(complaint.reference.startswith("CMP-"))
        self.assertEqual(complaint.status, Complaint.StatusChoices.SUBMITTED)
        self.assertEqual(complaint.patient, self.patient_a)
        self.assertEqual(complaint.doctor, self.doctor1)
        self.assertEqual(complaint.booking, self.booking_a1)

        # Check Audit Log
        audit = AuditLog.objects.filter(
            action=AuditLog.ActionChoices.COMPLAINT_FILED,
            target_user=self.doctor1,
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.patient_a)
        self.assertEqual(audit.details.get("reference"), complaint.reference)

        # Check notification sent to admin
        notif = Notification.objects.filter(
            recipient=self.hospital_admin,
            notification_type=Notification.NotificationType.COMPLAINT_UPDATE,
        ).first()
        self.assertIsNotNone(notif)
        self.assertIn(complaint.reference, notif.title)

    def test_submit_complaint_role_validations(self):
        # Doctor cannot submit complaint
        with self.assertRaises(PermissionDenied):
            submit_complaint(
                patient=self.doctor1,
                doctor=self.doctor2,
                category=Complaint.CategoryChoices.OTHER,
                subject="Test subject",
                description="Test description",
            )

        # Cannot submit complaint against a non-doctor
        with self.assertRaises(ValidationError):
            submit_complaint(
                patient=self.patient_a,
                doctor=self.receptionist,
                category=Complaint.CategoryChoices.OTHER,
                subject="Test subject",
                description="Test description",
            )

    def test_complaint_booking_validation(self):
        # Booking belongs to patient A, but doctor is Doctor 2 -> ValidationError
        with self.assertRaises(ValidationError):
            submit_complaint(
                patient=self.patient_a,
                doctor=self.doctor2,
                category=Complaint.CategoryChoices.OTHER,
                subject="Subject",
                description="Description",
                booking=self.booking_a1,  # booking_a1 has doctor1
            )

        # Patient B trying to reference Patient A's booking -> ValidationError
        with self.assertRaises(ValidationError):
            submit_complaint(
                patient=self.patient_b,
                doctor=self.doctor1,
                category=Complaint.CategoryChoices.OTHER,
                subject="Subject",
                description="Description",
                booking=self.booking_a1,
            )

    def test_anti_spam_rate_limiting(self):
        # Patient A submits 3 complaints within 24 hours
        for i in range(1, 4):
            submit_complaint(
                patient=self.patient_a,
                doctor=self.doctor1,
                category=Complaint.CategoryChoices.UNPROFESSIONAL_BEHAVIOR,
                subject=f"Complaint number {i}",
                description=f"Detailed description number {i} for rate limit testing.",
            )

        self.assertEqual(
            Complaint.objects.filter(patient=self.patient_a).count(),
            3,
        )

        # 4th submission within 24 hours must be rejected by anti-spam rate limiting
        with self.assertRaises(ValidationError) as ctx:
            submit_complaint(
                patient=self.patient_a,
                doctor=self.doctor1,
                category=Complaint.CategoryChoices.UNPROFESSIONAL_BEHAVIOR,
                subject="Complaint number 4 spam",
                description="This 4th complaint should trigger rate limit block.",
            )
        self.assertIn("limit of 3 complaints", str(ctx.exception))

    def test_patient_views_and_data_isolation(self):
        # Create complaint for Patient A
        complaint_a = submit_complaint(
            patient=self.patient_a,
            doctor=self.doctor1,
            category=Complaint.CategoryChoices.DIAGNOSIS_CONCERN,
            subject="Incorrect prescription dosage",
            description="Dosage given was incorrect according to standard guidelines.",
        )

        # Patient A can view list
        self.client.force_login(self.patient_a)
        response = self.client.get(reverse("complaints:patient-list"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, complaint_a.reference)

        # Patient A can view detail
        detail_response = self.client.get(
            reverse("complaints:patient-detail", kwargs={"pk": complaint_a.pk})
        )
        self.assertEqual(detail_response.status_code, 200)
        self.assertContains(detail_response, "Incorrect prescription dosage")

        # Patient B cannot view Patient A's complaint detail (returns 404 due to queryset isolation)
        self.client.force_login(self.patient_b)
        forbidden_response = self.client.get(
            reverse("complaints:patient-detail", kwargs={"pk": complaint_a.pk})
        )
        self.assertEqual(forbidden_response.status_code, 404)

        # Patient B's list should not contain Patient A's complaint
        b_list = self.client.get(reverse("complaints:patient-list"))
        self.assertEqual(b_list.status_code, 200)
        self.assertNotContains(b_list, complaint_a.reference)

    def test_doctors_and_receptionists_cannot_access_complaints(self):
        complaint = submit_complaint(
            patient=self.patient_a,
            doctor=self.doctor1,
            category=Complaint.CategoryChoices.BILLING_FEE_DISPUTE,
            subject="Charged extra fees",
            description="Staff charged an extra consultation fee without explanation.",
        )

        # Doctor 1 cannot access patient complaint list or admin complaint list
        self.client.force_login(self.doctor1)
        resp1 = self.client.get(reverse("complaints:patient-list"))
        self.assertEqual(resp1.status_code, 403)

        resp2 = self.client.get(reverse("complaints:admin-list"))
        self.assertEqual(resp2.status_code, 403)

        resp3 = self.client.get(
            reverse("complaints:admin-review", kwargs={"pk": complaint.pk})
        )
        self.assertEqual(resp3.status_code, 403)

        # Receptionist cannot access patient complaint list or admin complaint list
        self.client.force_login(self.receptionist)
        resp4 = self.client.get(reverse("complaints:admin-list"))
        self.assertEqual(resp4.status_code, 403)

        resp5 = self.client.get(
            reverse("complaints:admin-review", kwargs={"pk": complaint.pk})
        )
        self.assertEqual(resp5.status_code, 403)

    def test_admin_review_workflow_and_patient_notification(self):
        complaint = submit_complaint(
            patient=self.patient_a,
            doctor=self.doctor1,
            category=Complaint.CategoryChoices.WAIT_TIME,
            subject="Excessive wait time in chamber",
            description="Waited over 2 hours past the scheduled appointment slot.",
        )

        # Hospital admin reviews complaint
        self.client.force_login(self.hospital_admin)
        admin_list_resp = self.client.get(reverse("complaints:admin-list"))
        self.assertEqual(admin_list_resp.status_code, 200)
        self.assertContains(admin_list_resp, complaint.reference)

        # Submit review
        review_url = reverse("complaints:admin-review", kwargs={"pk": complaint.pk})
        post_data = {
            "status": Complaint.StatusChoices.RESOLVED,
            "admin_notes": "Spoke with Dr. Tariq regarding scheduling buffer times.",
            "admin_response": "We sincerely apologize for the delay. Corrective actions have been implemented.",
        }
        review_resp = self.client.post(review_url, data=post_data)
        self.assertEqual(review_resp.status_code, 302)

        # Verify updated complaint
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.StatusChoices.RESOLVED)
        self.assertEqual(complaint.reviewed_by, self.hospital_admin)
        self.assertIsNotNone(complaint.reviewed_at)
        self.assertIn("sincerely apologize", complaint.admin_response)

        # Verify Audit Log
        audit = AuditLog.objects.filter(
            action=AuditLog.ActionChoices.COMPLAINT_REVIEWED,
            target_user=self.patient_a,
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor, self.hospital_admin)
        self.assertEqual(audit.details.get("new_status"), Complaint.StatusChoices.RESOLVED)

        # Verify notification sent to patient
        patient_notif = Notification.objects.filter(
            recipient=self.patient_a,
            notification_type=Notification.NotificationType.COMPLAINT_UPDATE,
        ).first()
        self.assertIsNotNone(patient_notif)
        self.assertIn("Resolved", patient_notif.message)
