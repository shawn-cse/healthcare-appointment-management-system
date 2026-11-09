from datetime import datetime, date, time, timedelta
from decimal import Decimal
from unittest.mock import patch
from django.test import TestCase, Client
from django.urls import reverse
from django.core.exceptions import PermissionDenied, ValidationError
from django.utils import timezone

from accounts.models import User, Profile, AuditLog
from bookings.models import Booking
from doctors.services.availability import DHAKA_TZ
from payments.gateways.base import RefundResult
from payments.gateways.mock import MockPaymentGateway
from payments.models import PaymentTransaction, RefundRequest, RefundTransaction
from payments.services.refund_service import (
    approve_refund_request,
    create_refund_request,
    process_approved_refund,
    reject_refund_request,
    review_refund_request,
)


class RefundWorkflowTests(TestCase):
    def setUp(self):
        self.client = Client()

        # Users
        self.doctor = User.objects.create_user(
            username="dr_refund_flow",
            role=User.RoleChoices.DOCTOR,
            status=User.StatusChoices.ACTIVE,
        )
        self.patient = User.objects.create_user(
            username="patient_refund_flow",
            role=User.RoleChoices.PATIENT,
            status=User.StatusChoices.ACTIVE,
        )
        self.hospital_admin = User.objects.create_user(
            username="hosp_admin_refund_flow",
            role=User.RoleChoices.HOSPITAL_ADMIN,
            status=User.StatusChoices.ACTIVE,
        )
        self.super_admin = User.objects.create_user(
            username="super_admin_refund_flow",
            role=User.RoleChoices.SUPER_ADMIN,
            status=User.StatusChoices.ACTIVE,
            is_superuser=True,
        )

        self.appointment_date = timezone.now().date() + timedelta(days=5)
        self.appointment_time = time(11, 0)

        # Booking paid online (1000.00 BDT)
        self.booking_online = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient,
            appointment_date=self.appointment_date,
            appointment_time=self.appointment_time,
            fee_amount=Decimal("1000.00"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        self.tx_online = PaymentTransaction.objects.create(
            booking=self.booking_online,
            patient=self.patient,
            doctor=self.doctor,
            billed_fee=Decimal("1000.00"),
            amount=Decimal("1000.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.ONLINE,
            payment_provider="mock",
            status=PaymentTransaction.Status.SUCCESS,
            gateway_transaction_id="BANK-TXN-123",
        )

        # Booking paid at chamber (1200.00 BDT)
        self.booking_chamber = Booking.objects.create(
            doctor=self.doctor,
            patient=self.patient,
            appointment_date=self.appointment_date,
            appointment_time=time(12, 0),
            fee_amount=Decimal("1200.00"),
            payment_status=Booking.PaymentStatus.PAID,
            status=Booking.StatusChoices.CONFIRMED,
        )
        self.tx_chamber = PaymentTransaction.objects.create(
            booking=self.booking_chamber,
            patient=self.patient,
            doctor=self.doctor,
            billed_fee=Decimal("1200.00"),
            amount=Decimal("1200.00"),
            currency="BDT",
            payment_method=PaymentTransaction.PaymentMethod.CASH,
            payment_provider="cash",
            status=PaymentTransaction.Status.SUCCESS,
        )

    def test_refund_request_creation_and_duplicate_prevention(self):
        """Creates refund request and blocks duplicate requests for the same booking."""
        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="Patient has travel conflict",
            cancellation_type="patient",
            current_time=timezone.now(),
        )

        self.assertIsNotNone(refund_req)
        self.assertEqual(refund_req.status, RefundRequest.Status.REQUESTED)
        self.assertEqual(refund_req.eligible_refund_percentage, 100)
        self.assertEqual(refund_req.requested_amount, Decimal("1000.00"))

        # Duplicate request attempt must raise ValidationError
        with self.assertRaises(ValidationError) as cm:
            create_refund_request(
                booking=self.booking_online,
                patient=self.patient,
                reason="Duplicate request",
            )
        self.assertIn("already exists", str(cm.exception))

    def test_hospital_admin_can_review_and_forward(self):
        """Hospital Administrator reviews and forwards request to UNDER_REVIEW."""
        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="Request review",
        )

        reviewed = review_refund_request(
            refund_request=refund_req,
            reviewed_by=self.hospital_admin,
            review_notes="Time delta verified > 24 hours.",
        )

        self.assertEqual(reviewed.status, RefundRequest.Status.UNDER_REVIEW)
        self.assertEqual(reviewed.reviewed_by, self.hospital_admin)
        self.assertIn("Time delta verified", reviewed.review_notes)

    def test_unauthorized_approval_rejected(self):
        """Hospital Administrator or regular doctor/patient CANNOT approve refunds (raises PermissionDenied)."""
        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="Approval test",
        )

        # Hospital Admin attempt
        with self.assertRaises(PermissionDenied):
            approve_refund_request(refund_req, approved_by=self.hospital_admin)

        # Doctor attempt
        with self.assertRaises(PermissionDenied):
            approve_refund_request(refund_req, approved_by=self.doctor)

        # Patient attempt
        with self.assertRaises(PermissionDenied):
            approve_refund_request(refund_req, approved_by=self.patient)

    def test_super_admin_approves_and_rejects_refund(self):
        """Super Admin strictly has authority to approve or reject refund requests."""
        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="Super admin approval test",
        )

        approved = approve_refund_request(
            refund_request=refund_req,
            approved_by=self.super_admin,
            approval_notes="Approved under Green Hospital Policy",
        )
        self.assertEqual(approved.status, RefundRequest.Status.APPROVED)
        self.assertEqual(approved.approved_by, self.super_admin)

        # Test Rejection on another request
        refund_req2 = create_refund_request(
            booking=self.booking_chamber,
            patient=self.patient,
            reason="Rejection test",
        )
        rejected = reject_refund_request(
            refund_request=refund_req2,
            rejected_by=self.super_admin,
            rejection_reason="No valid justification provided.",
        )
        self.assertEqual(rejected.status, RefundRequest.Status.REJECTED)
        self.assertEqual(rejected.rejection_reason, "No valid justification provided.")

    def test_process_approved_online_refund(self):
        """Processes approved online refund through gateway API, generates RefundTransaction and marks booking REFUNDED."""
        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="Full online refund",
        )
        approve_refund_request(refund_req, approved_by=self.super_admin)

        success, updated_refund, msg = process_approved_refund(
            refund_request=refund_req,
            processed_by=self.super_admin,
            provider="mock",
        )

        self.assertTrue(success)
        self.assertEqual(updated_refund.status, RefundRequest.Status.SUCCEEDED)
        self.assertEqual(updated_refund.refunded_amount, Decimal("1000.00"))

        # RefundTransaction created
        refund_tx = RefundTransaction.objects.filter(refund_request=updated_refund).first()
        self.assertIsNotNone(refund_tx)
        self.assertEqual(refund_tx.amount, Decimal("1000.00"))
        self.assertEqual(refund_tx.status, "succeeded")

        # Booking payment status updated to REFUNDED
        self.booking_online.refresh_from_db()
        self.assertEqual(self.booking_online.payment_status, Booking.PaymentStatus.REFUNDED)
        self.tx_online.refresh_from_db()
        self.assertEqual(self.tx_online.status, PaymentTransaction.Status.REFUNDED)
        self.assertEqual(self.tx_online.net_paid_remaining, Decimal("0.00"))

    def test_process_approved_chamber_manual_repayment(self):
        """Processes approved chamber refund via authorized manual repayment workflow with mandatory voucher reference."""
        refund_req = create_refund_request(
            booking=self.booking_chamber,
            patient=self.patient,
            reason="Chamber cash refund",
        )
        approve_refund_request(refund_req, approved_by=self.super_admin)

        # Attempting without manual voucher reference must fail
        with self.assertRaises(ValidationError) as cm:
            process_approved_refund(
                refund_request=refund_req,
                processed_by=self.hospital_admin,
                manual_reference="",  # Missing voucher
            )
        self.assertIn("manual repayment voucher", str(cm.exception))
        refund_req.refresh_from_db()

        # Successful manual repayment
        success, updated_refund, msg = process_approved_refund(
            refund_request=refund_req,
            processed_by=self.hospital_admin,
            manual_reference="VOUCHER-GH-202611-001",
            repayment_method="chamber_cash_repayment",
            notes="Cash handed over at reception counter",
        )

        self.assertTrue(success)
        self.assertEqual(updated_refund.status, RefundRequest.Status.SUCCEEDED)
        self.assertEqual(updated_refund.manual_repayment_reference, "VOUCHER-GH-202611-001")
        self.booking_chamber.refresh_from_db()
        self.assertEqual(self.booking_chamber.payment_status, Booking.PaymentStatus.REFUNDED)

    def test_partial_eighty_percent_refund_updates_status_partially_refunded(self):
        """An 80% partial refund updates booking payment status to PARTIALLY_REFUNDED and correctly tracks net remaining."""
        # 10 hours before appointment -> 80% refund (800.00 BDT)
        cancel_time = datetime.combine(self.appointment_date, self.appointment_time).replace(tzinfo=DHAKA_TZ) - timedelta(hours=10)

        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="80% partial cancellation",
            current_time=cancel_time,
        )
        self.assertEqual(refund_req.eligible_refund_percentage, 80)
        self.assertEqual(refund_req.requested_amount, Decimal("800.00"))

        approve_refund_request(refund_req, approved_by=self.super_admin)
        success, updated_refund, msg = process_approved_refund(
            refund_request=refund_req,
            processed_by=self.super_admin,
            provider="mock",
        )

        self.assertTrue(success)
        self.booking_online.refresh_from_db()
        self.assertEqual(self.booking_online.payment_status, Booking.PaymentStatus.PARTIALLY_REFUNDED)
        self.tx_online.refresh_from_db()
        self.assertEqual(self.tx_online.status, PaymentTransaction.Status.PARTIALLY_REFUNDED)
        self.assertEqual(self.tx_online.net_paid_remaining, Decimal("200.00"))

    def test_never_refund_more_than_net_paid_amount_remaining(self):
        """Financial integrity: total refunds cannot exceed original collected amount."""
        # First 80% refund processed (800.00 BDT refunded, 200.00 remaining)
        self.test_partial_eighty_percent_refund_updates_status_partially_refunded()

        # Reject the first completed refund request so we can test a second request attempt
        # Or test requested_amount boundary
        self.tx_online.refresh_from_db()
        self.assertEqual(self.tx_online.net_paid_remaining, Decimal("200.00"))

        # Even if someone asks for 500 BDT on the second request, it can never exceed 200.00
        refund_req2 = RefundRequest.objects.create(
            booking=self.booking_online,
            payment_transaction=self.tx_online,
            patient=self.patient,
            doctor=self.doctor,
            original_paid_amount=self.tx_online.amount,
            eligible_refund_percentage=100,
            eligible_refund_amount=Decimal("500.00"),
            requested_amount=Decimal("500.00"),  # Exceeds 200.00 remaining
            status=RefundRequest.Status.REQUESTED,
        )

        with self.assertRaises(ValidationError) as cm:
            approve_refund_request(refund_req2, approved_by=self.super_admin)
        self.assertIn("exceeds net paid remaining", str(cm.exception))

    def test_gateway_failure_and_safe_retry(self):
        """Gateway failure transitions refund status to FAILED and allows safe administrative retry."""
        refund_req = create_refund_request(
            booking=self.booking_online,
            patient=self.patient,
            reason="Failure retry test",
        )
        approve_refund_request(refund_req, approved_by=self.super_admin)

        # First attempt: gateway fails
        with patch.object(
            MockPaymentGateway,
            "initiate_refund",
            return_value=RefundResult(is_successful=False, error_message="SSLCOMMERZ refund endpoint timeout"),
        ):
            success, failed_refund, msg = process_approved_refund(
                refund_request=refund_req,
                processed_by=self.super_admin,
                provider="mock",
            )
            self.assertFalse(success)
            self.assertEqual(failed_refund.status, RefundRequest.Status.FAILED)
            self.assertIn("SSLCOMMERZ refund endpoint timeout", failed_refund.processing_notes)
            # Booking must not be marked refunded
            self.booking_online.refresh_from_db()
            self.assertEqual(self.booking_online.payment_status, Booking.PaymentStatus.PAID)

        # Retry attempt: gateway succeeds
        success2, succeeded_refund, msg2 = process_approved_refund(
            refund_request=refund_req,
            processed_by=self.super_admin,
            provider="mock",
        )
        self.assertTrue(success2)
        self.assertEqual(succeeded_refund.status, RefundRequest.Status.SUCCEEDED)
        self.booking_online.refresh_from_db()
        self.assertEqual(self.booking_online.payment_status, Booking.PaymentStatus.REFUNDED)
