from datetime import timedelta
from django.core.exceptions import ValidationError, PermissionDenied
from django.utils import timezone
from accounts.models import User, log_audit_event, AuditLog
from complaints.models import Complaint
from notifications.services import (
    notify_complaint_submitted,
    notify_complaint_status_update,
)


def submit_complaint(
    patient: User,
    doctor: User,
    category: str,
    subject: str,
    description: str,
    booking=None,
    request=None,
) -> Complaint:
    """
    Submits a patient complaint against a doctor.
    - Validates roles.
    - Enforces anti-spam rate limiting (maximum 3 complaints per 24 hours per patient).
    - Links to appointment if provided and verified.
    - Emits notifications to patient and hospital administrators.
    - Records an audit log entry.
    """
    if patient.role != User.RoleChoices.PATIENT:
        raise PermissionDenied("Only registered patients may submit complaints.")

    if doctor.role != User.RoleChoices.DOCTOR:
        raise ValidationError("Complaints must be filed against a registered doctor.")

    # Anti-spam rate limiting check: max 3 complaints in 24 hours
    since_yesterday = timezone.now() - timedelta(hours=24)
    recent_count = Complaint.objects.filter(
        patient=patient,
        created_at__gte=since_yesterday,
    ).count()

    if recent_count >= 3:
        raise ValidationError(
            "Anti-spam protection: You have reached the submission limit of 3 complaints within 24 hours. "
            "Please allow hospital administration time to review your existing submissions."
        )

    # Validate booking relation if supplied
    if booking:
        if booking.patient != patient:
            raise ValidationError("You cannot file a complaint for another patient's appointment.")
        if booking.doctor != doctor:
            raise ValidationError("The selected appointment does not match the referenced doctor.")

    # Create complaint
    complaint = Complaint.objects.create(
        patient=patient,
        doctor=doctor,
        booking=booking,
        category=category,
        subject=subject.strip(),
        description=description.strip(),
        status=Complaint.StatusChoices.SUBMITTED,
    )

    # Send notifications
    notify_complaint_submitted(complaint)

    # Audit log
    ip = request.META.get("REMOTE_ADDR") if request else None
    log_audit_event(
        actor=patient,
        action=AuditLog.ActionChoices.COMPLAINT_FILED,
        target_user=doctor,
        details={
            "complaint_id": complaint.id,
            "reference": complaint.reference,
            "category": category,
            "doctor": doctor.username,
            "booking_id": booking.id if booking else None,
        },
        ip_address=ip,
    )

    return complaint


def review_complaint(
    complaint: Complaint,
    admin_user: User,
    new_status: str,
    admin_notes: str = "",
    admin_response: str = "",
    request=None,
) -> Complaint:
    """
    Hospital Administrator or Super Admin reviews, responds, and updates complaint status.
    - Strictly blocks doctors, receptionists, and patients.
    - Notifies the patient of status update and administrative feedback.
    - Records audit log.
    """
    if not (admin_user.is_super_admin or admin_user.is_hospital_admin):
        raise PermissionDenied(
            "Access Denied: Only Hospital Administrators and Super Admins may review complaints."
        )

    if new_status not in Complaint.StatusChoices.values:
        raise ValidationError(f"Invalid complaint status '{new_status}'.")

    complaint.status = new_status
    if admin_notes:
        complaint.admin_notes = admin_notes
    if admin_response:
        complaint.admin_response = admin_response

    complaint.reviewed_by = admin_user
    complaint.reviewed_at = timezone.now()
    complaint.save()

    # Notify patient of status update & response
    notify_complaint_status_update(complaint)

    # Audit log
    ip = request.META.get("REMOTE_ADDR") if request else None
    log_audit_event(
        actor=admin_user,
        action=AuditLog.ActionChoices.COMPLAINT_REVIEWED,
        target_user=complaint.patient,
        details={
            "complaint_id": complaint.id,
            "reference": complaint.reference,
            "doctor": complaint.doctor.username,
            "new_status": new_status,
            "has_response": bool(admin_response),
        },
        ip_address=ip,
    )

    return complaint
