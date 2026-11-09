from decimal import Decimal
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.views import View

from bookings.models import Booking
from payments.services.payment_service import record_chamber_payment_collection


class ChamberPaymentCollectView(LoginRequiredMixin, View):
    """
    Interface for authorized receptionists and staff admins to record chamber payments.
    - Validates receptionist is explicitly assigned to this doctor.
    - Prevents duplicate chamber payments.
    - Enforces collected amount matches locked snapshot fee in BDT.
    - Preserves staff identity, timestamp, amount, and payment method.
    """
    def post(self, request: HttpRequest, booking_id: int):
        booking = get_object_or_404(Booking, id=booking_id)

        # Authorization check
        if not request.user.is_staff_admin:
            if not (request.user.is_receptionist and request.user.can_access_doctor(booking.doctor)):
                raise PermissionDenied(
                    "You are not authorized to collect chamber payments for this doctor."
                )

        amount_str = request.POST.get("amount", "").strip()
        try:
            amount = Decimal(amount_str) if amount_str else booking.fee_amount
        except Exception:
            messages.error(request, "Invalid payment amount format.")
            return redirect(request.META.get("HTTP_REFERER") or "bookings:booking-list")

        method = request.POST.get("payment_method", "cash").strip()
        notes = request.POST.get("notes", "").strip()

        try:
            tx, receipt = record_chamber_payment_collection(
                booking=booking,
                collected_by=request.user,
                amount=amount,
                method=method,
                notes=notes,
                request=request,
            )
            messages.success(
                request,
                f"Chamber payment of {tx.amount} BDT recorded successfully. Receipt #{receipt.receipt_number} issued."
            )
            return redirect("payments:receipt-detail", receipt_number=receipt.receipt_number)
        except (ValidationError, PermissionDenied) as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))
            return redirect(request.META.get("HTTP_REFERER") or "bookings:booking-list")
