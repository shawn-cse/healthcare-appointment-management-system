from datetime import timedelta
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple
from django.conf import settings
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import transaction
from django.http import HttpRequest
from django.urls import reverse
from django.utils import timezone

from accounts.models import AuditLog, User, log_audit_event
from bookings.models import Booking
from payments.gateways.base import (
    GatewayConfigurationError,
    GatewayPaymentError,
    PaymentInitiationResult,
    PaymentVerificationResult,
)
from payments.gateways.factory import get_payment_gateway
from payments.models import PaymentTransaction, Receipt


def initiate_online_payment(
    booking: Booking,
    request: HttpRequest,
    provider: Optional[str] = None,
) -> PaymentInitiationResult:
    """
    Initiates an online checkout session for an appointment with authoritative fee snapshot.
    Enforces a 15-minute checkout expiration window to prevent holding slot capacity indefinitely.
    """
    if booking.status == Booking.StatusChoices.CANCELLED:
        raise ValidationError("Cannot initiate payment for a cancelled appointment.")
    if booking.payment_status == Booking.PaymentStatus.PAID:
        raise ValidationError("This appointment has already been paid.")
    if booking.fee_amount <= Decimal("0.00"):
        raise ValidationError("Appointment fee is zero; payment is not required.")

    gateway = get_payment_gateway(provider)

    with transaction.atomic():
        # Check if an existing pending transaction exists within its valid window
        active_tx = (
            PaymentTransaction.objects.select_for_update()
            .filter(
                booking=booking,
                payment_method=PaymentTransaction.PaymentMethod.ONLINE,
                status=PaymentTransaction.Status.PENDING,
            )
            .first()
        )

        now = timezone.now()
        checkout_timeout_minutes = getattr(settings, "PAYMENT_CHECKOUT_TIMEOUT_MINUTES", 15)
        expires_at = now + timedelta(minutes=checkout_timeout_minutes)

        if active_tx and not active_tx.is_expired:
            tx = active_tx
            tx.expires_at = expires_at
            tx.save()
        else:
            if active_tx and active_tx.is_expired:
                active_tx.status = PaymentTransaction.Status.CANCELLED
                active_tx.save()

            # Create new pending transaction bound to server snapshot fee
            tx = PaymentTransaction.objects.create(
                booking=booking,
                patient=booking.patient,
                doctor=booking.doctor,
                billed_fee=booking.fee_amount,
                amount=booking.fee_amount,
                currency="BDT",
                payment_method=PaymentTransaction.PaymentMethod.ONLINE,
                payment_provider="sslcommerz" if not getattr(gateway, "simulate_failure", None) else "mock",
                status=PaymentTransaction.Status.PENDING,
                expires_at=expires_at,
            )

        success_url = request.build_absolute_uri(reverse("payments:sslcommerz-success"))
        fail_url = request.build_absolute_uri(reverse("payments:sslcommerz-fail"))
        cancel_url = request.build_absolute_uri(reverse("payments:sslcommerz-cancel"))
        ipn_url = request.build_absolute_uri(reverse("payments:sslcommerz-ipn"))

        initiation_result = gateway.initiate_payment(
            transaction=tx,
            request=request,
            success_url=success_url,
            fail_url=fail_url,
            cancel_url=cancel_url,
            ipn_url=ipn_url,
        )

        if not initiation_result.success:
            tx.status = PaymentTransaction.Status.FAILED
            tx.gateway_response = initiation_result.raw_response
            tx.save()
            log_audit_event(
                actor=request.user,
                action=AuditLog.ActionChoices.PAYMENT_FAILED,
                target_user=booking.patient,
                details={
                    "booking_id": booking.id,
                    "transaction_ref": tx.transaction_reference,
                    "reason": initiation_result.error_message,
                },
                ip_address=request.META.get("REMOTE_ADDR"),
            )

        return initiation_result


