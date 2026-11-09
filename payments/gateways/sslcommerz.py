from decimal import Decimal
from typing import Any, Dict, Optional
import urllib.parse
from django.conf import settings
from django.http import HttpRequest

from payments.gateways.base import (
    BasePaymentGateway,
    GatewayConfigurationError,
    GatewayPaymentError,
    PaymentInitiationResult,
    PaymentVerificationResult,
    RefundResult,
)
from payments.gateways.http_client import send_http_request, HttpClientError


class SSLCommerzGateway(BasePaymentGateway):
    """
    Production-ready SSLCOMMERZ V4 payment gateway integration for Green Hospital.
    Supports BDT currency, separate sandbox/live environments, server-side validation,
    and gateway refund integration.
    """

    SANDBOX_SESSION_URL = "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
    LIVE_SESSION_URL = "https://securepay.sslcommerz.com/gwprocess/v4/api.php"

    SANDBOX_VALIDATION_URL = "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
    LIVE_VALIDATION_URL = "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php"

    SANDBOX_REFUND_URL = "https://sandbox.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php"
    LIVE_REFUND_URL = "https://securepay.sslcommerz.com/validator/api/merchantTransIDvalidationAPI.php"

    def __init__(
        self,
        store_id: Optional[str] = None,
        store_pass: Optional[str] = None,
        is_sandbox: Optional[bool] = None,
    ):
        self.store_id = store_id or getattr(settings, "SSLCOMMERZ_STORE_ID", "")
        self.store_pass = store_pass or getattr(settings, "SSLCOMMERZ_STORE_PASS", "")
        if is_sandbox is not None:
            self.is_sandbox = is_sandbox
        else:
            self.is_sandbox = getattr(settings, "SSLCOMMERZ_IS_SANDBOX", True)

    def _validate_credentials(self):
        """Strict check: Never invent a successful transaction when gateway is unconfigured."""
        if not self.store_id or not self.store_pass:
            raise GatewayConfigurationError(
                "SSLCOMMERZ credentials are not configured. Please configure SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASS."
            )

    @property
    def session_url(self) -> str:
        return self.SANDBOX_SESSION_URL if self.is_sandbox else self.LIVE_SESSION_URL

    @property
    def validation_url(self) -> str:
        return self.SANDBOX_VALIDATION_URL if self.is_sandbox else self.LIVE_VALIDATION_URL

    @property
    def refund_url(self) -> str:
        return self.SANDBOX_REFUND_URL if self.is_sandbox else self.LIVE_REFUND_URL

    def initiate_payment(
        self,
        transaction,
        request: HttpRequest,
        success_url: str,
        fail_url: str,
        cancel_url: str,
        ipn_url: str,
    ) -> PaymentInitiationResult:
        self._validate_credentials()

        patient = transaction.patient
        patient_profile = getattr(patient, "profile", None)
        phone = getattr(patient_profile, "phone", None) or "01700000000"
        address = getattr(patient_profile, "address", None) or "Dhaka"
        city = getattr(patient_profile, "city", None) or "Dhaka"
        country = getattr(patient_profile, "country", None) or "Bangladesh"

        payload = {
            "store_id": self.store_id,
            "store_passwd": self.store_pass,
            "total_amount": f"{transaction.amount:.2f}",
            "currency": "BDT",
            "tran_id": transaction.transaction_reference,
            "success_url": success_url,
            "fail_url": fail_url,
            "cancel_url": cancel_url,
            "ipn_url": ipn_url,
            "cus_name": patient.get_full_name() or patient.username,
            "cus_email": patient.email or f"{patient.username}@greenhospital.org",
            "cus_phone": phone,
            "cus_add1": address,
            "cus_city": city,
            "cus_country": country,
            "shipping_method": "NO",
            "product_name": f"Consultation Dr. {transaction.doctor.get_full_name()}",
            "product_category": "Healthcare",
            "product_profile": "general",
        }

        try:
            resp = send_http_request(
                url=self.session_url,
                method="POST",
                data=payload,
                timeout=20,
            )
        except HttpClientError as e:
            return PaymentInitiationResult(
                success=False,
                error_message=f"Network error contacting SSLCOMMERZ gateway: {str(e)}",
            )

        status = str(resp.get("status", "")).upper()
        if status == "SUCCESS" and resp.get("GatewayPageURL"):
            return PaymentInitiationResult(
                success=True,
                gateway_url=resp["GatewayPageURL"],
                session_id=resp.get("sessionkey", ""),
                raw_response=self._sanitize_payload(resp),
            )
        else:
            failed_reason = resp.get("failedreason") or resp.get("error") or "Unknown gateway session error."
            return PaymentInitiationResult(
                success=False,
                error_message=str(failed_reason),
                raw_response=self._sanitize_payload(resp),
            )

    def verify_payment(
        self,
        tran_id: str,
        val_id: str = "",
        raw_data: Optional[Dict[str, Any]] = None,
    ) -> PaymentVerificationResult:
        """
        Server-side validation against SSLCOMMERZ validation API.
        Never trust unverified frontend redirects alone!
        """
        self._validate_credentials()

        if not val_id:
            return PaymentVerificationResult(
                is_valid=False,
                tran_id=tran_id,
                error_message="Validation ID (val_id) is missing; cannot verify transaction with gateway.",
            )

        query_params = urllib.parse.urlencode({
            "val_id": val_id,
            "store_id": self.store_id,
            "store_passwd": self.store_pass,
            "v": "1",
            "format": "json",
        })
        verify_url = f"{self.validation_url}?{query_params}"

        try:
            resp = send_http_request(url=verify_url, method="GET", timeout=20)
        except HttpClientError as e:
            return PaymentVerificationResult(
                is_valid=False,
                tran_id=tran_id,
                val_id=val_id,
                error_message=f"Server validation network failure: {str(e)}",
            )

        status = str(resp.get("status", "")).upper()
        if status not in ("VALID", "VALIDATED"):
            return PaymentVerificationResult(
                is_valid=False,
                tran_id=tran_id,
                val_id=val_id,
                error_message=f"Transaction validation status was '{status}'.",
                raw_response=self._sanitize_payload(resp),
            )

        resp_tran_id = str(resp.get("tran_id", ""))
        if resp_tran_id != tran_id:
            return PaymentVerificationResult(
                is_valid=False,
                tran_id=tran_id,
                val_id=val_id,
                error_message=f"Transaction ID mismatch: expected {tran_id}, got {resp_tran_id}.",
                raw_response=self._sanitize_payload(resp),
            )

        currency = str(resp.get("currency", "")).upper()
        if currency != "BDT":
            return PaymentVerificationResult(
                is_valid=False,
                tran_id=tran_id,
                val_id=val_id,
                error_message=f"Currency mismatch: expected BDT, got {currency}.",
                raw_response=self._sanitize_payload(resp),
            )

        try:
            amount = Decimal(str(resp.get("amount", "0.00")))
        except Exception:
            amount = Decimal("0.00")

        return PaymentVerificationResult(
            is_valid=True,
            tran_id=resp_tran_id,
            val_id=str(resp.get("val_id", val_id)),
            amount=amount,
            currency=currency,
            bank_tran_id=str(resp.get("bank_tran_id", "")),
            card_type=str(resp.get("card_type", "")),
            raw_response=self._sanitize_payload(resp),
        )

    def initiate_refund(
        self,
        refund_request,
        reason: str = "",
    ) -> RefundResult:
        self._validate_credentials()

        payment_tx = refund_request.payment_transaction
        bank_tran_id = payment_tx.gateway_response.get("bank_tran_id") or payment_tx.gateway_transaction_id

        if not bank_tran_id:
            return RefundResult(
                is_successful=False,
                error_message="Original gateway bank transaction ID is missing; cannot invoke SSLCOMMERZ refund API.",
            )

        params = {
            "bank_tran_id": bank_tran_id,
            "refund_amount": f"{refund_request.requested_amount:.2f}",
            "refund_remarks": reason or refund_request.reason or "Hospital appointment cancellation refund",
            "store_id": self.store_id,
            "store_passwd": self.store_pass,
            "v": "1",
            "format": "json",
        }
        query_string = urllib.parse.urlencode(params)
        endpoint = f"{self.refund_url}?{query_string}"

        try:
            resp = send_http_request(url=endpoint, method="GET", timeout=20)
        except HttpClientError as e:
            return RefundResult(
                is_successful=False,
                error_message=f"Gateway refund network error: {str(e)}",
            )

        status = str(resp.get("status", "")).lower()
        if status in ("success", "successful"):
            ref_id = str(resp.get("refund_ref_id") or resp.get("trans_id") or "")
            return RefundResult(
                is_successful=True,
                refund_ref_id=ref_id,
                refunded_amount=refund_request.requested_amount,
                raw_response=self._sanitize_payload(resp),
            )
        else:
            err = resp.get("errorReason") or resp.get("message") or "Gateway refund request rejected."
            return RefundResult(
                is_successful=False,
                error_message=str(err),
                raw_response=self._sanitize_payload(resp),
            )

    def _sanitize_payload(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Ensures raw bank card numbers or security codes are never stored."""
        sanitized = dict(data)
        for sensitive_key in ("card_no", "card_number", "pan", "cvv", "cvv2", "password", "store_passwd"):
            if sensitive_key in sanitized:
                sanitized[sensitive_key] = "[MASKED]"
        return sanitized
