import secrets
from django.db import models
from django.conf import settings
from django.utils import timezone


def generate_complaint_reference() -> str:
    """Generates unique reference e.g. CMP-20261109-A1B2"""
    date_str = timezone.now().strftime("%Y%m%d")
    hex_token = secrets.token_hex(2).upper()
    return f"CMP-{date_str}-{hex_token}"


class Complaint(models.Model):
    """
    Structured patient complaint entity against a doctor.
    Enforces privacy, status workflow, and administrative response tracking.
    """
    class CategoryChoices(models.TextChoices):
        WAIT_TIME = "wait_time", "Excessive Wait Time / Delay"
        UNPROFESSIONAL_BEHAVIOR = "unprofessional_behavior", "Unprofessional or Rude Behavior"
        DIAGNOSIS_CONCERN = "diagnosis_concern", "Prescription or Treatment Concern"
        BILLING_FEE_DISPUTE = "billing_fee_dispute", "Billing or Consultation Fee Dispute"
        CHAMBER_CLEANLINESS = "chamber_cleanliness", "Chamber Facility or Cleanliness"
        OTHER = "other", "Other Operational Concern"

    class StatusChoices(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        RESOLVED = "resolved", "Resolved"
        REJECTED = "rejected", "Rejected"
        CLOSED = "closed", "Closed"

    reference = models.CharField(
        max_length=32,
        unique=True,
        db_index=True,
        editable=False,
        help_text="Unique complaint tracking identifier e.g. CMP-20261109-1A2B",
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="complaints_filed",
        limit_choices_to={"role": "patient"},
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="complaints_received",
        limit_choices_to={"role": "doctor"},
    )
    booking = models.ForeignKey(
        "bookings.Booking",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="complaints",
        help_text="Associated appointment if complaint relates to a specific visit",
    )
    category = models.CharField(
        max_length=40,
        choices=CategoryChoices.choices,
        default=CategoryChoices.OTHER,
    )
    subject = models.CharField(max_length=200)
    description = models.TextField(help_text="Detailed description of the issue or incident")
    status = models.CharField(
        max_length=20,
        choices=StatusChoices.choices,
        default=StatusChoices.SUBMITTED,
        db_index=True,
    )

    # Administrative review & resolution fields
    admin_notes = models.TextField(
        blank=True,
        default="",
        help_text="Confidential administrative investigation notes (not visible to patient)",
    )
    admin_response = models.TextField(
        blank=True,
        default="",
        help_text="Official resolution and feedback displayed to the patient",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="complaints_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Patient Complaint"
        verbose_name_plural = "Patient Complaints"

    def __str__(self):
        return f"{self.reference} - {self.patient.username} re: Dr. {self.doctor.get_full_name()} [{self.get_status_display()}]"

    def save(self, *args, **kwargs):
        if not self.reference:
            for _ in range(5):
                candidate = generate_complaint_reference()
                if not Complaint.objects.filter(reference=candidate).exists():
                    self.reference = candidate
                    break
        super().save(*args, **kwargs)
