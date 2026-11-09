from datetime import datetime
from decimal import Decimal
from typing import Optional, Tuple
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.utils import timezone

from accounts.models import AuditLog, User, log_audit_event
from bookings.models import Booking
from payments.gateways.factory import get_payment_gateway
from payments.models import (
    PaymentTransaction,
    RefundRequest,
    RefundTransaction,
    generate_refund_reference,
)
from payments.services.cancellation_policy import calculate_cancellation_refund_eligibility


def create_refund_request(
    booking: Booking,
    patient: User,
    reason: str = "",
    cancellation_type: str = "patient",
    current_time: Optional[datetime] = None,
    requested_amount: Optional[Decimal] = None,
    actor: Optional[User] = None,
) -> Optional[RefundRequest]:
    """
    Creates a refund request following cancellation of an appointment.
    - Validates money actually paid (strictly returns None / raises if unpaid).
    - Prevents duplicate refund requests for the same booking.
    - Calculates maximum eligibility based on authoritative Dhaka server time.
    - Never refunds more than net paid amount remaining after previous refunds.
    """
    # Active refund duplicate check
    existing = (
        RefundRequest.objects.filter(booking=booking)
        .exclude(status=RefundRequest.Status.REJECTED)
        .first()
    )
    if existing:
        raise ValidationError(
            f"An active refund request ({existing.refund_reference} - {existing.get_status_display()}) already exists for this appointment."
        )

    # Find the successful payment transaction
    payment_tx = (
        booking.payment_transactions.filter(
            status__in=[PaymentTransaction.Status.SUCCESS, PaymentTransaction.Status.PARTIALLY_REFUNDED]
        )
        .order_by("-created_at")
        .first()
    )

    if not payment_tx or booking.payment_status == Booking.PaymentStatus.UNPAID:
        # An unpaid appointment has nothing to refund and should not create a monetary refund transaction
        return None

    net_paid_remaining = payment_tx.net_paid_remaining
    if net_paid_remaining <= Decimal("0.00"):
        raise ValidationError("All collected payments for this appointment have already been fully refunded.")

    # Calculate policy eligibility
    eligibility = calculate_cancellation_refund_eligibility(
        booking=booking,
        current_time=current_time,
        cancellation_actor_type=cancellation_type,
    )

    if eligibility.is_unpaid or eligibility.refundable_amount <= Decimal("0.00"):
        return None

    # Amount determination
    req_amount = requested_amount if requested_amount is not None else eligibility.refundable_amount
    req_amount = min(req_amount, eligibility.refundable_amount)
    req_amount = min(req_amount, net_paid_remaining)

    if req_amount <= Decimal("0.00"):
        return None

    with transaction.atomic():
        refund_req = RefundRequest.objects.create(
            booking=booking,
            payment_transaction=payment_tx,
            patient=booking.patient,
            doctor=booking.doctor,
            original_paid_amount=payment_tx.amount,
            eligible_refund_percentage=eligibility.refund_percentage,
            eligible_refund_amount=eligibility.refundable_amount,
            requested_amount=req_amount,
            reason=reason or f"Cancellation refund request ({eligibility.policy_rule})",
            cancellation_actor=actor or patient,
            cancellation_type=cancellation_type,
            policy_applied=eligibility.policy_rule,
            hours_before_start=eligibility.hours_before_start,
            status=RefundRequest.Status.REQUESTED,
        )

        log_audit_event(
            actor=actor or patient,
            action=AuditLog.ActionChoices.REFUND_REQUESTED,
            target_user=booking.patient,
            details={
                "booking_id": booking.id,
                "refund_reference": refund_req.refund_reference,
                "requested_amount": str(refund_req.requested_amount),
                "eligible_percentage": refund_req.eligible_refund_percentage,
                "cancellation_type": cancellation_type,
            },
        )

        try:
            from notifications.services import notify_refund_requested
            notify_refund_requested(refund_req)
        except Exception:
            pass

        return refund_req


def review_refund_request(
    refund_request: RefundRequest,
    reviewed_by: User,
    review_notes: str = "",
) -> RefundRequest:
    """
    Hospital Administrator or Super Admin reviews and forwards refund request (UNDER_REVIEW).
    Hospital Administrators CANNOT approve or reject refunds.
    """
    if not reviewed_by.is_staff_admin:
        raise PermissionDenied("Only hospital administrative staff can review refund requests.")

    if refund_request.status != RefundRequest.Status.REQUESTED:
        raise ValidationError(
            f"Cannot review refund request currently in '{refund_request.get_status_display()}' status."
        )

    refund_request.status = RefundRequest.Status.UNDER_REVIEW
    refund_request.reviewed_by = reviewed_by
    refund_request.reviewed_at = timezone.now()
    refund_request.review_notes = review_notes
    refund_request.save()

    log_audit_event(
        actor=reviewed_by,
        action=AuditLog.ActionChoices.REFUND_REVIEWED,
        target_user=refund_request.patient,
        details={
            "refund_reference": refund_request.refund_reference,
            "status": refund_request.status,
            "notes": review_notes,
        },
    )

    return refund_request


