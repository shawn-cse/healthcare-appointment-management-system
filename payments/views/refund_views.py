from decimal import Decimal
from django.contrib import messages
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import PermissionDenied, ValidationError
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views import View
from django.views.generic import DetailView, ListView

from accounts.decorators import (
    AdminRequiredMixin,
    HospitalAdminRequiredMixin,
    RefundApprovalPermissionMixin,
    SuperAdminRequiredMixin,
)
from bookings.models import Booking
from payments.models import RefundRequest
from payments.services.cancellation_policy import calculate_cancellation_refund_eligibility
from payments.services.refund_service import (
    approve_refund_request,
    create_refund_request,
    process_approved_refund,
    reject_refund_request,
    review_refund_request,
)


class PatientRefundRequestView(LoginRequiredMixin, View):
    """
    Patient interface to submit or confirm a refund request for a cancelled appointment.
    Displays authoritative Dhaka timezone calculation, policy rule, and eligible amount.
    """
    template_name = "payments/refund_request.html"

    def get(self, request: HttpRequest, booking_id: int):
        booking = get_object_or_404(Booking, id=booking_id)
        if request.user != booking.patient and not request.user.is_staff_admin:
            raise PermissionDenied("You are not authorized to request a refund for this appointment.")

        eligibility = calculate_cancellation_refund_eligibility(
            booking=booking,
            current_time=timezone.now(),
            cancellation_actor_type="patient" if request.user == booking.patient else "hospital",
        )

        existing_refund = RefundRequest.objects.filter(booking=booking).exclude(
            status=RefundRequest.Status.REJECTED
        ).first()

        context = {
            "booking": booking,
            "eligibility": eligibility,
            "existing_refund": existing_refund,
            "dhaka_time": timezone.now(),
        }
        return render(request, self.template_name, context)

    def post(self, request: HttpRequest, booking_id: int):
        booking = get_object_or_404(Booking, id=booking_id)
        if request.user != booking.patient and not request.user.is_staff_admin:
            raise PermissionDenied("You are not authorized to request a refund for this appointment.")

        reason = request.POST.get("reason", "").strip()

        try:
            refund_req = create_refund_request(
                booking=booking,
                patient=booking.patient,
                reason=reason,
                cancellation_type="patient" if request.user == booking.patient else "hospital",
                current_time=timezone.now(),
                actor=request.user,
            )
            if refund_req:
                messages.success(
                    request,
                    f"Refund request #{refund_req.refund_reference} submitted successfully for {refund_req.requested_amount} BDT. It will be reviewed by administration."
                )
                return redirect("payments:refund-detail", refund_reference=refund_req.refund_reference)
            else:
                messages.info(
                    request,
                    "No monetary refund was applicable (either appointment was unpaid or ineligible under policy)."
                )
                return redirect("patients:appointment-detail", pk=booking.id)
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))
            return redirect("patients:appointment-detail", pk=booking.id)


class RefundDetailView(LoginRequiredMixin, DetailView):
    """
    Displays detailed refund request status, calculation details, approval history, and payout information.
    """
    model = RefundRequest
    template_name = "payments/refund_detail.html"
    context_object_name = "refund"
    slug_field = "refund_reference"
    slug_url_kwarg = "refund_reference"

    def get_object(self, queryset=None):
        refund = get_object_or_404(
            RefundRequest.objects.select_related(
                "booking",
                "patient",
                "doctor",
                "payment_transaction",
                "reviewed_by",
                "approved_by",
                "processed_by",
            ),
            refund_reference=self.kwargs.get("refund_reference"),
        )
        user = self.request.user
        if not (user == refund.patient or user == refund.doctor or user.is_staff_admin):
            raise PermissionDenied("You do not have access to view this refund request.")
        return refund