def process_gateway_callback(
    tran_id: str,
    val_id: str = "",
    raw_post_data: Optional[Dict[str, Any]] = None,
    request: Optional[HttpRequest] = None,
    provider: Optional[str] = None,
) -> Tuple[bool, Optional[PaymentTransaction], Optional[Receipt], str]:
    """
    Idempotent server-side payment verification and receipt issuing.
    - Never trusts frontend confirmation alone; validates with gateway server API.
    - Rejects and logs amount tampering attempts.
    - Generates unique receipt upon success.
    - Transitions booking status to CONFIRMED and PAID.
    """
    gateway = get_payment_gateway(provider)

    with transaction.atomic():
        tx = (
            PaymentTransaction.objects.select_for_update()
            .filter(transaction_reference=tran_id)
            .select_related("booking", "patient", "doctor")
            .first()
        )

        if not tx:
            return False, None, None, f"Payment transaction '{tran_id}' not found."

        # Idempotency check: Already processed successfully
        if tx.status == PaymentTransaction.Status.SUCCESS:
            existing_receipt = getattr(tx, "receipt", None)
            return True, tx, existing_receipt, "Payment was already verified and processed successfully."

        # Server-side verification
        verification = gateway.verify_payment(
            tran_id=tran_id,
            val_id=val_id,
            raw_data=raw_post_data,
        )

        if not verification.is_valid:
            tx.status = PaymentTransaction.Status.FAILED
            tx.gateway_response = verification.raw_response
            tx.save()

            log_audit_event(
                actor=request.user if request and request.user.is_authenticated else None,
                action=AuditLog.ActionChoices.PAYMENT_FAILED,
                target_user=tx.patient,
                details={
                    "booking_id": tx.booking.id,
                    "transaction_ref": tx.transaction_reference,
                    "error": verification.error_message,
                },
                ip_address=request.META.get("REMOTE_ADDR") if request else None,
            )
            # Notify payment failed
            try:
                from notifications.services import notify_payment_failed
                notify_payment_failed(tx, reason=verification.error_message)
            except Exception:
                pass
            return False, tx, None, verification.error_message

        # Financial integrity & amount tampering check
        if verification.amount != tx.billed_fee:
            tx.status = PaymentTransaction.Status.FAILED
            tx.gateway_response = {
                "tampering_detected": True,
                "expected_amount": str(tx.billed_fee),
                "gateway_verified_amount": str(verification.amount),
                "raw": verification.raw_response,
            }
            tx.save()

            log_audit_event(
                actor=None,
                action=AuditLog.ActionChoices.PAYMENT_FAILED,
                target_user=tx.patient,
                details={
                    "booking_id": tx.booking.id,
                    "transaction_ref": tx.transaction_reference,
                    "security_alert": "Amount tampering detected",
                    "expected": str(tx.billed_fee),
                    "received": str(verification.amount),
                },
                ip_address=request.META.get("REMOTE_ADDR") if request else None,
            )
            return False, tx, None, f"Amount tampering detected: expected {tx.billed_fee} BDT, got {verification.amount} BDT."

        if verification.currency != "BDT":
            tx.status = PaymentTransaction.Status.FAILED
            tx.save()
            return False, tx, None, f"Currency mismatch: expected BDT, got {verification.currency}."

        # Mark transaction as SUCCESS
        tx.status = PaymentTransaction.Status.SUCCESS
        tx.amount = verification.amount
        tx.gateway_transaction_id = verification.bank_tran_id or verification.tran_id
        tx.gateway_validation_id = verification.val_id
        tx.gateway_response = verification.raw_response
        tx.save()

        # Generate unique receipt
        receipt, _ = Receipt.objects.get_or_create(
            transaction=tx,
            defaults={
                "booking": tx.booking,
                "patient": tx.patient,
                "doctor": tx.doctor,
                "billed_fee": tx.billed_fee,
                "collected_amount": tx.amount,
                "currency": "BDT",
                "payment_method": tx.payment_method,
                "transaction_reference": tx.transaction_reference,
                "payment_status": "PAID",
                "issued_by": tx.patient,
                "notes": f"Online payment via {verification.card_type or 'SSLCOMMERZ'}",
            },
        )

        # Update booking payment status and confirm booking if pending
        booking = tx.booking
        booking.payment_status = Booking.PaymentStatus.PAID
        booking.payment_method = Booking.PaymentMethod.ONLINE
        if booking.status == Booking.StatusChoices.PENDING:
            booking.transition_to(
                Booking.StatusChoices.CONFIRMED,
                actor=tx.patient,
                reason="Online payment verified and confirmed.",
            )
        else:
            booking.save()

        # Audit logging
        log_audit_event(
            actor=tx.patient,
            action=AuditLog.ActionChoices.PAYMENT_PROCESSED,
            target_user=tx.patient,
            details={
                "booking_id": booking.id,
                "transaction_ref": tx.transaction_reference,
                "receipt_number": receipt.receipt_number,
                "amount": str(tx.amount),
                "method": "online",
                "bank_tran_id": verification.bank_tran_id,
            },
            ip_address=request.META.get("REMOTE_ADDR") if request else None,
        )

        # Notify payment success
        try:
            from notifications.services import notify_payment_success
            notify_payment_success(tx)
        except Exception:
            pass

        return True, tx, receipt, "Payment successfully verified and recorded."


