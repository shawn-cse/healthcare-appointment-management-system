from django.db.models import Sum, Q
from django.views.generic import ListView

from accounts.decorators import HospitalAdminRequiredMixin
from payments.models import PaymentTransaction, Receipt


class AdminPaymentTransactionListView(HospitalAdminRequiredMixin, ListView):
    """
    Hospital Admin & Super Admin dashboard list for all payment transactions and revenue oversight.
    """
    model = PaymentTransaction
    template_name = "dashboard/payments.html"
    context_object_name = "transactions"
    paginate_by = 25

    def get_queryset(self):
        qs = PaymentTransaction.objects.select_related(
            "booking", "patient", "doctor", "collected_by", "receipt"
        ).order_by("-created_at")

        method_filter = self.request.GET.get("method")
        if method_filter:
            qs = qs.filter(payment_method=method_filter)

        status_filter = self.request.GET.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        return qs

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        all_txs = PaymentTransaction.objects.all()

        total_collected = all_txs.filter(
            status__in=[PaymentTransaction.Status.SUCCESS, PaymentTransaction.Status.PARTIALLY_REFUNDED]
        ).aggregate(total=Sum("amount"))["total"] or 0

        total_refunded = all_txs.filter(
            status__in=[PaymentTransaction.Status.REFUNDED, PaymentTransaction.Status.PARTIALLY_REFUNDED]
        ).aggregate(
            total=Sum("refund_payouts__amount", filter=Q(refund_payouts__status="succeeded"))
        )["total"] or 0

        context["total_collected"] = total_collected
        context["total_refunded"] = total_refunded
        context["net_revenue"] = total_collected - total_refunded
        context["selected_method"] = self.request.GET.get("method", "")
        context["selected_status"] = self.request.GET.get("status", "")
        return context
