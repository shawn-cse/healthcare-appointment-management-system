from django.contrib import admin
from payments.models import PaymentTransaction, Receipt, RefundRequest, RefundTransaction


@admin.register(PaymentTransaction)
class PaymentTransactionAdmin(admin.ModelAdmin):
    list_display = (
        "transaction_reference",
        "booking",
        "patient",
        "doctor",
        "amount",
        "currency",
        "payment_method",
        "status",
        "created_at",
    )
    list_filter = ("status", "payment_method", "currency", "created_at")
    search_fields = (
        "transaction_reference",
        "gateway_transaction_id",
        "patient__username",
        "doctor__username",
        "booking__appointment_reference",
    )
    readonly_fields = (
        "transaction_reference",
        "created_at",
        "updated_at",
        "gateway_response",
    )


@admin.register(Receipt)
class ReceiptAdmin(admin.ModelAdmin):
    list_display = (
        "receipt_number",
        "booking",
        "patient",
        "doctor",
        "collected_amount",
        "payment_method",
        "payment_status",
        "issued_at",
    )
    list_filter = ("payment_status", "payment_method", "issued_at")
    search_fields = (
        "receipt_number",
        "transaction_reference",
        "patient__username",
        "doctor__username",
    )
    readonly_fields = ("receipt_number", "issued_at")


@admin.register(RefundRequest)
class RefundRequestAdmin(admin.ModelAdmin):
    list_display = (
        "refund_reference",
        "booking",
        "patient",
        "requested_amount",
        "eligible_refund_percentage",
        "status",
        "cancellation_type",
        "created_at",
    )
    list_filter = ("status", "cancellation_type", "created_at")
    search_fields = (
        "refund_reference",
        "booking__appointment_reference",
        "patient__username",
        "doctor__username",
    )
    readonly_fields = ("refund_reference", "created_at", "updated_at")


@admin.register(RefundTransaction)
class RefundTransactionAdmin(admin.ModelAdmin):
    list_display = (
        "reference",
        "refund_request",
        "amount",
        "currency",
        "method",
        "status",
        "created_at",
    )
    list_filter = ("status", "method", "created_at")
    search_fields = ("reference", "refund_request__refund_reference")
    readonly_fields = ("reference", "created_at", "gateway_response")
