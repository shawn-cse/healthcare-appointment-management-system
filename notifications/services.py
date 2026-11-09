import logging
from typing import List, Optional
from django.urls import reverse

from accounts.models import User
from notifications.models import Notification
from notifications.channels.base import BaseNotificationChannel
from notifications.channels.in_app import InAppNotificationChannel
from notifications.channels.email import EmailNotificationChannel
from notifications.channels.sms import SMSNotificationChannel

logger = logging.getLogger(__name__)

# Default active channels
DEFAULT_CHANNELS: List[BaseNotificationChannel] = [
    InAppNotificationChannel(),
    EmailNotificationChannel(),
    SMSNotificationChannel(),
]


def send_notification(
    recipient: User,
    title: str,
    message: str,
    notification_type: str,
    related_link: str = "",
    deduplication_key: Optional[str] = None,
    channels: Optional[List[BaseNotificationChannel]] = None,
    context: Optional[dict] = None,
) -> bool:
    """
    Central notification dispatcher.
    Delivers notification to all active channels (In-App, Email, SMS).
    Never raises an uncaught exception, ensuring core business logic is never blocked.
    """
    if not recipient:
        return False

    active_channels = channels or DEFAULT_CHANNELS
    delivered_any = False

    for channel in active_channels:
        try:
            success = channel.send(
                recipient=recipient,
                title=title,
                message=message,
                notification_type=notification_type,
                related_link=related_link,
                deduplication_key=deduplication_key,
                context=context,
            )
            if success:
                delivered_any = True
        except Exception as e:
            logger.warning(
                f"Notification channel {channel.channel_name} failed unexpectedly: {e}. Continuing cleanly."
            )

    return delivered_any


# ==============================================================================
# Domain-Specific Notification Triggers
# ==============================================================================

def notify_doctor_registration(doctor: User):
    """Notifies hospital administrators and super admins of a new doctor pending registration."""
    admins = User.objects.filter(
        role__in=[User.RoleChoices.SUPER_ADMIN, User.RoleChoices.HOSPITAL_ADMIN],
        is_active=True,
    )
    title = f"New Doctor Registration: Dr. {doctor.get_full_name()}"
    message = (
        f"Dr. {doctor.get_full_name()} (BMDC #{doctor.bmdc_number or 'Pending'}) "
        f"has registered and is awaiting administrative credential verification and approval."
    )
    dedup = f"doc_reg_{doctor.id}"
    link = reverse("admin-doctor-approval-detail", kwargs={"pk": doctor.pk})

    for admin_user in admins:
        send_notification(
            recipient=admin_user,
            title=title,
            message=message,
            notification_type=Notification.NotificationType.DOCTOR_REGISTRATION,
            related_link=link,
            deduplication_key=f"{dedup}_to_{admin_user.id}",
        )


def notify_doctor_approved(doctor: User):
    """Notifies a doctor that their profile and BMDC registration have been approved."""
    title = "Congratulations! Your Doctor Profile is Approved"
    message = (
        f"Dear Dr. {doctor.get_full_name()}, your registration has been approved by Green Hospital Administration. "
        f"You may now configure your weekly schedules and start accepting patient appointments."
    )
    link = reverse("doctors:dashboard")
    send_notification(
        recipient=doctor,
        title=title,
        message=message,
        notification_type=Notification.NotificationType.DOCTOR_APPROVAL,
        related_link=link,
        deduplication_key=f"doc_approved_{doctor.id}",
    )


def notify_doctor_rejected(doctor: User, reason: str = ""):
    """Notifies a doctor that their registration was rejected with reason."""
    title = "Doctor Registration Status Update"
    reason_str = f" Reason provided: {reason}" if reason else ""
    message = (
        f"Dear Dr. {doctor.get_full_name()}, your doctor registration could not be approved at this time.{reason_str}"
    )
    send_notification(
        recipient=doctor,
        title=title,
        message=message,
        notification_type=Notification.NotificationType.DOCTOR_REJECTION,
        related_link=reverse("accounts:login"),
        deduplication_key=f"doc_rejected_{doctor.id}",
    )


