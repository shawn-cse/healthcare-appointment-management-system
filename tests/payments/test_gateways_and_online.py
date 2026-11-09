from datetime import date, time, timedelta
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase, Client, RequestFactory
from django.urls import reverse
from django.core.exceptions import ValidationError
from django.utils import timezone

from accounts.models import User, Profile, AuditLog
from bookings.models import Booking
from bookings.services.booking_service import create_appointment
from payments.gateways.base import GatewayConfigurationError
from payments.gateways.factory import get_payment_gateway
from payments.gateways.mock import MockPaymentGateway
from payments.gateways.sslcommerz import SSLCommerzGateway
from payments.models import PaymentTransaction, Receipt
from payments.services.payment_service import (
    initiate_online_payment,
    process_gateway_callback,
)


class GatewaysAndOnlinePaymentTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.factory = RequestFactory()

        # Doctor
        self.doctor = User.objects.create_user(
            username="dr_online_test",
            first_name="Rahim",
            last_name="Uddin",
            email="dr.rahim@greenhospital.org",
            password="DoctorPass123!",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
            bmdc_number="BMDC-778899",
            bmdc_verified=True,
        )
        self.doctor.profile.fee_first_visit = Decimal("1000.00")
        self.doctor.profile.save()

        self.target_date = timezone.now().date() + timedelta(days=1)
        self.target_time = time(10, 0)

        # Doctor Schedule (for booking service availability)
        from doctors.models import DoctorWeeklySchedule
        DoctorWeeklySchedule.objects.create(
            doctor=self.doctor,
            weekday=self.target_date.weekday(),
            session_name="General Session",
            start_time=time(9, 0),
            end_time=time(17, 0),
            slot_duration=30,
            max_capacity=20,
            is_active=True,
        )

        # Patient
        self.patient = User.objects.create_user(
            username="patient_online_test",
            first_name="Karim",
            last_name="Mia",
            email="karim@gmail.com",
            password="PatientPass123!",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient.profile.phone = "01711223344"
        self.patient.profile.save()

        # Create booking with online payment method
        self.booking = create_appointment(
            doctor=self.doctor,
            patient=self.patient,
            appointment_date=self.target_date,
            appointment_time=self.target_time,
            visit_type="regular",
            payment_method=Booking.PaymentMethod.ONLINE,
            actor=self.patient,
        )

    def test_unconfigured_gateway_does_not_invent_success(self):
        """Gateway raises GatewayConfigurationError if merchant credentials are empty and mock is disabled."""
        with self.settings(
            PAYMENT_GATEWAY_PROVIDER="sslcommerz",
            SSLCOMMERZ_STORE_ID="",
            SSLCOMMERZ_STORE_PASS="",
            DEBUG=False,
            ALLOW_MOCK_PAYMENTS=False,
        ):
            with self.assertRaises(GatewayConfigurationError):
                gateway = get_payment_gateway("sslcommerz")
                request = self.factory.get("/")
                request.user = self.patient
                initiate_online_payment(self.booking, request=request)

    def test_mock_gateway_initiation_success(self):
        """Mock gateway creates pending transaction and returns interactive simulation URL."""
        request = self.factory.get("/")
        request.user = self.patient
        result = initiate_online_payment(self.booking, request=request, provider="mock")

        self.assertTrue(result.success)
        self.assertIn("mock-gateway", result.gateway_url)

        # Check transaction created in DB
        tx = PaymentTransaction.objects.filter(booking=self.booking).first()
        self.assertIsNotNone(tx)
        self.assertEqual(tx.status, PaymentTransaction.Status.PENDING)
        self.assertEqual(tx.amount, self.booking.fee_amount)
        self.assertEqual(tx.currency, "BDT")
        self.assertEqual(tx.billed_fee, Decimal("1000.00"))

    def test_server_validated_fee_snapshot_protection(self):
        """Payment amount is strictly pulled from server snapshot fee, never trusted from client."""
        request = self.factory.get("/")
        request.user = self.patient
        initiate_online_payment(self.booking, request=request, provider="mock")

        tx = PaymentTransaction.objects.get(booking=self.booking)
        self.assertEqual(tx.amount, self.booking.fee_amount)
        self.assertEqual(tx.billed_fee, self.booking.fee_amount)

    def test_amount_tampering_detection(self):
        """Callback attempting to alter amount is rejected, transaction marked FAILED, and audit alert logged."""
        request = self.factory.get("/")
        request.user = self.patient
        initiate_online_payment(self.booking, request=request, provider="mock")
        tx = PaymentTransaction.objects.get(booking=self.booking)

        # Tampered payload with less amount (underpayment)
        tampered_data = {
            "amount": "500.00",
            "currency": "BDT",
            "mock_action": "tamper",
        }

        with patch.object(
            MockPaymentGateway,
            "verify_payment",
            return_value=MockPaymentGateway(simulate_tampering=True).verify_payment(
                tran_id=tx.transaction_reference,
                val_id="VAL-123",
                raw_data=tampered_data,
            ),
        ):
            is_valid, updated_tx, receipt, msg = process_gateway_callback(
                tran_id=tx.transaction_reference,
                val_id="VAL-123",
                raw_post_data=tampered_data,
                request=request,
                provider="mock",
            )

            self.assertFalse(is_valid)
            self.assertIsNone(receipt)
            self.assertIn("tampering detected", msg.lower())

            # Transaction must be marked FAILED
            updated_tx.refresh_from_db()
            self.assertEqual(updated_tx.status, PaymentTransaction.Status.FAILED)
            # Booking must remain UNPAID
            self.booking.refresh_from_db()
            self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.UNPAID)

            # Security audit log must be recorded
            audit_log = AuditLog.objects.filter(
                action=AuditLog.ActionChoices.PAYMENT_FAILED,
                target_user=self.patient,
            ).first()
            self.assertIsNotNone(audit_log)
            self.assertIn("tampering", audit_log.details.get("security_alert", "").lower())

    def test_successful_online_verification_and_receipt_accuracy(self):
        """Successful payment verification transitions booking to CONFIRMED & PAID, generates receipt with BDT."""
        request = self.factory.get("/")
        request.user = self.patient
        initiate_online_payment(self.booking, request=request, provider="mock")
        tx = PaymentTransaction.objects.get(booking=self.booking)

        valid_data = {
            "amount": "1000.00",
            "currency": "BDT",
        }

        is_valid, updated_tx, receipt, msg = process_gateway_callback(
            tran_id=tx.transaction_reference,
            val_id="VAL-SUCCESS-1",
            raw_post_data=valid_data,
            request=request,
            provider="mock",
        )

        self.assertTrue(is_valid)
        self.assertIsNotNone(receipt)
        self.assertTrue(receipt.receipt_number.startswith("REC-"))
        self.assertEqual(receipt.collected_amount, Decimal("1000.00"))
        self.assertEqual(receipt.billed_fee, Decimal("1000.00"))
        self.assertEqual(receipt.currency, "BDT")
        self.assertEqual(receipt.patient, self.patient)
        self.assertEqual(receipt.doctor, self.doctor)

        # Booking status transitioned to CONFIRMED and payment_status PAID
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.PAID)
        self.assertEqual(self.booking.status, Booking.StatusChoices.CONFIRMED)

    def test_duplicate_callback_idempotency(self):
        """Duplicate callbacks or IPNs do not double-process, double-credit, or create duplicate receipts."""
        request = self.factory.get("/")
        request.user = self.patient
        initiate_online_payment(self.booking, request=request, provider="mock")
        tx = PaymentTransaction.objects.get(booking=self.booking)

        valid_data = {"amount": "1000.00", "currency": "BDT"}

        # First callback
        is_valid1, tx1, receipt1, msg1 = process_gateway_callback(
            tran_id=tx.transaction_reference,
            val_id="VAL-DUP-1",
            raw_post_data=valid_data,
            request=request,
            provider="mock",
        )
        self.assertTrue(is_valid1)
        receipt_count_1 = Receipt.objects.filter(booking=self.booking).count()
        self.assertEqual(receipt_count_1, 1)

        # Second duplicate callback with same tran_id
        is_valid2, tx2, receipt2, msg2 = process_gateway_callback(
            tran_id=tx.transaction_reference,
            val_id="VAL-DUP-1",
            raw_post_data=valid_data,
            request=request,
            provider="mock",
        )
        self.assertTrue(is_valid2)
        self.assertEqual(receipt2.id, receipt1.id)
        # Verify receipt count didn't increment
        receipt_count_2 = Receipt.objects.filter(booking=self.booking).count()
        self.assertEqual(receipt_count_2, 1)

    def test_failed_payment_callback(self):
        """Failed callback marks transaction as FAILED and leaves booking UNPAID."""
        request = self.factory.get("/")
        request.user = self.patient
        initiate_online_payment(self.booking, request=request, provider="mock")
        tx = PaymentTransaction.objects.get(booking=self.booking)

        fail_data = {"mock_action": "fail"}
        is_valid, updated_tx, receipt, msg = process_gateway_callback(
            tran_id=tx.transaction_reference,
            val_id="VAL-FAIL-1",
            raw_post_data=fail_data,
            request=request,
            provider="mock",
        )

        self.assertFalse(is_valid)
        self.assertIsNone(receipt)
        updated_tx.refresh_from_db()
        self.assertEqual(updated_tx.status, PaymentTransaction.Status.FAILED)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.payment_status, Booking.PaymentStatus.UNPAID)
