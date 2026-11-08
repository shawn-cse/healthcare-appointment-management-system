from decimal import Decimal
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.urls import reverse
from django.db.models import Avg

from accounts.managers import CustomUserManager
from utils.file_utils import (
    profile_photo_directory_path,
)


class User(AbstractUser):
    """
    Custom user model with Green Hospital role-based access control and account status
    """

    class RoleChoices(models.TextChoices):
        SUPER_ADMIN = "super_admin", "Super Admin"
        HOSPITAL_ADMIN = "hospital_admin", "Hospital Admin"
        DOCTOR = "doctor", "Doctor"
        RECEPTIONIST = "receptionist", "Receptionist"
        PATIENT = "patient", "Patient"

    class StatusChoices(models.TextChoices):
        ACTIVE = "active", "Active"
        PENDING_APPROVAL = "pending_approval", "Pending Approval"
        SUSPENDED = "suspended", "Suspended"
        REJECTED = "rejected", "Rejected"

    username = models.CharField(max_length=30, unique=True)
    role = models.CharField(
        choices=RoleChoices.choices,
        max_length=20,
        default=RoleChoices.PATIENT,
        error_messages={"required": "Role must be provided"},
    )
    status = models.CharField(
        choices=StatusChoices.choices,
        max_length=20,
        default=StatusChoices.ACTIVE,
    )
    email = models.EmailField(
        blank=True,
        error_messages={
            "unique": "A user with that email already exists.",
        },
    )
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    registration_number = models.IntegerField(null=True, blank=True)
    bmdc_number = models.CharField(
        max_length=50,
        blank=True,
        null=True,
        unique=True,
        help_text="Official BMDC registration number for doctors",
    )
    bmdc_verified = models.BooleanField(
        default=False,
        help_text="Designates whether BMDC registration has been manually verified by hospital administration",
    )
    bmdc_verified_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="bmdc_verifications_conducted",
    )
    bmdc_verified_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(
        blank=True,
        default="",
        help_text="Reason for rejection if registration was not approved",
    )
    approved_by = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="doctors_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = []

    objects = CustomUserManager()

    def __unicode__(self):
        return self.username

    def get_full_name(self):
        """
        Return the first_name plus the last_name, with a space in between.
        """
        full_name = "%s %s" % (self.first_name, self.last_name)
        return full_name.strip() or self.username

    def get_doctor_profile(self):
        """
        Return doctor profile URL
        """
        return reverse(
            "doctors:doctor-profile", kwargs={"username": self.username}
        )

    @property
    def is_super_admin(self):
        return bool(self.is_superuser or self.role == self.RoleChoices.SUPER_ADMIN)

    @property
    def is_hospital_admin(self):
        return self.role == self.RoleChoices.HOSPITAL_ADMIN

    @property
    def is_doctor(self):
        return self.role == self.RoleChoices.DOCTOR

    @property
    def is_approved_doctor(self):
        """Returns True if user is a doctor and approved (active)"""
        return bool(
            self.role == self.RoleChoices.DOCTOR
            and self.status == self.StatusChoices.ACTIVE
        )

    @property
    def is_receptionist(self):
        return self.role == self.RoleChoices.RECEPTIONIST

    @property
    def is_patient(self):
        return self.role == self.RoleChoices.PATIENT

    @property
    def is_staff_admin(self):
        """Either Super Admin or Hospital Admin"""
        return self.is_super_admin or self.is_hospital_admin

    @property
    def can_approve_refunds(self):
        """Only SUPER_ADMIN / admin has unrestricted administration and final refund approval.
        Hospital Administrators cannot approve refunds."""
        return self.is_super_admin

    def get_assigned_doctors(self):
        """Return queryset of doctors this user is authorized to manage."""
        if self.is_super_admin or self.is_hospital_admin:
            return User.objects.filter(role=self.RoleChoices.DOCTOR)
        if self.is_receptionist:
            doctor_ids = self.assigned_doctor_relations.values_list(
                "doctor_id", flat=True
            )
            return User.objects.filter(id__in=doctor_ids)
        if self.is_doctor:
            return User.objects.filter(id=self.id)
        return User.objects.none()

    def can_access_doctor(self, doctor):
        """Check if this user can access the target doctor's appointments/data."""
        if self.is_super_admin or self.is_hospital_admin:
            return True
        doc_id = doctor.id if hasattr(doctor, "id") else doctor
        if self.is_doctor:
            return self.id == doc_id
        if self.is_receptionist:
            return self.assigned_doctor_relations.filter(doctor_id=doc_id).exists()
        return False

    @property
    def rating(self):
        return 4  # Default value

    @property
    def average_rating(self):
        return (
            self.reviews_received.aggregate(Avg("rating"))["rating__avg"] or 0
        )

    @property
    def rating_count(self):
        return self.reviews_received.count()

    @property
    def rating_distribution(self):
        distribution = {i: 0 for i in range(1, 6)}
        for rating in self.reviews_received.values_list("rating", flat=True):
            distribution[rating] += 1
        return distribution