def notify_booking_confirmed(booking):
    """Notifies patient and doctor of a confirmed appointment booking."""
    # 1. Notify Patient
    patient_title = f"Appointment Confirmed: Serial #{booking.serial_number}"
    patient_msg = (
        f"Your appointment with Dr. {booking.doctor.get_full_name()} is confirmed for "
        f"{booking.appointment_date.strftime('%d %b %Y')} at {booking.appointment_time.strftime('%I:%M %p')}. "
        f"Your Serial Number is #{booking.serial_number}. Chamber: {booking.chamber or 'Chamber Desk'}."
    )
    patient_link = reverse("bookings:booking-invoice", kwargs={"pk": booking.pk})
    send_notification(
        recipient=booking.patient,
        title=patient_title,
        message=patient_msg,
        notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
        related_link=patient_link,
        deduplication_key=f"booking_confirmed_patient_{booking.id}",
    )

    # 2. Notify Doctor
    doc_title = f"New Consultation Booked: Serial #{booking.serial_number}"
    doc_msg = (
        f"Patient {booking.patient.get_full_name()} has booked an appointment for "
        f"{booking.appointment_date.strftime('%d %b %Y')} at {booking.appointment_time.strftime('%I:%M %p')} "
        f"(Serial #{booking.serial_number})."
    )
    send_notification(
        recipient=booking.doctor,
        title=doc_title,
        message=doc_msg,
        notification_type=Notification.NotificationType.BOOKING_CONFIRMED,
        related_link=reverse("doctors:dashboard"),
        deduplication_key=f"booking_confirmed_doctor_{booking.id}",
    )


def notify_booking_cancelled(booking, reason: str = "", actor: User = None):
    """Notifies patient and doctor when an appointment is cancelled."""
    reason_text = f" Reason: {reason}." if reason else ""
    cancelled_by_text = f" by {actor.get_role_display()}" if actor else ""

    # Notify Patient
    patient_title = f"Appointment Cancelled: Serial #{booking.serial_number}"
    patient_msg = (
        f"Your appointment on {booking.appointment_date.strftime('%d %b %Y')} with "
        f"Dr. {booking.doctor.get_full_name()} was cancelled{cancelled_by_text}.{reason_text}"
    )
    send_notification(
        recipient=booking.patient,
        title=patient_title,
        message=patient_msg,
        notification_type=Notification.NotificationType.BOOKING_CANCELLED,
        related_link=reverse("patients:appointment-detail", kwargs={"pk": booking.pk}),
        deduplication_key=f"booking_cancelled_patient_{booking.id}",
    )

    # Notify Doctor
    doc_title = f"Appointment Cancelled: Serial #{booking.serial_number}"
    doc_msg = (
        f"Appointment with patient {booking.patient.get_full_name()} on "
        f"{booking.appointment_date.strftime('%d %b %Y')} at {booking.appointment_time.strftime('%I:%M %p')} "
        f"has been cancelled.{reason_text}"
    )
    send_notification(
        recipient=booking.doctor,
        title=doc_title,
        message=doc_msg,
        notification_type=Notification.NotificationType.BOOKING_CANCELLED,
        related_link=reverse("doctors:dashboard"),
        deduplication_key=f"booking_cancelled_doctor_{booking.id}",
    )


def notify_session_cancelled(doctor: User, target_date, session_name: str, affected_bookings):
    """Notifies patients when a doctor's consultation session is cancelled."""
    date_str = target_date.strftime('%d %b %Y')
    for b in affected_bookings:
        title = f"Important: Consultation Session Cancelled on {date_str}"
        msg = (
            f"Dear {b.patient.get_full_name()}, Dr. {doctor.get_full_name()} is unavailable on {date_str} "
            f"({session_name}). Your appointment (Serial #{b.serial_number}) has been cancelled. "
            f"If you made an online payment, a 100% refund has been initiated."
        )
        send_notification(
            recipient=b.patient,
            title=title,
            message=msg,
            notification_type=Notification.NotificationType.SESSION_CANCELLED,
            related_link=reverse("patients:appointment-detail", kwargs={"pk": b.pk}),
            deduplication_key=f"session_cancelled_{b.id}",
        )


