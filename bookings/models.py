from decimal import Decimal
import secrets
from django.db import models
from django.conf import settings
from django.utils import timezone
from django.core.exceptions import ValidationError
from ckeditor.fields import RichTextField


def generate_appointment_reference():
    """Generates unique appointment reference e.g. GH-20261108-A1B2C3"""
    date_str = timezone.now().strftime("%Y%m%d")
    hex_token = secrets.token_hex(3).upper()
    return f"GH-{date_str}-{hex_token}"


class Booking(models.Model):
    class VisitType(models.TextChoices):
        REGULAR = "regular", "Regular Consultation"
        REPORT_CHECK = "report_check", "Report Checking"

    class PaymentMethod(models.TextChoices):
        PAY_AT_CHAMBER = "pay_at_chamber", "Pay at Chamber"
        ONLINE = "online", "Online Payment"

    class PaymentStatus(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PAID = "paid", "Paid"
        PARTIALLY_REFUNDED = "partially_refunded", "Partially Refunded"
        REFUNDED = "refunded", "Refunded"
        FAILED = "failed", "Failed"

    class StatusChoices(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        CHECKED_IN = "checked_in", "Checked In"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        NO_SHOW = "no_show", "No Show"

    appointment_reference = models.CharField(
        max_length=32,
        unique=True,
        null=True,
        blank=True,
        db_index=True,
        help_text="Unique verifiable reference for this appointment",
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="appointments",
        limit_choices_to={"role": "doctor"},
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="patient_appointments",
        limit_choices_to={"role": "patient"},
    )
    appointment_date = models.DateField()
    appointment_time = models.TimeField()
    serial_number = models.PositiveIntegerField(
        default=1,
        help_text="Daily patient serial number scoped to doctor and date",
    )
    chamber = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Chamber or room designated for consultation",
    )
    visit_type = models.CharField(
        max_length=20,
        choices=VisitType.choices,
        default=VisitType.REGULAR,
    )
    visit_stage = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        help_text="Regular visit sequence stage (1, 2, or 3). Null for report check.",
    )
    fee_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Locked price snapshot in BDT at time of booking",
    )
    payment_method = models.CharField(
        max_length=20,
        choices=PaymentMethod.choices,
        default=PaymentMethod.PAY_AT_CHAMBER,
    )
    payment_status = models.CharField(
        max_length=20,
        choices=PaymentStatus.choices,
        default=PaymentStatus.UNPAID,
    )
    status = models.CharField(
        max_length=20,
        choices=StatusChoices.choices,
        default=StatusChoices.CONFIRMED,
    )
    admin_notes = models.TextField(
        blank=True,
        default="",
        help_text="Internal notes by reception or administration",
    )
    cancellation_reason = models.TextField(
        blank=True,
        default="",
        help_text="Reason for cancellation if cancelled",
    )
    checked_in_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    booking_date = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-appointment_date", "-appointment_time"]
        constraints = [
            models.UniqueConstraint(
                fields=["doctor", "appointment_date", "appointment_time"],
                condition=~models.Q(status="cancelled"),
                name="unique_active_doctor_slot",
            )
        ]

    def __str__(self):
        ref = f" [{self.appointment_reference}]" if self.appointment_reference else ""
        return (
            f"Serial #{self.serial_number}{ref} with Dr. {self.doctor.get_full_name()} "
            f"on {self.appointment_date} at {self.appointment_time}"
        )

    def save(self, *args, **kwargs):
        if not self.appointment_reference:
            for _ in range(5):
                candidate = generate_appointment_reference()
                if not Booking.objects.filter(appointment_reference=candidate).exists():
                    self.appointment_reference = candidate
                    break
        super().save(*args, **kwargs)

    # Valid State Machine Transitions
    VALID_TRANSITIONS = {
        StatusChoices.PENDING: [
            StatusChoices.CONFIRMED,
            StatusChoices.CHECKED_IN,
            StatusChoices.CANCELLED,
        ],
        StatusChoices.CONFIRMED: [
            StatusChoices.CHECKED_IN,
            StatusChoices.COMPLETED,
            StatusChoices.CANCELLED,
            StatusChoices.NO_SHOW,
        ],
        StatusChoices.CHECKED_IN: [
            StatusChoices.COMPLETED,
            StatusChoices.NO_SHOW,
            StatusChoices.CANCELLED,
        ],
        StatusChoices.COMPLETED: [],  # Terminal state
        StatusChoices.CANCELLED: [],  # Terminal state
        StatusChoices.NO_SHOW: [StatusChoices.CANCELLED],
    }

    def can_transition_to(self, target_status: str) -> bool:
        allowed = self.VALID_TRANSITIONS.get(self.status, [])
        return target_status in allowed

    def transition_to(self, target_status: str, actor=None, reason=""):
        """
        Safely transitions the booking status, setting timestamps and recording audit logs.
        Raises ValidationError for invalid transitions.
        """
        if not self.can_transition_to(target_status):
            raise ValidationError(
                f"Cannot transition appointment from '{self.get_status_display()}' to '{target_status}'."
            )

        old_status = self.status
        self.status = target_status

        if target_status == self.StatusChoices.CHECKED_IN:
            self.checked_in_at = timezone.now()
        elif target_status == self.StatusChoices.COMPLETED:
            self.completed_at = timezone.now()
        elif target_status == self.StatusChoices.CANCELLED and reason:
            self.cancellation_reason = reason

        self.save()

        # Audit logging
        from accounts.models import log_audit_event, AuditLog
        action_map = {
            self.StatusChoices.CHECKED_IN: AuditLog.ActionChoices.APPOINTMENT_CHECKED_IN,
            self.StatusChoices.COMPLETED: AuditLog.ActionChoices.APPOINTMENT_COMPLETED,
            self.StatusChoices.CANCELLED: AuditLog.ActionChoices.APPOINTMENT_CANCELLED,
            self.StatusChoices.NO_SHOW: AuditLog.ActionChoices.APPOINTMENT_NO_SHOW,
        }
        action = action_map.get(target_status, AuditLog.ActionChoices.STATUS_CHANGE)
        log_audit_event(
            actor=actor,
            action=action,
            target_user=self.patient,
            details={
                "booking_id": self.id,
                "reference": self.appointment_reference,
                "doctor": self.doctor.username,
                "old_status": old_status,
                "new_status": target_status,
                "reason": reason,
            },
        )


class Prescription(models.Model):
    booking = models.OneToOneField(
        "Booking", on_delete=models.CASCADE, related_name="prescription"
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="prescriptions_given",
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="prescriptions_received",
    )
    symptoms = models.TextField()
    diagnosis = models.TextField()
    medications = RichTextField()
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Prescription for {self.patient} by Dr. {self.doctor}"

    class Meta:
        ordering = ["-created_at"]