def record_chamber_payment_collection(
    booking: Booking,
    collected_by: User,
    amount: Decimal,
    method: str = "cash",
    notes: str = "",
    request: Optional[HttpRequest] = None,
) -> Tuple[PaymentTransaction, Receipt]:
    """
    Records in-person cash or supported chamber POS payment collection by authorized staff.
    - Enforces receptionist-to-doctor assignment permission or staff admin role.
    - Prevents duplicate chamber payment records.
    - Validates collected amount matches stored fee snapshot in BDT.
    - Preserves staff identity, timestamp, amount, and payment method.
    """
    if not collected_by.is_staff_admin:
        if not (collected_by.is_receptionist and collected_by.can_access_doctor(booking.doctor)):
            raise PermissionDenied(
                "You are not authorized to collect chamber payments for this doctor."
            )

    if booking.status == Booking.StatusChoices.CANCELLED:
        raise ValidationError("Cannot collect payment for a cancelled appointment.")

    if booking.payment_status == Booking.PaymentStatus.PAID:
        raise ValidationError("Payment has already been collected for this appointment.")

    # Strict fee snapshot check (detect underpayment / tampering)
    if Decimal(str(amount)) != booking.fee_amount:
        raise ValidationError(
            f"Collected amount ({amount} BDT) must exactly match the appointment fee ({booking.fee_amount} BDT)."
        )

    with transaction.atomic():
        # Prevent race condition on duplicate payment collection
        locked_booking = Booking.objects.select_for_update().get(id=booking.id)
        if locked_booking.payment_status == Booking.PaymentStatus.PAID:
            raise ValidationError("Payment has already been collected for this appointment.")

        tx_method = (
            PaymentTransaction.PaymentMethod.CHAMBER_POS
            if method.lower() in ("pos", "card", "chamber_pos")
            else PaymentTransaction.PaymentMethod.CASH
        )

        tx = PaymentTransaction.objects.create(
            booking=locked_booking,
            patient=locked_booking.patient,
            doctor=locked_booking.doctor,
            billed_fee=locked_booking.fee_amount,
            amount=locked_booking.fee_amount,
            currency="BDT",
            payment_method=tx_method,
            payment_provider="chamber_pos" if tx_method == PaymentTransaction.PaymentMethod.CHAMBER_POS else "cash",
            status=PaymentTransaction.Status.SUCCESS,
            collected_by=collected_by,
            collected_at=timezone.now(),
        )

        receipt = Receipt.objects.create(
            transaction=tx,
            booking=locked_booking,
            patient=locked_booking.patient,
            doctor=locked_booking.doctor,
            billed_fee=locked_booking.fee_amount,
            collected_amount=locked_booking.fee_amount,
            currency="BDT",
            payment_method=tx.get_payment_method_display(),
            transaction_reference=tx.transaction_reference,
            payment_status="PAID",
            issued_by=collected_by,
            notes=notes or f"Chamber collection by {collected_by.get_full_name()}",
        )

        locked_booking.payment_status = Booking.PaymentStatus.PAID
        locked_booking.payment_method = Booking.PaymentMethod.PAY_AT_CHAMBER
        locked_booking.save()

        # Audit logging
        log_audit_event(
            actor=collected_by,
            action=AuditLog.ActionChoices.PAYMENT_COLLECTED,
            target_user=locked_booking.patient,
            details={
                "booking_id": locked_booking.id,
                "transaction_ref": tx.transaction_reference,
                "receipt_number": receipt.receipt_number,
                "amount": str(tx.amount),
                "method": tx_method,
                "collected_by": collected_by.username,
            },
            ip_address=request.META.get("REMOTE_ADDR") if request else None,
        )

        # Notify payment success
        try:
            from notifications.services import notify_payment_success
            notify_payment_success(tx)
        except Exception:
            pass

        return tx, receipt


def expire_abandoned_online_sessions() -> int:
    """
    Cleans up expired pending online payment sessions.
    Avoids holding appointment capacity indefinitely for unpaid pending-online sessions,
    while retaining confirmed Pay at Chamber bookings according to hospital policy.
    """
    now = timezone.now()
    expired_txs = PaymentTransaction.objects.filter(
        status=PaymentTransaction.Status.PENDING,
        expires_at__lt=now,
    ).select_related("booking")

    count = 0
    for tx in expired_txs:
        with transaction.atomic():
            tx.status = PaymentTransaction.Status.CANCELLED
            tx.save()

            booking = tx.booking
            # Only cancel if booking is still PENDING and UNPAID
            if booking.status == Booking.StatusChoices.PENDING and booking.payment_status == Booking.PaymentStatus.UNPAID:
                booking.transition_to(
                    Booking.StatusChoices.CANCELLED,
                    actor=None,
                    reason="Online checkout session expired / abandoned.",
                )
                count += 1
    return count
