from django.db import models
from django.conf import settings
from django.utils import timezone


class Notification(models.Model):
    """
    In-app notification entity supporting read tracking, deep linking,
    and deduplication keys to prevent repeated event alerts.
    """
    class NotificationType(models.TextChoices):
        DOCTOR_REGISTRATION = "doctor_registration", "Doctor Registration"
        DOCTOR_APPROVAL = "doctor_approval", "Doctor Approval"
        DOCTOR_REJECTION = "doctor_rejection", "Doctor Rejection"
        BOOKING_CONFIRMED = "booking_confirmed", "Appointment Confirmed"
        BOOKING_REMINDER = "booking_reminder", "Appointment Reminder"
        BOOKING_CANCELLED = "booking_cancelled", "Appointment Cancelled"
        SESSION_CANCELLED = "session_cancelled", "Doctor Session Cancelled"
        PAYMENT_SUCCESS = "payment_success", "Payment Successful"
        PAYMENT_FAILED = "payment_failed", "Payment Failed"
        REFUND_REQUESTED = "refund_requested", "Refund Request Received"
        REFUND_APPROVED = "refund_approved", "Refund Approved"
        REFUND_REJECTED = "refund_rejected", "Refund Rejected"
        REFUND_COMPLETED = "refund_completed", "Refund Completed"
        COMPLAINT_UPDATE = "complaint_update", "Complaint Update"

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(
        max_length=40,
        choices=NotificationType.choices,
        default=NotificationType.BOOKING_CONFIRMED,
    )
    title = models.CharField(max_length=200)
    message = models.TextField()
    related_link = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="In-app URL or path to the relevant object or dashboard",
    )
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    deduplication_key = models.CharField(
        max_length=255,
        unique=True,
        null=True,
        blank=True,
        db_index=True,
        help_text="Unique key (e.g. payment_success_<tx_id>) preventing double-sending on repeated callbacks",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Notification"
        verbose_name_plural = "Notifications"

    def __str__(self):
        return f"[{self.get_notification_type_display()}] to {self.recipient.username}: {self.title}"

    def mark_as_read(self):
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=["is_read", "read_at"])
