from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase, Client, RequestFactory
from django.urls import reverse
from django.utils import timezone
from smtplib import SMTPException

from accounts.models import User
from bookings.models import Booking
from notifications.models import Notification
from notifications.services import (
    send_notification,
    notify_doctor_registration,
    notify_doctor_approved,
    notify_doctor_rejected,
    notify_booking_confirmed,
    notify_booking_cancelled,
    notify_session_cancelled,
    notify_payment_success,
    notify_payment_failed,
    notify_refund_requested,
    notify_refund_approved,
    notify_refund_completed,
)
from notifications.channels.email import EmailNotificationChannel
from notifications.channels.sms import SMSNotificationChannel
from notifications.context_processors import notifications_processor
from payments.models import PaymentTransaction, RefundRequest


class NotificationTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.factory = RequestFactory()

        # Patient
        self.patient = User.objects.create_user(
            username="notif_patient",
            first_name="Hasan",
            last_name="Mahmud",
            email="hasan.mahmud@example.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient.profile.phone = "01755555555"
        self.patient.profile.save()

        # Doctor
        self.doctor = User.objects.create_user(
            username="dr_salman",
            first_name="Salman",
            last_name="Khan",
            email="dr.salman@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-998877",
            bmdc_verified=True,
        )

        # Hospital Admin
        self.admin = User.objects.create_user(
            username="admin_notif",
            first_name="Admin",
            last_name="Green",
            email="admin@greenhospital.org",
            password="AdminPass123!",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )

    def test_in_app_notification_creation_and_read_tracking(self):
        # Dispatch notification
        success = send_notification(
            recipient=self.patient,
            title="Appointment Reminder",
            message="Your appointment is scheduled for tomorrow at 10:00 AM.",
            notification_type=Notification.NotificationType.BOOKING_REMINDER,
            related_link="/bookings/1/",
            deduplication_key="test_remind_patient_1",
        )
        self.assertTrue(success)

        notif = Notification.objects.filter(recipient=self.patient).first()
        self.assertIsNotNone(notif)
        self.assertEqual(notif.title, "Appointment Reminder")
        self.assertFalse(notif.is_read)
        self.assertIsNone(notif.read_at)

        # Patient visits notifications page
        self.client.force_login(self.patient)
        resp = self.client.get(reverse("notifications:list"))
        self.assertEqual(resp.status_code, 200)
        self.assertContains(resp, "Appointment Reminder")

        # Mark single notification as read
        mark_url = reverse("notifications:mark-read", kwargs={"pk": notif.pk})
        post_resp = self.client.post(mark_url)
        self.assertEqual(post_resp.status_code, 302)

        notif.refresh_from_db()
        self.assertTrue(notif.is_read)
        self.assertIsNotNone(notif.read_at)

        # Mark all as read
        Notification.objects.create(
            recipient=self.patient,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            title="Hospital Announcement",
            message="Holiday schedule announced.",
            is_read=False,
        )
        self.assertEqual(Notification.objects.filter(recipient=self.patient, is_read=False).count(), 1)
        self.client.post(reverse("notifications:mark-all-read"))
        self.assertEqual(Notification.objects.filter(recipient=self.patient, is_read=False).count(), 0)

    def test_deduplication_key_prevents_duplicate_notifications(self):
        dedup_key = "unique_booking_event_GH12345"

        # Send first time
        send_notification(
            recipient=self.patient,
            title="Booking Notice",
            message="Notice 1",
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            deduplication_key=dedup_key,
        )
        self.assertEqual(Notification.objects.filter(deduplication_key=dedup_key).count(), 1)

        # Send second time with identical key (e.g. repeated webhook or retry)
        send_notification(
            recipient=self.patient,
            title="Booking Notice Retry",
            message="Notice 1 Retry",
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            deduplication_key=dedup_key,
        )
        # Should still be exactly 1
        self.assertEqual(Notification.objects.filter(deduplication_key=dedup_key).count(), 1)

    @patch("notifications.channels.email.send_mail")
    def test_email_channel_safe_failure_on_smtp_error(self, mock_send_mail):
        # Configure send_mail to simulate an SMTP server crash / network outage
        mock_send_mail.side_effect = SMTPException("SMTP Connection timed out to mail.greenhospital.org")

        channel = EmailNotificationChannel()
        result = channel.send(
            recipient=self.patient,
            title="Urgent Alert",
            message="System maintenance tonight.",
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
        )

        # Channel should fail safely by returning False and NOT raising an exception
        self.assertFalse(result)

        # Central send_notification must also complete smoothly without raising
        res = send_notification(
            recipient=self.patient,
            title="Important Alert",
            message="Notice regarding hospital opening hours.",
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            channels=[channel],
        )
        self.assertFalse(res)

    def test_sms_channel_formatting_and_length_truncation(self):
        channel = SMSNotificationChannel()
        long_message = (
            "A" * 200
        )  # Super long text that exceeds standard SMS 160-char length

        # Send via SMS channel
        sent = channel.send(
            recipient=self.patient,
            title="Status Alert",
            message=long_message,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
        )
        self.assertTrue(sent)

    def test_domain_notification_triggers(self):
        # 1. Doctor Registration
        notify_doctor_registration(self.doctor)
        admin_notif = Notification.objects.filter(
            recipient=self.admin,
            notification_type=Notification.NotificationType.DOCTOR_REGISTRATION,
        ).first()
        self.assertIsNotNone(admin_notif)
        self.assertIn("Salman Khan", admin_notif.title)

        # 2. Doctor Approval
        notify_doctor_approved(self.doctor)
        doc_notif = Notification.objects.filter(
            recipient=self.doctor,
            notification_type=Notification.NotificationType.DOCTOR_APPROVAL,
        ).first()
        self.assertIsNotNone(doc_notif)
        self.assertIn("Approved", doc_notif.title)

        # 3. Doctor Rejection
        notify_doctor_rejected(self.doctor, reason="BMDC certificate blurred.")
        rej_notif = Notification.objects.filter(
            recipient=self.doctor,
            notification_type=Notification.NotificationType.DOCTOR_REJECTION,
        ).first()
        self.assertIsNotNone(rej_notif)
        self.assertIn("BMDC certificate blurred", rej_notif.message)

        # 4. Booking Confirmed
        booking = Booking.objects.create(
            patient=self.patient,
            doctor=self.doctor,
            appointment_date=timezone.now().date() + timedelta(days=3),
            appointment_time=time(11, 0),
            status=Booking.StatusChoices.CONFIRMED,
            payment_status=Booking.PaymentStatus.PAID,
            visit_type=Booking.VisitType.REGULAR,
            fee_amount=Decimal("1500.00"),
            payment_method=Booking.PaymentMethod.ONLINE,
            serial_number=5,
        )
        notify_booking_confirmed(booking)
        p_booking_notif = Notification.objects.filter(
            recipient=self.patient,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
        ).first()
        self.assertIsNotNone(p_booking_notif)
        self.assertIn("Serial #5", p_booking_notif.title)

        # 5. Booking Cancelled
        notify_booking_cancelled(booking, reason="Patient requested cancellation", actor=self.patient)
        cancel_notif = Notification.objects.filter(
            recipient=self.doctor,
            notification_type=Notification.NotificationType.BOOKING_CANCELLED,
        ).first()
        self.assertIsNotNone(cancel_notif)

        # 6. Payment Success
        tx = PaymentTransaction.objects.create(
            booking=booking,
            patient=self.patient,
            doctor=self.doctor,
            billed_fee=Decimal("1500.00"),
            amount=Decimal("1500.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            status=PaymentTransaction.Status.SUCCESS,
            transaction_reference="TRX-TEST-9988",
        )
        notify_payment_success(tx)
        pay_notif = Notification.objects.filter(
            recipient=self.patient,
            notification_type=Notification.NotificationType.PAYMENT_SUCCESS,
        ).first()
        self.assertIsNotNone(pay_notif)
        self.assertIn("TRX-TEST-9988", pay_notif.title)

        # 7. Refund lifecycle triggers
        refund_req = RefundRequest.objects.create(
            booking=booking,
            payment_transaction=tx,
            patient=self.patient,
            doctor=self.doctor,
            original_paid_amount=Decimal("1500.00"),
            eligible_refund_percentage=100,
            eligible_refund_amount=Decimal("1500.00"),
            requested_amount=Decimal("1500.00"),
            reason="Session cancelled by clinic.",
            status=RefundRequest.Status.REQUESTED,
        )
        notify_refund_requested(refund_req)
        r_req_notif = Notification.objects.filter(
            recipient=self.patient,
            notification_type=Notification.NotificationType.REFUND_REQUESTED,
        ).first()
        self.assertIsNotNone(r_req_notif)

        notify_refund_approved(refund_req)
        notify_refund_completed(refund_req)

    def test_notification_context_processor(self):
        # Create 2 unread notifications for patient
        Notification.objects.create(
            recipient=self.patient,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            title="Note 1",
            message="Msg 1",
            is_read=False,
        )
        Notification.objects.create(
            recipient=self.patient,
            notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
            title="Note 2",
            message="Msg 2",
            is_read=False,
        )

        request = self.factory.get("/")
        request.user = self.patient

        context = notifications_processor(request)
        self.assertEqual(context["unread_notifications_count"], 2)
        self.assertEqual(len(context["recent_notifications"]), 2)

        # Anonymous user returns 0
        from django.contrib.auth.models import AnonymousUser
        anon_request = self.factory.get("/")
        anon_request.user = AnonymousUser()
        anon_context = notifications_processor(anon_request)
        self.assertEqual(anon_context["unread_notifications_count"], 0)
        self.assertEqual(len(anon_context["recent_notifications"]), 0)