def notify_payment_success(payment_transaction):
    """Notifies patient of confirmed payment and receipt issuance."""
    booking = payment_transaction.booking
    title = f"Payment Successful: {payment_transaction.transaction_reference}"
    msg = (
        f"Your payment of ৳{payment_transaction.amount} for appointment Serial #{booking.serial_number} "
        f"with Dr. {booking.doctor.get_full_name()} was received successfully."
    )
    receipt_link = ""
    if hasattr(payment_transaction, "receipt"):
        receipt_link = reverse("payments:receipt-detail", kwargs={"receipt_number": payment_transaction.receipt.receipt_number})
    else:
        receipt_link = reverse("bookings:booking-invoice", kwargs={"pk": booking.pk})

    send_notification(
        recipient=booking.patient,
        title=title,
        message=msg,
        notification_type=Notification.NotificationType.PAYMENT_SUCCESS,
        related_link=receipt_link,
        deduplication_key=f"payment_success_{payment_transaction.transaction_reference}",
    )


def notify_payment_failed(payment_transaction, reason: str = ""):
    """Notifies patient of failed payment."""
    booking = payment_transaction.booking
    title = f"Payment Failed: {payment_transaction.transaction_reference}"
    reason_str = f" ({reason})" if reason else ""
    msg = (
        f"Your payment transaction of ৳{payment_transaction.amount} could not be completed{reason_str}. "
        f"You can retry payment or select Pay at Chamber."
    )
    send_notification(
        recipient=booking.patient,
        title=title,
        message=msg,
        notification_type=Notification.NotificationType.PAYMENT_FAILED,
        related_link=reverse("bookings:booking-invoice", kwargs={"pk": booking.pk}),
        deduplication_key=f"payment_failed_{payment_transaction.transaction_reference}",
    )


def notify_refund_requested(refund_request):
    """Notifies patient and hospital admins that a refund request was received."""
    # Patient
    p_title = f"Refund Request Received: {refund_request.refund_reference}"
    p_msg = (
        f"Your refund request for ৳{refund_request.requested_amount} on appointment "
        f"Serial #{refund_request.booking.serial_number} has been received and is under review."
    )
    send_notification(
        recipient=refund_request.patient,
        title=p_title,
        message=p_msg,
        notification_type=Notification.NotificationType.REFUND_REQUESTED,
        related_link=reverse("payments:refund-detail", kwargs={"refund_reference": refund_request.refund_reference}),
        deduplication_key=f"refund_requested_{refund_request.refund_reference}",
    )

    # Admins
    admins = User.objects.filter(
        role__in=[User.RoleChoices.SUPER_ADMIN, User.RoleChoices.HOSPITAL_ADMIN],
        is_active=True,
    )
    for a in admins:
        send_notification(
            recipient=a,
            title=f"New Refund Request: {refund_request.refund_reference} (৳{refund_request.requested_amount})",
            message=f"Patient {refund_request.patient.get_full_name()} submitted a refund request of ৳{refund_request.requested_amount}.",
            notification_type=Notification.NotificationType.REFUND_REQUESTED,
            related_link=reverse("payments:admin-refunds"),
            deduplication_key=f"refund_req_admin_{refund_request.refund_reference}_{a.id}",
        )


def notify_refund_approved(refund_request):
    """Notifies patient that their refund has been approved by Super Admin."""
    title = f"Refund Approved: {refund_request.refund_reference}"
    msg = (
        f"Good news! Your refund request of ৳{refund_request.approved_amount} has been approved by "
        f"Green Hospital administration and is currently being processed for payout."
    )
    send_notification(
        recipient=refund_request.patient,
        title=title,
        message=msg,
        notification_type=Notification.NotificationType.REFUND_APPROVED,
        related_link=reverse("payments:refund-detail", kwargs={"refund_reference": refund_request.refund_reference}),
        deduplication_key=f"refund_approved_{refund_request.refund_reference}",
    )


