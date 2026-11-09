from decimal import Decimal
from django.conf import settings
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils.decorators import method_decorator
from django.views import View
from django.views.decorators.csrf import csrf_exempt

from bookings.models import Booking
from payments.gateways.base import GatewayConfigurationError
from payments.models import PaymentTransaction, Receipt
from payments.services.payment_service import (
    initiate_online_payment,
    process_gateway_callback,
)


class CheckoutStartView(LoginRequiredMixin, View):
    """
    Initiates online checkout for an appointment.
    Ensures that only the booking's patient or authorized staff can start checkout.
    """
    def get(self, request: HttpRequest, booking_id: int):
        booking = get_object_or_404(Booking, id=booking_id)

        # Access control
        if not (request.user == booking.patient or request.user.is_staff_admin):
            raise PermissionDenied("You are not authorized to pay for this appointment.")

        if booking.status == Booking.StatusChoices.CANCELLED:
            messages.error(request, "Cannot initiate payment for a cancelled appointment.")
            return redirect("patients:dashboard")

        if booking.payment_status == Booking.PaymentStatus.PAID:
            messages.info(request, "This appointment has already been paid.")
            return redirect("patients:appointment-detail", pk=booking.id)

        try:
            init_res = initiate_online_payment(booking=booking, request=request)
            if init_res.success and init_res.gateway_url:
                return redirect(init_res.gateway_url)
            else:
                messages.error(request, f"Unable to start payment session: {init_res.error_message}")
                return redirect("patients:appointment-detail", pk=booking.id)
        except GatewayConfigurationError as e:
            messages.error(
                request,
                f"Online payment gateway is temporarily unconfigured: {str(e)}"
            )
            return redirect("patients:appointment-detail", pk=booking.id)
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))
            return redirect("patients:appointment-detail", pk=booking.id)


@method_decorator(csrf_exempt, name="dispatch")
class SSLCommerzSuccessView(View):
    """
    Handles payment gateway redirect callback for successful transactions.
    Authoritatively validates response server-to-server before confirming payment.
    """
    def post(self, request: HttpRequest):
        tran_id = request.POST.get("tran_id", "")
        val_id = request.POST.get("val_id", "")

        is_valid, tx, receipt, msg = process_gateway_callback(
            tran_id=tran_id,
            val_id=val_id,
            raw_post_data=request.POST.dict(),
            request=request,
        )

        if is_valid and tx and receipt:
            messages.success(
                request,
                f"Payment successful! Receipt #{receipt.receipt_number} generated for Ref: {tx.booking.appointment_reference}."
            )
            return redirect("payments:receipt-detail", receipt_number=receipt.receipt_number)
        else:
            messages.error(request, f"Payment verification failed: {msg}")
            return render(
                request,
                "payments/payment_failed.html",
                {"error_message": msg, "tran_id": tran_id},
            )

    def get(self, request: HttpRequest):
        # Some gateways or fallback redirects use GET
        tran_id = request.GET.get("tran_id", "")
        val_id = request.GET.get("val_id", "")
        is_valid, tx, receipt, msg = process_gateway_callback(
            tran_id=tran_id,
            val_id=val_id,
            raw_post_data=request.GET.dict(),
            request=request,
        )
        if is_valid and receipt:
            return redirect("payments:receipt-detail", receipt_number=receipt.receipt_number)
        return render(
            request,
            "payments/payment_failed.html",
            {"error_message": msg, "tran_id": tran_id},
        )


@method_decorator(csrf_exempt, name="dispatch")
class SSLCommerzFailView(View):
    """
    Handles payment failure notification from gateway.
    """
    def post(self, request: HttpRequest):
        tran_id = request.POST.get("tran_id", "")
        reason = request.POST.get("error") or request.POST.get("failedreason") or "Payment was declined by provider."
        tx = PaymentTransaction.objects.filter(transaction_reference=tran_id).first()
        if tx and tx.status == PaymentTransaction.Status.PENDING:
            tx.status = PaymentTransaction.Status.FAILED
            tx.gateway_response = request.POST.dict()
            tx.save()

        return render(
            request,
            "payments/payment_failed.html",
            {"error_message": reason, "tran_id": tran_id, "transaction": tx},
        )

    def get(self, request: HttpRequest):
        return self.post(request)