class ReceptionistDoctorAssignment(models.Model):
    """
    Links a receptionist to the doctor(s) they are explicitly assigned to manage.
    """
    receptionist = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assigned_doctor_relations",
        limit_choices_to={"role": "receptionist"},
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="assigned_receptionist_relations",
        limit_choices_to={"role": "doctor"},
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_receptionist_assignments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("receptionist", "doctor")
        verbose_name = "Receptionist Doctor Assignment"
        verbose_name_plural = "Receptionist Doctor Assignments"

    def __str__(self):
        return f"{self.receptionist.username} -> Dr. {self.doctor.get_full_name()}"


class AuditLog(models.Model):
    """
    Audit logging for role changes, status changes, and sensitive account actions.
    """
    class ActionChoices(models.TextChoices):
        ROLE_CHANGE = "role_change", "Role Change"
        STATUS_CHANGE = "status_change", "Status Change"
        STAFF_PRIVILEGE_CHANGE = "staff_privilege_change", "Staff Privilege Change"
        RECEPTIONIST_ASSIGNED = "receptionist_assigned", "Receptionist Assigned"
        RECEPTIONIST_REMOVED = "receptionist_removed", "Receptionist Removed"
        LOGIN_FAILED = "login_failed", "Login Failed"
        LOGIN_SUCCESS = "login_success", "Login Success"
        PASSWORD_RESET = "password_reset", "Password Reset"
        REFUND_ACTION = "refund_action", "Refund Action"
        DOCTOR_APPROVED = "doctor_approved", "Doctor Approved"
        DOCTOR_REJECTED = "doctor_rejected", "Doctor Rejected"
        DOCTOR_SUSPENDED = "doctor_suspended", "Doctor Suspended"
        DOCTOR_REACTIVATED = "doctor_reactivated", "Doctor Reactivated"
        BMDC_VERIFIED = "bmdc_verified", "BMDC Verified"
        BMDC_UPDATED = "bmdc_updated", "BMDC Updated"
        FEE_CHANGED = "fee_changed", "Fee Changed"
        APPOINTMENT_BOOKED = "appointment_booked", "Appointment Booked"
        APPOINTMENT_CHECKED_IN = "appointment_checked_in", "Appointment Checked In"
        APPOINTMENT_COMPLETED = "appointment_completed", "Appointment Completed"
        APPOINTMENT_CANCELLED = "appointment_cancelled", "Appointment Cancelled"
        APPOINTMENT_NO_SHOW = "appointment_no_show", "Appointment No Show"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_actions",
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
    )
    action = models.CharField(max_length=50, choices=ActionChoices.choices)
    details = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Audit Log"
        verbose_name_plural = "Audit Logs"

    def __str__(self):
        actor_name = self.actor.username if self.actor else "System"
        target_name = self.target_user.username if self.target_user else "N/A"
        return f"[{self.created_at}] {actor_name} -> {self.action} on {target_name}"


def log_audit_event(actor, action, target_user=None, details=None, ip_address=None):
    return AuditLog.objects.create(
        actor=actor if (actor and getattr(actor, "is_authenticated", False)) else None,
        target_user=target_user,
        action=action,
        details=details or {},
        ip_address=ip_address,
    )