def notify_refund_rejected(refund_request, reason: str = ""):
    """Notifies patient that their refund request was rejected."""
    title = f"Refund Request Rejected: {refund_request.refund_reference}"
    reason_str = f" Reason: {reason}" if reason else ""
    msg = (
        f"Your refund request for ৳{refund_request.requested_amount} was reviewed and rejected.{reason_str}"
    )
    send_notification(
        recipient=refund_request.patient,
        title=title,
        message=msg,
        notification_type=Notification.NotificationType.REFUND_REJECTED,
        related_link=reverse("payments:refund-detail", kwargs={"refund_reference": refund_request.refund_reference}),
        deduplication_key=f"refund_rejected_{refund_request.refund_reference}",
    )


def notify_refund_completed(refund_transaction):
    """Notifies patient of completed refund payout."""
    refund_request = refund_transaction.refund_request
    title = f"Refund Completed: ৳{refund_transaction.amount}"
    msg = (
        f"Your refund of ৳{refund_transaction.amount} has been successfully completed. "
        f"Reference / Voucher: {refund_transaction.gateway_refund_ref or refund_transaction.refund_reference}."
    )
    send_notification(
        recipient=refund_request.patient,
        title=title,
        message=msg,
        notification_type=Notification.NotificationType.REFUND_COMPLETED,
        related_link=reverse("payments:refund-detail", kwargs={"refund_reference": refund_request.refund_reference}),
        deduplication_key=f"refund_completed_{refund_request.refund_reference}",
    )


def notify_complaint_submitted(complaint):
    """Notifies patient of complaint submission receipt, and notifies administrators."""
    # Patient
    p_title = f"Complaint Received: {complaint.reference}"
    p_msg = (
        f"Your complaint regarding Dr. {complaint.doctor.get_full_name()} has been received "
        f"and submitted to Hospital Administration (Ref: {complaint.reference})."
    )
    send_notification(
        recipient=complaint.patient,
        title=p_title,
        message=p_msg,
        notification_type=Notification.NotificationType.COMPLAINT_UPDATE,
        related_link=reverse("complaints:patient-detail", kwargs={"pk": complaint.pk}),
        deduplication_key=f"complaint_sub_{complaint.reference}",
    )

    # Admins
    admins = User.objects.filter(
        role__in=[User.RoleChoices.SUPER_ADMIN, User.RoleChoices.HOSPITAL_ADMIN],
        is_active=True,
    )
    for a in admins:
        send_notification(
            recipient=a,
            title=f"New Patient Complaint: {complaint.reference}",
            message=f"Patient {complaint.patient.get_full_name()} filed a complaint regarding Dr. {complaint.doctor.get_full_name()} ({complaint.get_category_display()}).",
            notification_type=Notification.NotificationType.COMPLAINT_UPDATE,
            related_link=reverse("complaints:admin-review", kwargs={"pk": complaint.pk}),
            deduplication_key=f"complaint_admin_{complaint.reference}_{a.id}",
        )


def notify_complaint_status_update(complaint):
    """Notifies patient of status update or administrative response to their complaint."""
    title = f"Complaint Status Updated: {complaint.reference} ({complaint.get_status_display()})"
    response_snippet = f" Response: {complaint.admin_response}" if complaint.admin_response else ""
    msg = (
        f"Your complaint ({complaint.reference}) regarding Dr. {complaint.doctor.get_full_name()} "
        f"status has been updated to '{complaint.get_status_display()}'.{response_snippet}"
    )
    send_notification(
        recipient=complaint.patient,
        title=title,
        message=msg,
        notification_type=Notification.NotificationType.COMPLAINT_UPDATE,
        related_link=reverse("complaints:patient-detail", kwargs={"pk": complaint.pk}),
        deduplication_key=f"complaint_update_{complaint.reference}_{complaint.status}",
    )