class AdminRefundListView(HospitalAdminRequiredMixin, ListView):
    """
    Hospital Admin & Super Admin oversight portal for all refund requests.
    Supports filtering by status tabs and comprehensive financial metrics.
    """
    model = RefundRequest
    template_name = "dashboard/refunds.html"
    context_object_name = "refunds"
    paginate_by = 25

    def get_queryset(self):
        qs = RefundRequest.objects.select_related(
            "booking", "patient", "doctor", "payment_transaction", "approved_by"
        ).order_by("-created_at")

        status_filter = self.request.GET.get("status")
        if status_filter and status_filter != "all":
            qs = qs.filter(status=status_filter)
        return qs

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        all_refunds = RefundRequest.objects.all()
        context["selected_status"] = self.request.GET.get("status", "all")
        context["count_all"] = all_refunds.count()
        context["count_requested"] = all_refunds.filter(status=RefundRequest.Status.REQUESTED).count()
        context["count_under_review"] = all_refunds.filter(status=RefundRequest.Status.UNDER_REVIEW).count()
        context["count_approved"] = all_refunds.filter(status=RefundRequest.Status.APPROVED).count()
        context["count_succeeded"] = all_refunds.filter(status=RefundRequest.Status.SUCCEEDED).count()
        context["count_rejected"] = all_refunds.filter(status=RefundRequest.Status.REJECTED).count()
        context["count_failed"] = all_refunds.filter(status=RefundRequest.Status.FAILED).count()
        return context


class AdminRefundReviewView(HospitalAdminRequiredMixin, View):
    """
    Hospital Administrator reviews and forwards refund request to UNDER_REVIEW.
    """
    def post(self, request: HttpRequest, refund_reference: str):
        refund = get_object_or_404(RefundRequest, refund_reference=refund_reference)
        notes = request.POST.get("review_notes", "").strip()

        try:
            review_refund_request(refund, reviewed_by=request.user, review_notes=notes)
            messages.success(request, f"Refund request #{refund.refund_reference} forwarded for Super Admin review.")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("payments:admin-refund-list")


class SuperAdminRefundApproveView(RefundApprovalPermissionMixin, View):
    """
    Only Super Admin has final authority to approve refund requests.
    """
    def post(self, request: HttpRequest, refund_reference: str):
        refund = get_object_or_404(RefundRequest, refund_reference=refund_reference)
        notes = request.POST.get("approval_notes", "").strip()

        try:
            approve_refund_request(refund, approved_by=request.user, approval_notes=notes)
            messages.success(request, f"Refund request #{refund.refund_reference} approved by Super Admin.")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("payments:admin-refund-list")


class SuperAdminRefundRejectView(RefundApprovalPermissionMixin, View):
    """
    Only Super Admin has final authority to reject refund requests.
    """
    def post(self, request: HttpRequest, refund_reference: str):
        refund = get_object_or_404(RefundRequest, refund_reference=refund_reference)
        reason = request.POST.get("rejection_reason", "").strip()

        if not reason:
            messages.error(request, "A reason is mandatory when rejecting a refund request.")
            return redirect("payments:admin-refund-list")

        try:
            reject_refund_request(refund, rejected_by=request.user, rejection_reason=reason)
            messages.warning(request, f"Refund request #{refund.refund_reference} rejected.")
        except ValidationError as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("payments:admin-refund-list")


class ProcessApprovedRefundView(HospitalAdminRequiredMixin, View):
    """
    Executes payment payout for an APPROVED refund request.
    """
    def post(self, request: HttpRequest, refund_reference: str):
        refund = get_object_or_404(RefundRequest, refund_reference=refund_reference)
        manual_ref = request.POST.get("manual_reference", "").strip()
        repayment_method = request.POST.get("repayment_method", "").strip()
        notes = request.POST.get("processing_notes", "").strip()

        try:
            success, refund_obj, msg = process_approved_refund(
                refund_request=refund,
                processed_by=request.user,
                manual_reference=manual_ref,
                repayment_method=repayment_method,
                notes=notes,
            )
            if success:
                messages.success(request, msg)
            else:
                messages.error(request, msg)
        except (ValidationError, PermissionDenied) as e:
            messages.error(request, e.message if hasattr(e, "message") else str(e))

        return redirect("payments:admin-refund-list")
