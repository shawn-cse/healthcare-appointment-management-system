from decimal import Decimal
import secrets
from typing import Any, Dict, Optional
from django.conf import settings
from django.http import HttpRequest
from django.urls import reverse

from payments.gateways.base import (
    BasePaymentGateway,
    GatewayPaymentError,
    PaymentInitiationResult,
    PaymentVerificationResult,
    RefundResult,
)


class MockPaymentGateway(BasePaymentGateway):
    """
    Safe local mock/sandbox payment gateway for Green Hospital development and automated tests.
    Does not contact external services or live payment networks.
    Provides complete controllable test simulation of success, failure, cancellations,
    amount tampering, and refunds.
    """

    def __init__(self, simulate_failure: bool = False, simulate_tampering: bool = False):
        self.simulate_failure = simulate_failure
        self.simulate_tampering = simulate_tampering

    def initiate_payment(
        self,
        transaction,
        request: HttpRequest,
        success_url: str,
        fail_url: str,
        cancel_url: str,
        ipn_url: str,
    ) -> PaymentInitiationResult:
        if self.simulate_failure:
            return PaymentInitiationResult(
                success=False,
                error_message="Simulated mock gateway session initialization error.",
            )

        # Build mock interactive checkout URL
        mock_checkout_path = reverse("payments:mock-gateway", kwargs={"tran_id": transaction.transaction_reference})
        mock_checkout_url = request.build_absolute_uri(mock_checkout_path)

        session_id = f"MOCK-SESS-{secrets.token_hex(6).upper()}"
        return PaymentInitiationResult(
            success=True,
            gateway_url=mock_checkout_url,
            session_id=session_id,
            raw_response={
                "status": "SUCCESS",
                "sessionkey": session_id,
                "GatewayPageURL": mock_checkout_url,
                "mock_gateway": True,
            },
        )

    def verify_payment(
        self,
        tran_id: str,
        val_id: str = "",
        raw_data: Optional[Dict[str, Any]] = None,
    ) -> PaymentVerificationResult:
        if self.simulate_failure or (raw_data and raw_data.get("mock_action") == "fail"):
            return PaymentVerificationResult(
                is_valid=False,
                tran_id=tran_id,
                val_id=val_id,
                error_message="Mock transaction simulated failure.",
                raw_response={"status": "FAILED", "mock_action": "fail"},
            )

        if not val_id:
            val_id = f"MOCK-VAL-{secrets.token_hex(4).upper()}"

        amount = Decimal("0.00")
        if raw_data and "amount" in raw_data:
            try:
                amount = Decimal(str(raw_data["amount"]))
            except Exception:
                pass

        if self.simulate_tampering:
            # Force amount alteration to test tamper detection
            amount = amount - Decimal("100.00")

        return PaymentVerificationResult(
            is_valid=True,
            tran_id=tran_id,
            val_id=val_id,
            amount=amount,
            currency="BDT",
            bank_tran_id=f"MOCK-BANK-{secrets.token_hex(5).upper()}",
            card_type="MOCK-VISA-DBBL",
            raw_response={
                "status": "VALID",
                "tran_id": tran_id,
                "val_id": val_id,
                "amount": str(amount),
                "currency": "BDT",
                "card_type": "MOCK-VISA-DBBL",
                "mock_gateway": True,
            },
        )

    def initiate_refund(
        self,
        refund_request,
        reason: str = "",
    ) -> RefundResult:
        if self.simulate_failure:
            return RefundResult(
                is_successful=False,
                error_message="Simulated mock gateway refund failure.",
            )

        mock_ref = f"MOCK-REF-{secrets.token_hex(6).upper()}"
        return RefundResult(
            is_successful=True,
            refund_ref_id=mock_ref,
            refunded_amount=refund_request.requested_amount,
            raw_response={
                "status": "success",
                "refund_ref_id": mock_ref,
                "mock_gateway": True,
            },
        )
