from datetime import date, time
from decimal import Decimal
from typing import Any, Dict, List, Optional
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from accounts.models import AuditLog, User, log_audit_event
from bookings.models import Booking
from doctors.models.schedules import DoctorAvailabilityException
from doctors.services.availability import detect_affected_appointments
from payments.services.refund_service import create_refund_request


def cancel_doctor_consultation_session(
    doctor: User,
    target_date: date,
    start_time: Optional[time] = None,
    end_time: Optional[time] = None,
    reason: str = "Doctor unavailable / session cancelled.",
    actor: Optional[User] = None,
) -> Dict[str, Any]:
    """
    Cancels a doctor's consultation session or entire day:
    - Creates DoctorAvailabilityException to block further bookings for this session/day.
    - Finds all affected confirmed, checked-in, or pending appointments.
    - Transitions them to CANCELLED status with stated reason and actor.
    - Paid patients are automatically made eligible for a 100% refund, creating RefundRequests.
    - Unpaid bookings are cancelled without creating monetary refund transactions.
    - Never erases cancelled appointments or financial records.
    - Logs audit events for accountability.
    """
    if actor and not actor.is_staff_admin:
        if not (actor.is_doctor and actor.id == doctor.id):
            raise PermissionDenied("You are not authorized to cancel consultation sessions for this doctor.")

    if not reason or not reason.strip():
        raise ValidationError("A cancellation reason is required.")

    with transaction.atomic():
        # 1. Prevent further bookings by creating DoctorAvailabilityException
        exception_type = (
            DoctorAvailabilityException.ExceptionType.BLOCKED_INTERVAL
            if (start_time and end_time)
            else DoctorAvailabilityException.ExceptionType.DAY_OFF
        )
        DoctorAvailabilityException.objects.create(
            doctor=doctor,
            exception_type=exception_type,
            start_date=target_date,
            end_date=target_date,
            start_time=start_time,
            end_time=end_time,
            reason=reason,
            is_active=True,
        )

        # 2. Find all affected active appointments
        affected_bookings = detect_affected_appointments(
            doctor=doctor,
            target_date=target_date,
            start_time=start_time,
            end_time=end_time,
        )

        cancelled_count = 0
        refund_requests_created = []
        unpaid_count = 0
        total_refundable_amount = Decimal("0.00")

        # 3. Process each affected booking
        for booking in affected_bookings:
            # Transition to CANCELLED
            booking.transition_to(
                Booking.StatusChoices.CANCELLED,
                actor=actor or doctor,
                reason=reason,
            )
            cancelled_count += 1

            # Check payment status
            if booking.payment_status in (Booking.PaymentStatus.PAID, Booking.PaymentStatus.PARTIALLY_REFUNDED):
                # 100% refund eligibility for doctor/hospital cancellation
                refund_req = create_refund_request(
                    booking=booking,
                    patient=booking.patient,
                    reason=f"Doctor cancelled session on {target_date}: {reason}",
                    cancellation_type="doctor",
                    current_time=timezone.now(),
                    actor=actor or doctor,
                )
                if refund_req:
                    refund_requests_created.append(refund_req)
                    total_refundable_amount += refund_req.requested_amount
            else:
                unpaid_count += 1

        # Audit logging
        log_audit_event(
            actor=actor or doctor,
            action=AuditLog.ActionChoices.SESSION_CANCELLED,
            target_user=doctor,
            details={
                "doctor": doctor.username,
                "target_date": str(target_date),
                "start_time": str(start_time) if start_time else None,
                "end_time": str(end_time) if end_time else None,
                "reason": reason,
                "cancelled_appointments_count": cancelled_count,
                "refund_requests_count": len(refund_requests_created),
                "total_refundable_amount": str(total_refundable_amount),
            },
        )

        return {
            "doctor": doctor,
            "target_date": target_date,
            "total_affected": cancelled_count,
            "paid_count": len(refund_requests_created),
            "unpaid_count": unpaid_count,
            "total_refundable_amount": total_refundable_amount,
            "refund_requests": refund_requests_created,
        }
