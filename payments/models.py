from decimal import Decimal
import secrets
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from bookings.models import Booking


def generate_transaction_reference():
    """Generates unique transaction reference e.g. GH-TXN-20261109-A1B2C3D4"""
    date_str = timezone.now().strftime("%Y%m%d")
    hex_token = secrets.token_hex(4).upper()
    return f"GH-TXN-{date_str}-{hex_token}"


def generate_receipt_number():
    """Generates unique receipt number e.g. REC-20261109-A1B2C3"""
    date_str = timezone.now().strftime("%Y%m%d")
    hex_token = secrets.token_hex(3).upper()
    return f"REC-{date_str}-{hex_token}"


def generate_refund_reference():
    """Generates unique refund reference e.g. REF-20261109-A1B2C3"""
    date_str = timezone.now().strftime("%Y%m%d")
    hex_token = secrets.token_hex(3).upper()
    return f"REF-{date_str}-{hex_token}"


class PaymentTransaction(models.Model):
    """
    Immutable or append-only financial transaction tracking every payment attempt,
    chamber collection, or online gateway transaction for Green Hospital appointments.
    """
    class PaymentMethod(models.TextChoices):
        ONLINE = "online", "Online Payment"
        CASH = "cash", "Cash at Chamber"
        CHAMBER_POS = "chamber_pos", "Chamber POS / Card"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCESS = "success", "Successful"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"
        REFUNDED = "refunded", "Refunded"
        PARTIALLY_REFUNDED = "partially_refunded", "Partially Refunded"

    transaction_reference = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        help_text="Unique verifiable transaction reference",
    )
    booking = models.ForeignKey(
        Booking,
        on_delete=models.CASCADE,
        related_name="payment_transactions",
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="patient_payments",
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="doctor_payments",
    )
    billed_fee = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Locked appointment fee snapshot in BDT",
    )
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Actual amount collected or charged in BDT",
    )
    currency = models.CharField(
        max_length=10,
        default="BDT",
        help_text="Currency code, strictly BDT",
    )
    payment_method = models.CharField(
        max_length=30,
        choices=PaymentMethod.choices,
        default=PaymentMethod.ONLINE,
    )
    payment_provider = models.CharField(
        max_length=30,
        blank=True,
        default="",
        help_text="Provider used, e.g. sslcommerz, mock, cash, chamber_pos",
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )

    # Gateway identifiers (strictly no raw bank-card numbers stored)
    gateway_transaction_id = models.CharField(
        max_length=128,
        blank=True,
        default="",
        db_index=True,
    )
    gateway_validation_id = models.CharField(
        max_length=128,
        blank=True,
        default="",
    )
    gateway_response = models.JSONField(
        default=dict,
        blank=True,
        help_text="Sanitized gateway callback / verification payload without raw card data",
    )

    # Chamber collection attributes
    collected_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="collected_payments",
        help_text="Authorized receptionist or staff admin who collected chamber payment",
    )
    collected_at = models.DateTimeField(null=True, blank=True)

    # Online checkout session expiration (prevents holding slot indefinitely)
    expires_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Expiry time for pending online checkout session",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Payment Transaction"
        verbose_name_plural = "Payment Transactions"

    def __str__(self):
        return f"[{self.transaction_reference}] {self.get_payment_method_display()} - {self.amount} BDT ({self.status})"

    def save(self, *args, **kwargs):
        if not self.transaction_reference:
            for _ in range(5):
                candidate = generate_transaction_reference()
                if not PaymentTransaction.objects.filter(transaction_reference=candidate).exists():
                    self.transaction_reference = candidate
                    break
        super().save(*args, **kwargs)

    @property
    def is_expired(self) -> bool:
        """Returns True if this online transaction has expired while still pending."""
        if self.status == self.Status.PENDING and self.expires_at:
            return timezone.now() > self.expires_at
        return False

    @property
    def total_refunded_amount(self) -> Decimal:
        """Sum of all completed refunds disbursed from this payment transaction."""
        from django.db.models import Sum
        res = self.refund_payouts.filter(status="succeeded").aggregate(total=Sum("amount"))["total"]
        return res or Decimal("0.00")

    @property
    def net_paid_remaining(self) -> Decimal:
        """Net amount remaining after previous refunds."""
        if self.status not in (self.Status.SUCCESS, self.Status.PARTIALLY_REFUNDED, self.Status.REFUNDED):
            return Decimal("0.00")
        remaining = self.amount - self.total_refunded_amount
        return max(Decimal("0.00"), remaining)


class Receipt(models.Model):
    """
    Immutable verifiable official payment receipt for Green Hospital appointments.
    """
    receipt_number = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        help_text="Unique verifiable receipt number",
    )
    transaction = models.OneToOneField(
        PaymentTransaction,
        on_delete=models.CASCADE,
        related_name="receipt",
    )
    booking = models.ForeignKey(
        Booking,
        on_delete=models.CASCADE,
        related_name="receipts",
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="patient_receipts",
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="doctor_receipts",
    )
    billed_fee = models.DecimalField(max_digits=10, decimal_places=2)
    collected_amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=10, default="BDT")
    payment_method = models.CharField(max_length=30)
    transaction_reference = models.CharField(max_length=64)
    payment_status = models.CharField(max_length=30)
    issued_at = models.DateTimeField(auto_now_add=True)
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="issued_receipts",
    )
    notes = models.TextField(blank=True, default="")
    is_valid = models.BooleanField(default=True)

    class Meta:
        ordering = ["-issued_at"]
        verbose_name = "Receipt"
        verbose_name_plural = "Receipts"

    def __str__(self):
        return f"Receipt #{self.receipt_number} ({self.collected_amount} BDT for Ref: {self.booking.appointment_reference})"

    def save(self, *args, **kwargs):
        if not self.receipt_number:
            for _ in range(5):
                candidate = generate_receipt_number()
                if not Receipt.objects.filter(receipt_number=candidate).exists():
                    self.receipt_number = candidate
                    break
        super().save(*args, **kwargs)


