from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, Optional
from django.http import HttpRequest


class GatewayConfigurationError(Exception):
    """Raised when payment gateway credentials or settings are missing/invalid."""
    pass


class GatewayPaymentError(Exception):
    """Raised when an operation with the payment gateway fails."""
    pass


@dataclass
class PaymentInitiationResult:
    success: bool
    gateway_url: str = ""
    session_id: str = ""
    error_message: str = ""
    raw_response: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PaymentVerificationResult:
    is_valid: bool
    tran_id: str = ""
    val_id: str = ""
    amount: Decimal = Decimal("0.00")
    currency: str = "BDT"
    bank_tran_id: str = ""
    card_type: str = ""
    error_message: str = ""
    raw_response: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RefundResult:
    is_successful: bool
    refund_ref_id: str = ""
    refunded_amount: Decimal = Decimal("0.00")
    error_message: str = ""
    raw_response: Dict[str, Any] = field(default_factory=dict)


class BasePaymentGateway(ABC):
    """
    Abstract payment gateway interface for Green Hospital.
    Decouples business logic from specific gateways (SSLCOMMERZ, Mock sandbox, etc.)
    """

    @abstractmethod
    def initiate_payment(
        self,
        transaction,
        request: HttpRequest,
        success_url: str,
        fail_url: str,
        cancel_url: str,
        ipn_url: str,
    ) -> PaymentInitiationResult:
        """
        Creates a payment session with the provider for the specified transaction.
        Transaction amount must match the appointment's stored fee snapshot in BDT.
        """
        pass

    @abstractmethod
    def verify_payment(
        self,
        tran_id: str,
        val_id: str = "",
        raw_data: Optional[Dict[str, Any]] = None,
    ) -> PaymentVerificationResult:
        """
        Performs authoritative server-side verification of gateway response.
        Never trusts unverified frontend redirects alone.
        """
        pass

    @abstractmethod
    def initiate_refund(
        self,
        refund_request,
        reason: str = "",
    ) -> RefundResult:
        """
        Invokes the provider's refund API for an approved refund request.
        """
        pass
