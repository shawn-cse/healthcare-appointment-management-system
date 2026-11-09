from django.urls import path
from payments.views import (
    CheckoutStartView,
    SSLCommerzSuccessView,
    SSLCommerzFailView,
    SSLCommerzCancelView,
    SSLCommerzIPNView,
    MockGatewayView,
    ChamberPaymentCollectView,
    ReceiptDetailView,
    ReceiptPrintView,
    PatientRefundRequestView,
    RefundDetailView,
    AdminRefundListView,
    AdminRefundReviewView,
    SuperAdminRefundApproveView,
    SuperAdminRefundRejectView,
    ProcessApprovedRefundView,
    DoctorCancelSessionView,
    AdminPaymentTransactionListView,
)

app_name = "payments"

urlpatterns = [
    # Online Checkout & Gateway Callbacks
    path("checkout/<int:booking_id>/", CheckoutStartView.as_view(), name="checkout-start"),
    path("sslcommerz/success/", SSLCommerzSuccessView.as_view(), name="sslcommerz-success"),
    path("sslcommerz/fail/", SSLCommerzFailView.as_view(), name="sslcommerz-fail"),
    path("sslcommerz/cancel/", SSLCommerzCancelView.as_view(), name="sslcommerz-cancel"),
    path("sslcommerz/ipn/", SSLCommerzIPNView.as_view(), name="sslcommerz-ipn"),

    # Local Mock Sandbox (Development & Testing)
    path("mock-gateway/<str:tran_id>/", MockGatewayView.as_view(), name="mock-gateway"),

    # Chamber Payment Collection (Cash / POS)
    path("chamber-collect/<int:booking_id>/", ChamberPaymentCollectView.as_view(), name="chamber-collect"),

    # Verifiable Official Receipts
    path("receipt/<str:receipt_number>/", ReceiptDetailView.as_view(), name="receipt-detail"),
    path("receipt/<str:receipt_number>/print/", ReceiptPrintView.as_view(), name="receipt-print"),

    # Patient & Administrative Refund Workflows
    path("refund/request/<int:booking_id>/", PatientRefundRequestView.as_view(), name="refund-request"),
    path("refund/<str:refund_reference>/", RefundDetailView.as_view(), name="refund-detail"),
    path("admin/refunds/", AdminRefundListView.as_view(), name="admin-refund-list"),
    path("admin/refunds/<str:refund_reference>/review/", AdminRefundReviewView.as_view(), name="admin-refund-review"),
    path("admin/refunds/<str:refund_reference>/approve/", SuperAdminRefundApproveView.as_view(), name="superadmin-refund-approve"),
    path("admin/refunds/<str:refund_reference>/reject/", SuperAdminRefundRejectView.as_view(), name="superadmin-refund-reject"),
    path("admin/refunds/<str:refund_reference>/process/", ProcessApprovedRefundView.as_view(), name="admin-refund-process"),

    # Doctor / Hospital Session Cancellation
    path("session-cancel/", DoctorCancelSessionView.as_view(), name="doctor-session-cancel"),
    path("session-cancel/<int:doctor_id>/", DoctorCancelSessionView.as_view(), name="admin-doctor-session-cancel"),

    # Admin Transactions & Revenue Oversight
    path("admin/transactions/", AdminPaymentTransactionListView.as_view(), name="admin-transactions"),
]