class Profile(models.Model):
    """
    User profile
    """

    user = models.OneToOneField(
        User, on_delete=models.CASCADE, related_name="profile"
    )
    avatar = models.ImageField(
        default="defaults/user.png", upload_to=profile_photo_directory_path
    )
    phone = models.CharField(max_length=20, blank=True, null=True)
    dob = models.DateField(blank=True, null=True)
    about = models.TextField(blank=True, null=True)
    specialization = models.CharField(max_length=255, blank=True, null=True)
    gender = models.CharField(
        max_length=10,
        choices=[("male", "Male"), ("female", "Female"), ("other", "Other")],
        blank=True,
    )
    address = models.TextField(blank=True, null=True)
    city = models.CharField(max_length=100, blank=True)
    state = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=100, blank=True)
    price_per_consultation = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    is_available = models.BooleanField(default=True)
    blood_group = models.CharField(
        max_length=5,
        choices=[
            ("A+", "A+"),
            ("A-", "A-"),
            ("B+", "B+"),
            ("B-", "B-"),
            ("O+", "O+"),
            ("O-", "O-"),
            ("AB+", "AB+"),
            ("AB-", "AB-"),
        ],
        blank=True,
        null=True,
    )
    allergies = models.TextField(blank=True, null=True)
    medical_conditions = models.TextField(blank=True, null=True)
    office_phone = models.CharField(
        max_length=30,
        blank=True,
        null=True,
        help_text="Office or receptionist phone number",
    )
    chamber_number = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Assigned chamber or room number",
    )
    department = models.CharField(
        max_length=150,
        blank=True,
        default="",
        help_text="Clinical department (e.g. Cardiology, Neurology)",
    )

    # 4-Tier Configurable BDT Consultation Fees
    fee_first_visit = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("1000.00"),
        help_text="Fee in BDT for 1st regular visit",
    )
    fee_second_visit = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("800.00"),
        help_text="Fee in BDT for 2nd regular visit",
    )
    fee_third_visit = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("600.00"),
        help_text="Fee in BDT for 3rd regular visit",
    )
    fee_report_check = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("300.00"),
        help_text="Fee in BDT for report checking visit",
    )

    def save(self, *args, **kwargs):
        # Synchronize price_per_consultation with fee_first_visit for backward compatibility
        if self.price_per_consultation and (not self.fee_first_visit or self.fee_first_visit == Decimal("1000.00")):
            self.fee_first_visit = self.price_per_consultation
        elif self.fee_first_visit and not self.price_per_consultation:
            self.price_per_consultation = self.fee_first_visit
        super().save(*args, **kwargs)

    def get_fee_for_stage(self, stage=1):
        """Returns consultation fee in BDT for regular visit stage 1, 2, or 3."""
        if stage == 1:
            return self.fee_first_visit
        elif stage == 2:
            return self.fee_second_visit
        elif stage == 3:
            return self.fee_third_visit
        return self.fee_first_visit

    def __str__(self):
        return "Profile of {}".format(self.user.username)

    @property
    def image(self):
        return (
            self.avatar.url
            if self.avatar.storage.exists(self.avatar.name)
            else "{}defaults/user.png".format(settings.MEDIA_URL)
        )


class DoctorFeeHistory(models.Model):
    """
    Immutable historical audit log of doctor consultation fee updates.
    Prevents active or existing bookings from having their agreed price silently altered.
    """
    doctor = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="fee_history",
        limit_choices_to={"role": "doctor"},
    )
    changed_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="fee_changes_conducted",
    )
    fee_first_visit = models.DecimalField(max_digits=10, decimal_places=2)
    fee_second_visit = models.DecimalField(max_digits=10, decimal_places=2)
    fee_third_visit = models.DecimalField(max_digits=10, decimal_places=2)
    fee_report_check = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Doctor Fee History"
        verbose_name_plural = "Doctor Fee Histories"

    def __str__(self):
        return f"Dr. {self.doctor.get_full_name()} fees changed at {self.created_at}"