class RefundRequest(models.Model):
    """
    Tracks cancellation-triggered refund requests through the 8-stage lifecycle:
    1. REQUESTED
    2. UNDER_REVIEW (Reviewed and forwarded by Hospital Admin)
    3. APPROVED (Super Admin ONLY approval)
    4. REJECTED (Super Admin rejection)
    5. PROCESSING (Gateway call or manual disbursement in progress)
    6. SUCCEEDED (Confirmed disbursement)
    7. FAILED (Processing failure, can retry)
    """
    class Status(models.TextChoices):
        REQUESTED = "requested", "Requested"
        UNDER_REVIEW = "under_review", "Under Review"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        PROCESSING = "processing", "Processing"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    class CancellationType(models.TextChoices):
        PATIENT = "patient", "Patient Cancellation"
        DOCTOR = "doctor", "Doctor Cancellation"
        HOSPITAL = "hospital", "Hospital Cancellation"

    refund_reference = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        help_text="Unique verifiable refund reference",
    )
    booking = models.ForeignKey(
        Booking,
        on_delete=models.CASCADE,
        related_name="refund_requests",
    )
    payment_transaction = models.ForeignKey(
        PaymentTransaction,
        on_delete=models.CASCADE,
        related_name="refund_requests",
    )
    patient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="refund_requests",
    )
    doctor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="doctor_refund_requests",
    )
    original_paid_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Original amount successfully collected in BDT",
    )
    eligible_refund_percentage = models.PositiveSmallIntegerField(
        default=100,
        help_text="Calculated policy percentage: 100, 80, or 0",
    )
    eligible_refund_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Calculated maximum eligible refund based on Green Hospital policy",
    )
    requested_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        help_text="Requested refund amount in BDT",
    )
    refunded_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0.00"),
        help_text="Actual amount repaid upon SUCCEEDED status",
    )
    reason = models.TextField(
        blank=True,
        default="",
        help_text="Stated reason for cancellation and refund request",
    )
    cancellation_actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="cancellations_initiated",
    )
    cancellation_type = models.CharField(
        max_length=30,
        choices=CancellationType.choices,
        default=CancellationType.PATIENT,
    )
    policy_applied = models.CharField(
        max_length=100,
        blank=True,
        default="",
        help_text="Policy rule description applied during eligibility calculation",
    )
    hours_before_start = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Authoritative hours difference in Asia/Dhaka at cancellation time",
    )
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.REQUESTED,
        db_index=True,
    )

    # Review by Hospital Admin / Super Admin
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="refunds_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True, default="")

    # Approval strictly by Super Admin
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="refunds_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default="")

    # Execution / processing details
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="refunds_processed",
    )
    processed_at = models.DateTimeField(null=True, blank=True)
    gateway_refund_reference = models.CharField(max_length=128, blank=True, default="")
    manual_repayment_reference = models.CharField(
        max_length=128,
        blank=True,
        default="",
        help_text="Voucher or cash register reference for chamber repayments",
    )
    repayment_method = models.CharField(max_length=30, blank=True, default="")
    processing_notes = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Refund Request"
        verbose_name_plural = "Refund Requests"

    def __str__(self):
        return f"[{self.refund_reference}] {self.requested_amount} BDT ({self.status}) for Ref: {self.booking.appointment_reference}"

    def save(self, *args, **kwargs):
        if not self.refund_reference:
            for _ in range(5):
                candidate = generate_refund_reference()
                if not RefundRequest.objects.filter(refund_reference=candidate).exists():
                    self.refund_reference = candidate
                    break
        super().save(*args, **kwargs)


class RefundTransaction(models.Model):
    """
    Immutable ledger of completed or attempted monetary payouts for refunds.
    """
    refund_request = models.ForeignKey(
        RefundRequest,
        on_delete=models.CASCADE,
        related_name="payout_transactions",
    )
    payment_transaction = models.ForeignKey(
        PaymentTransaction,
        on_delete=models.CASCADE,
        related_name="refund_payouts",
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    currency = models.CharField(max_length=10, default="BDT")
    method = models.CharField(
        max_length=30,
        help_text="Payment provider method used: sslcommerz_refund, chamber_cash_repayment, pos_reversal, mock_refund",
    )
    reference = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        help_text="Gateway or cashier payout reference",
    )
    executed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="executed_refunds",
    )
    status = models.CharField(
        max_length=30,
        choices=[("succeeded", "Succeeded"), ("failed", "Failed")],
        default="succeeded",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    gateway_response = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Refund Transaction"
        verbose_name_plural = "Refund Transactions"

    def __str__(self):
        return f"Payout [{self.reference}] {self.amount} BDT ({self.status})"
