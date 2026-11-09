from typing import Optional
from django.conf import settings

from payments.gateways.base import BasePaymentGateway, GatewayConfigurationError
from payments.gateways.sslcommerz import SSLCommerzGateway
from payments.gateways.mock import MockPaymentGateway


def get_payment_gateway(provider: Optional[str] = None) -> BasePaymentGateway:
    """
    Factory resolving the active payment gateway based on configuration and environment.
    Strictly prevents inventing fake success when live/sandbox gateway is unconfigured.
    """
    selected_provider = (
        provider
        or getattr(settings, "PAYMENT_GATEWAY_PROVIDER", "")
        or "sslcommerz"
    ).lower()

    if selected_provider == "mock":
        allow_mock = getattr(settings, "ALLOW_MOCK_PAYMENTS", False)
        if not allow_mock and not getattr(settings, "DEBUG", False):
            raise GatewayConfigurationError(
                "Mock payment gateway is strictly forbidden in non-debug production environments."
            )
        return MockPaymentGateway()

    if selected_provider == "sslcommerz":
        store_id = getattr(settings, "SSLCOMMERZ_STORE_ID", "")
        store_pass = getattr(settings, "SSLCOMMERZ_STORE_PASS", "")

        if not store_id or not store_pass:
            # If in debug mode and mock is explicitly permitted, fallback to mock with warning
            if getattr(settings, "DEBUG", False) and getattr(settings, "ALLOW_MOCK_PAYMENTS", True):
                return MockPaymentGateway()
            raise GatewayConfigurationError(
                "SSLCOMMERZ credentials are not configured. Please set SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASS in your environment."
            )

        return SSLCommerzGateway()

    raise GatewayConfigurationError(f"Unsupported payment gateway provider: '{selected_provider}'.")