@method_decorator(csrf_exempt, name="dispatch")
class SSLCommerzCancelView(View):
    """
    Handles payment cancellation by customer at the gateway.
    """
    def post(self, request: HttpRequest):
        tran_id = request.POST.get("tran_id", "")
        tx = PaymentTransaction.objects.filter(transaction_reference=tran_id).first()
        if tx and tx.status == PaymentTransaction.Status.PENDING:
            tx.status = PaymentTransaction.Status.CANCELLED
            tx.gateway_response = request.POST.dict()
            tx.save()

        return render(
            request,
            "payments/payment_cancelled.html",
            {"tran_id": tran_id, "transaction": tx},
        )

    def get(self, request: HttpRequest):
        return self.post(request)


@method_decorator(csrf_exempt, name="dispatch")
class SSLCommerzIPNView(View):
    """
    Instant Payment Notification (IPN) server-to-server callback.
    Enforces idempotency and server-side validation.
    """
    def post(self, request: HttpRequest):
        tran_id = request.POST.get("tran_id", "")
        val_id = request.POST.get("val_id", "")

        if not tran_id:
            return JsonResponse({"status": "FAILED", "error": "Missing tran_id"}, status=400)

        is_valid, tx, receipt, msg = process_gateway_callback(
            tran_id=tran_id,
            val_id=val_id,
            raw_post_data=request.POST.dict(),
            request=request,
        )

        if is_valid:
            return JsonResponse({
                "status": "SUCCESS",
                "message": msg,
                "transaction_reference": tx.transaction_reference if tx else tran_id,
                "receipt_number": receipt.receipt_number if receipt else None,
            })
        else:
            return JsonResponse({
                "status": "FAILED",
                "error": msg,
            }, status=400)


class MockGatewayView(View):
    """
    Safe developer UI for testing payments locally when MockPaymentGateway is enabled.
    Simulates gateway scenarios: Success, Fail, Cancel, and Tampered Amount.
    """
    def get(self, request: HttpRequest, tran_id: str):
        if not getattr(settings, "ALLOW_MOCK_PAYMENTS", False) and not getattr(settings, "DEBUG", False):
            raise PermissionDenied("Mock gateway is disabled.")

        tx = get_object_or_404(PaymentTransaction, transaction_reference=tran_id)
        return render(
            request,
            "payments/mock_gateway.html",
            {
                "transaction": tx,
                "booking": tx.booking,
                "patient": tx.patient,
                "doctor": tx.doctor,
            },
        )

    def post(self, request: HttpRequest, tran_id: str):
        if not getattr(settings, "ALLOW_MOCK_PAYMENTS", False) and not getattr(settings, "DEBUG", False):
            raise PermissionDenied("Mock gateway is disabled.")

        tx = get_object_or_404(PaymentTransaction, transaction_reference=tran_id)
        action = request.POST.get("action", "success")

        if action == "success":
            val_id = f"MOCK-VAL-{tran_id[:8]}"
            payload = {
                "tran_id": tran_id,
                "val_id": val_id,
                "amount": str(tx.billed_fee),
                "currency": "BDT",
                "card_type": "MOCK-VISA-DBBL",
                "bank_tran_id": f"BANK-{tran_id[:8]}",
                "status": "VALID",
            }
            is_valid, tx_obj, receipt, msg = process_gateway_callback(
                tran_id=tran_id,
                val_id=val_id,
                raw_post_data=payload,
                request=request,
            )
            if is_valid and receipt:
                messages.success(request, f"Mock payment succeeded! Receipt #{receipt.receipt_number}.")
                return redirect("payments:receipt-detail", receipt_number=receipt.receipt_number)
            else:
                messages.error(request, f"Mock verification failed: {msg}")
                return redirect("payments:sslcommerz-fail")

        elif action == "tamper":
            # Amount tampering simulation
            tampered_amount = tx.billed_fee - Decimal("200.00")
            val_id = f"MOCK-VAL-TAMPERED-{tran_id[:6]}"
            payload = {
                "tran_id": tran_id,
                "val_id": val_id,
                "amount": str(tampered_amount),
                "currency": "BDT",
                "status": "VALID",
            }
            is_valid, tx_obj, receipt, msg = process_gateway_callback(
                tran_id=tran_id,
                val_id=val_id,
                raw_post_data=payload,
                request=request,
            )
            messages.error(request, f"Security Alert: {msg}")
            return render(
                request,
                "payments/payment_failed.html",
                {"error_message": msg, "tran_id": tran_id},
            )

        elif action == "cancel":
            tx.status = PaymentTransaction.Status.CANCELLED
            tx.save()
            return redirect("payments:sslcommerz-cancel")

        else:
            # action == "fail"
            tx.status = PaymentTransaction.Status.FAILED
            tx.save()
            return redirect("payments:sslcommerz-fail")