def approve_refund_request(
    refund_request: RefundRequest,
    approved_by: User,
    approval_notes: str = "",
) -> RefundRequest:
    """
    MANDATORY: Only Super Admin can approve refunds.
    Hospital Administrators or other staff attempting approval are rejected with PermissionDenied.
    """
    if not approved_by.can_approve_refunds:
        raise PermissionDenied(
            "Unauthorized: Hospital Administrators cannot approve refunds. Final refund approval is strictly reserved for Super Administrators."
        )

    if refund_request.status not in (RefundRequest.Status.REQUESTED, RefundRequest.Status.UNDER_REVIEW):
        raise ValidationError(
            f"Cannot approve refund request currently in '{refund_request.get_status_display()}' status."
        )

    # Double check net paid remaining before approval
    remaining = refund_request.payment_transaction.net_paid_remaining
    if refund_request.requested_amount > remaining:
        raise ValidationError(
            f"Requested amount ({refund_request.requested_amount} BDT) exceeds net paid remaining ({remaining} BDT)."
        )

    refund_request.status = RefundRequest.Status.APPROVED
    refund_request.approved_by = approved_by
    refund_request.approved_at = timezone.now()
    if approval_notes:
        refund_request.review_notes = (
            f"{refund_request.review_notes}\n[Approval Notes]: {approval_notes}".strip()
        )
    refund_request.save()

    log_audit_event(
        actor=approved_by,
        action=AuditLog.ActionChoices.REFUND_APPROVED,
        target_user=refund_request.patient,
        details={
            "refund_reference": refund_request.refund_reference,
            "amount": str(refund_request.requested_amount),
            "approved_by": approved_by.username,
        },
    )

    try:
        from notifications.services import notify_refund_approved
        notify_refund_approved(refund_request)
    except Exception:
        pass

    return refund_request


def reject_refund_request(
    refund_request: RefundRequest,
    rejected_by: User,
    rejection_reason: str,
) -> RefundRequest:
    """
    MANDATORY: Only Super Admin can reject refunds.
    Hospital Administrators or other staff attempting rejection are rejected with PermissionDenied.
    """
    if not rejected_by.can_approve_refunds:
        raise PermissionDenied(
            "Unauthorized: Hospital Administrators cannot reject refunds. Refund decisions are strictly reserved for Super Administrators."
        )

    if not rejection_reason or not rejection_reason.strip():
        raise ValidationError("A stated rejection reason is mandatory.")

    if refund_request.status not in (RefundRequest.Status.REQUESTED, RefundRequest.Status.UNDER_REVIEW):
        raise ValidationError(
            f"Cannot reject refund request currently in '{refund_request.get_status_display()}' status."
        )

    refund_request.status = RefundRequest.Status.REJECTED
    refund_request.approved_by = rejected_by  # Deciding administrator
    refund_request.approved_at = timezone.now()
    refund_request.rejection_reason = rejection_reason.strip()
    refund_request.save()

    log_audit_event(
        actor=rejected_by,
        action=AuditLog.ActionChoices.REFUND_REJECTED,
        target_user=refund_request.patient,
        details={
            "refund_reference": refund_request.refund_reference,
            "rejection_reason": refund_request.rejection_reason,
            "rejected_by": rejected_by.username,
        },
    )

    try:
        from notifications.services import notify_refund_rejected
        notify_refund_rejected(refund_request, reason=refund_request.rejection_reason)
    except Exception:
        pass

    return refund_request


