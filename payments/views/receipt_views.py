from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404, render
from django.template.loader import render_to_string
from django.views.generic import DetailView

from payments.models import Receipt


class ReceiptAccessMixin:
    """Ensures only the patient, doctor, assigned receptionist, or admin can access the receipt."""
    def check_receipt_access(self, receipt):
        user = self.request.user
        if (
            user == receipt.patient
            or user == receipt.doctor
            or user.is_staff_admin
            or (user.is_receptionist and user.can_access_doctor(receipt.doctor))
        ):
            return True
        raise PermissionDenied("You do not have access to view this payment receipt.")


class ReceiptDetailView(LoginRequiredMixin, ReceiptAccessMixin, DetailView):
    """
    Displays the verifiable Green Hospital official payment receipt.
    """
    model = Receipt
    template_name = "payments/receipt_detail.html"
    context_object_name = "receipt"
    slug_field = "receipt_number"
    slug_url_kwarg = "receipt_number"

    def get_object(self, queryset=None):
        receipt = get_object_or_404(
            Receipt.objects.select_related(
                "booking",
                "patient",
                "patient__profile",
                "doctor",
                "doctor__profile",
                "transaction",
                "issued_by",
            ),
            receipt_number=self.kwargs.get("receipt_number"),
        )
        self.check_receipt_access(receipt)
        return receipt


class ReceiptPrintView(LoginRequiredMixin, ReceiptAccessMixin, DetailView):
    """
    Printable clean view of the official Green Hospital receipt.
    """
    model = Receipt
    template_name = "payments/receipt_print.html"
    context_object_name = "receipt"
    slug_field = "receipt_number"
    slug_url_kwarg = "receipt_number"

    def get_object(self, queryset=None):
        receipt = get_object_or_404(
            Receipt.objects.select_related(
                "booking",
                "patient",
                "patient__profile",
                "doctor",
                "doctor__profile",
                "transaction",
                "issued_by",
            ),
            receipt_number=self.kwargs.get("receipt_number"),
        )
        self.check_receipt_access(receipt)
        return receipt

    def render_to_response(self, context, **response_kwargs):
        html_string = render_to_string(self.template_name, context, request=self.request)
        return HttpResponse(html_string)