def process_approved_refund(
    refund_request: RefundRequest,
    processed_by: User,
    manual_reference: str = "",
    repayment_method: str = "",
    notes: str = "",
    provider: Optional[str] = None,
) -> Tuple[bool, RefundRequest, str]:
    """
    Executes financial repayment for a Super-Admin APPROVED refund request.
    - Online payments: calls gateway refund API (SSLCOMMERZ or Mock).
    - Chamber payments: executes documented manual repayment workflow.
    - Updates transaction ledger and booking payment status.
    - Handles gateway failures safely with retry support.
    """
    if not processed_by.is_staff_admin:
        raise PermissionDenied("Only authorized administrative staff can execute refund payouts.")

    if refund_request.status not in (RefundRequest.Status.APPROVED, RefundRequest.Status.FAILED):
        raise ValidationError(
            f"Cannot process refund request with status '{refund_request.get_status_display()}'. Must be APPROVED (or FAILED retry)."
        )

    payment_tx = refund_request.payment_transaction
    net_remaining = payment_tx.net_paid_remaining

    if refund_request.requested_amount > net_remaining:
        raise ValidationError(
            f"Cannot process refund: requested amount ({refund_request.requested_amount} BDT) exceeds remaining net paid amount ({net_remaining} BDT)."
        )

    is_online = payment_tx.payment_method == PaymentTransaction.PaymentMethod.ONLINE
    if not is_online and (not manual_reference or not manual_reference.strip()):
        raise ValidationError(
            "A manual repayment voucher or receipt reference is mandatory for chamber payment refunds."
        )

    with transaction.atomic():
        # Transition to PROCESSING
        refund_request.status = RefundRequest.Status.PROCESSING
        refund_request.save()

        if is_online:
            gateway = get_payment_gateway(provider)
            refund_res = gateway.initiate_refund(
                refund_request=refund_request,
                reason=notes or refund_request.reason,
            )

            if not refund_res.is_successful:
                refund_request.status = RefundRequest.Status.FAILED
                refund_request.processing_notes = f"Gateway failure: {refund_res.error_message}"
                refund_request.save()

                log_audit_event(
                    actor=processed_by,
                    action=AuditLog.ActionChoices.REFUND_ACTION,
                    target_user=refund_request.patient,
                    details={
                        "refund_reference": refund_request.refund_reference,
                        "status": "failed",
                        "error": refund_res.error_message,
                    },
                )
                return False, refund_request, f"Gateway refund failed: {refund_res.error_message}"

            # Gateway succeeded
            payout_ref = refund_res.refund_ref_id or generate_refund_reference()
            refund_tx = RefundTransaction.objects.create(
                refund_request=refund_request,
                payment_transaction=payment_tx,
                amount=refund_request.requested_amount,
                currency="BDT",
                method="sslcommerz_refund",
                reference=payout_ref,
                executed_by=processed_by,
                status="succeeded",
                gateway_response=refund_res.raw_response,
            )

            refund_request.status = RefundRequest.Status.SUCCEEDED
            refund_request.refunded_amount = refund_request.requested_amount
            refund_request.gateway_refund_reference = payout_ref
            refund_request.processed_by = processed_by
            refund_request.processed_at = timezone.now()
            refund_request.processing_notes = notes or "Online refund processed through gateway."
            refund_request.save()

        else:
            # Chamber payment: manual repayment workflow
            if not manual_reference or not manual_reference.strip():
                raise ValidationError(
                    "A manual repayment voucher or receipt reference is mandatory for chamber payment refunds."
                )

            payout_ref = manual_reference.strip()
            rep_method = repayment_method or "chamber_cash_repayment"

            refund_tx = RefundTransaction.objects.create(
                refund_request=refund_request,
                payment_transaction=payment_tx,
                amount=refund_request.requested_amount,
                currency="BDT",
                method=rep_method,
                reference=payout_ref,
                executed_by=processed_by,
                status="succeeded",
                gateway_response={"manual": True, "repayment_method": rep_method},
            )

            refund_request.status = RefundRequest.Status.SUCCEEDED
            refund_request.refunded_amount = refund_request.requested_amount
            refund_request.manual_repayment_reference = payout_ref
            refund_request.repayment_method = rep_method
            refund_request.processed_by = processed_by
            refund_request.processed_at = timezone.now()
            refund_request.processing_notes = notes or f"Chamber repayment recorded by {processed_by.get_full_name()}."
            refund_request.save()

        # Update Booking and Transaction payment statuses
        booking = refund_request.booking
        new_remaining = payment_tx.net_paid_remaining
        if new_remaining <= Decimal("0.00"):
            booking.payment_status = Booking.PaymentStatus.REFUNDED
            payment_tx.status = PaymentTransaction.Status.REFUNDED
        else:
            booking.payment_status = Booking.PaymentStatus.PARTIALLY_REFUNDED
            payment_tx.status = PaymentTransaction.Status.PARTIALLY_REFUNDED

        booking.save()
        payment_tx.save()

        # Audit logging
        log_audit_event(
            actor=processed_by,
            action=AuditLog.ActionChoices.REFUND_EXECUTED,
            target_user=refund_request.patient,
            details={
                "refund_reference": refund_request.refund_reference,
                "amount": str(refund_request.refunded_amount),
                "payout_reference": payout_ref,
                "remaining_balance": str(new_remaining),
                "processed_by": processed_by.username,
            },
        )

        try:
            from notifications.services import notify_refund_completed
            notify_refund_completed(refund_tx)
        except Exception:
            pass

        return True, refund_request, f"Refund of {refund_request.refunded_amount} BDT completed successfully."
