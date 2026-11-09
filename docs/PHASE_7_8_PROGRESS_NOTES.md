# Green Hospital - Phase 7 & Phase 8 Implementation & Progress Notes

## Overview
This document outlines the complete technical implementation of **Phase 7 (Appointment Payment Workflows)** and **Phase 8 (Strict Financial Cancellation & Refund Engine)** for Green Hospital.

---

## 1. Architectural Design & Payment Provider Abstraction

### 1.1 Gateway Abstraction (`payments/gateways/`)
A modular, provider-agnostic interface decouples appointment booking logic from specific payment gateways:
- `BasePaymentGateway` (`payments/gateways/base.py`): Abstract Base Class defining standard contracts for `initiate_payment()`, `verify_payment()`, and `refund_payment()`.
- Standard Data Classes:
  - `PaymentInitiationResult`: Contains session redirect URL, gateway session ID, provider reference, and status.
  - `PaymentVerificationResult`: Contains verification status, verified amount, transaction ID, bank reference, card/channel details, and payload.
  - `RefundResult`: Contains refund success status, refund reference ID, amount, and provider status message.
- Exceptions:
  - `GatewayConfigurationError`: Raised when live or sandbox credentials are unconfigured or invalid, ensuring the system never invents fake successful transactions.

### 1.2 Implemented Gateways
1. **SSLCOMMERZ Gateway (`payments/gateways/sslcommerz.py`)**:
   - Implements SSLCOMMERZ V4 session initialization (`gwprocess/v4/api.php`) and server-to-server transaction validation (`validator/api/validationserverAPI.php`).
   - Supports separate sandbox (`https://sandbox.sslcommerz.com`) and production (`https://securepay.sslcommerz.com`) endpoints configured via environment variables.
   - Enforces strict server-side amount and currency (`BDT`) validation; never marks transactions successful based merely on frontend redirects.
   - Integrates SSLCOMMERZ refund API (`validator/api/merchantTransIDvalidationAPI.php`).
   - Sanitizes payment instrument details—**raw card numbers and CVV codes are never accepted or stored**.
2. **Mock Payment Gateway (`payments/gateways/mock.py`)**:
   - A safe local development and testing simulator enabled only when `PAYMENT_GATEWAY_PROVIDER = "mock"` or `DEBUG = True`.
   - Simulates gateway flows (success, customer cancellation, gateway failure, amount tampering, refund execution) without contacting external networks.

### 1.3 Zero Extra External Dependencies
- Network communication utilizes Python's standard `urllib.request` encapsulated in `payments/gateways/http_client.py` with custom timeouts, error handling, and JSON/form encoding.

---

## 2. Core Payment Workflows (Phase 7)

### 2.1 Currency & Precision Standards
- All monetary operations use Bangladeshi Taka (**BDT**).
- Calculations and database fields use decimal-safe calculations via Python's `Decimal` and Django's `DecimalField(max_digits=10, decimal_places=2)` to prevent floating-point inaccuracies.

### 2.2 Payment Methods
1. **Online Payment**:
   - Initiated from appointment confirmation screen.
   - Generates a `PaymentTransaction` with a unique transaction reference (`GH-TXN-YYYYMMDD-XXXX`).
   - 15-minute checkout session TTL (`expires_at = timezone.now() + timedelta(minutes=15)`).
   - If a patient abandons checkout, `expire_abandoned_online_sessions()` automatically expires the transaction, cancels the pending appointment, and frees the doctor's appointment capacity.
   - Server-side callback and IPN handlers verify the transaction with the payment gateway before updating status to `SUCCESS`.
2. **Pay at Chamber (Cash & Chamber POS)**:
   - Patient books appointment without immediate online payment; appointment is confirmed with `payment_status = UNPAID`.
   - Receptionists and Hospital Administrators collect payment at the chamber.
   - **Role & Assignment Enforcement**: Receptionists can only collect payments for doctors assigned to them via `ReceptionistDoctorAssignment`. Hospital Administrators can collect for any doctor. Patients are strictly blocked from recording payments.
   - Prevents duplicate collection and underpayment: recorded amount must match the appointment's immutable locked snapshot fee.

### 2.3 Receipts & Auditing
- Successful payments immediately issue an immutable, verifiable `Receipt` (`REC-YYYYMMDD-XXXX`).
- Receipts snapshot:
  - Appointment reference, patient, doctor, specialization.
  - Billed snapshot fee, collected amount, payment method, transaction reference.
  - Timestamp and staff identity (`issued_by`).
- Every payment lifecycle transition creates an append-only `AuditLog` entry.
- Printable receipt view (`/payments/receipts/<receipt_number>/print/`) available for staff and patients.

---

## 3. Strict Cancellation & Refund Engine (Phase 8)

### 3.1 Patient Cancellation Policy (`payments/services/cancellation_policy.py`)
Calculated against authoritative server time in **`Asia/Dhaka`**:
- **$\ge 24$ hours before appointment start**: **100% refund** of paid amount (0% cancellation fee).
- **Exactly 24 hours before appointment start**: **100% refund**.
- **$< 24$ hours before start, but before appointment starts**: **80% refund** (20% cancellation fee deducted, calculated via `ROUND_HALF_UP`).
- **At or after appointment start**: **0% automatic refund** (Admin exception review only).
- **Unpaid Bookings**: Unpaid chamber appointments have 0.00 BDT refundable and generate no monetary refund requests.

### 3.2 Doctor & Hospital Session Cancellation (`payments/services/session_cancellation_service.py`)
- Doctors and Hospital Administrators can cancel:
  1. An individual appointment with a recorded reason.
  2. An entire consultation session or day (`DoctorAvailabilityException`).
- When a session is cancelled:
  - All scheduled appointments for that session are cancelled with recorded reason and actor.
  - Re-booking the cancelled session is strictly blocked.
  - Paid patients automatically receive **100% refund eligibility**.
  - No financial or booking records are ever deleted.

### 3.3 Refund Lifecycle & Approval Workflow (`payments/services/refund_service.py`)
Refund requests follow a strict 8-stage state machine:
`REQUESTED` $\rightarrow$ `UNDER_REVIEW` $\rightarrow$ `APPROVED` / `REJECTED` $\rightarrow$ `PROCESSING` $\rightarrow$ `SUCCEEDED` / `FAILED`

1. **Submission**: Patient submits or confirms a refund request upon cancellation.
2. **Review**: Hospital Administrator reviews and forwards (`UNDER_REVIEW`).
3. **Mandatory Super Admin Approval**:
   - **Only Super Admin users can approve or reject refund requests.**
   - Hospital Administrators and Receptionists attempting approval receive `PermissionDenied`.
4. **Execution**:
   - **Online Payments**: Executed via the payment gateway's refund API.
   - **Chamber Payments**: Executed via a documented manual cash/voucher repayment workflow requiring a verified voucher reference.
   - Creates an immutable `RefundTransaction`.
   - Sets booking payment status to `REFUNDED` or `PARTIALLY_REFUNDED`.
   - Prevents duplicate refunds and ensures total refunds never exceed the net paid amount remaining.

---

## 4. Database Models

### `PaymentTransaction` (`payments/models.py`)
- `transaction_reference`: Unique `GH-TXN-YYYYMMDD-XXXX`.
- `booking`: One-to-One with `bookings.Booking`.
- `amount`, `snapshot_fee`: Decimal(10, 2) in BDT.
- `payment_method`: `ONLINE`, `CASH`, `CHAMBER_POS`.
- `status`: `PENDING`, `SUCCESS`, `FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED`.
- `provider`: Gateway provider identifier (`sslcommerz`, `mock`).
- `provider_transaction_id`, `bank_transaction_id`, `card_type`, `card_brand`.
- `expires_at`: Checkout TTL timestamp.
- `collected_by`: User reference for chamber collection staff.

### `Receipt` (`payments/models.py`)
- `receipt_number`: Unique `REC-YYYYMMDD-XXXX`.
- `transaction`: One-to-One with `PaymentTransaction`.
- `booking`, `patient`, `doctor`: Relational foreign keys.
- `snapshot_fee`, `amount_collected`: Decimal(10, 2).
- `issued_at`, `issued_by`.

### `RefundRequest` (`payments/models.py`)
- `refund_reference`: Unique `REF-YYYYMMDD-XXXX`.
- `booking`, `patient`, `doctor`.
- `original_transaction`: Foreign key to `PaymentTransaction`.
- `requested_amount`, `approved_amount`: Decimal(10, 2).
- `cancellation_reason`, `policy_percentage` (100, 80, 0).
- `status`: 8-stage lifecycle status choices.
- `reviewed_by`, `reviewed_at`, `review_notes`.
- `approved_by`, `approved_at`, `rejection_reason`.

### `RefundTransaction` (`payments/models.py`)
- `refund_reference`: Reference matching the `RefundRequest`.
- `amount`: Net refunded payout.
- `gateway_refund_ref`: Gateway refund transaction ID or manual voucher code.
- `processed_by`, `processed_at`.

---

## 5. Security & Financial Controls Matrix

| Risk Scenario | Mitigation / Architectural Control |
|---|---|
| **Raw Card Theft** | Gateway-hosted checkout sessions; Green Hospital servers never accept or store PAN or CVV. |
| **Frontend Confirmation Tampering** | Server-to-server gateway validation (`validationserverAPI.php`) verifies paid amount and currency before granting success. |
| **Amount Tampering** | Callback verifies paid amount matches the locked appointment snapshot fee; mismatches are marked `FAILED`. |
| **Duplicate IPN / Webhook** | Idempotency checks on transaction state; repeated callbacks return idempotent HTTP 200 without duplicate state mutations. |
| **Checkout Abandonment Capacity Hoarding** | 15-minute checkout TTL; `expire_abandoned_online_sessions()` cancels abandoned bookings and frees appointment slots. |
| **Unassigned Chamber Payment Collection** | Receptionist doctor assignment verification (`ReceptionistDoctorAssignment`); unauthorized staff are rejected with `PermissionDenied`. |
| **Duplicate Chamber Collection** | `record_chamber_payment_collection` enforces `status == UNPAID` check within database transactions. |
| **Underpayment / Fee Alteration** | Chamber payments must match `booking.snapshot_doctor_fee` down to the exact cent; underpayment is rejected. |
| **Unauthorized Refund Approval** | Super Admin check strictly enforced at service and view layers; Hospital Admins cannot approve or reject. |
| **Excessive / Over-Refund** | Net paid remaining calculated dynamically; cumulative refunds cannot exceed original paid amount. |
| **Phantom Refund on Unpaid Bookings** | Unpaid bookings return `0.00 BDT` refundable and do not spawn monetary refund records. |

---

## 6. Environment Configuration (`.env.example`)

```ini
# Payment Gateway Settings
PAYMENT_GATEWAY_PROVIDER=sslcommerz # Options: sslcommerz, mock

# SSLCOMMERZ Credentials
SSLCOMMERZ_STORE_ID=your_store_id
SSLCOMMERZ_STORE_PASSWORD=your_store_password
SSLCOMMERZ_IS_SANDBOX=True # Set False for Live Production
SSLCOMMERZ_BASE_URL=https://sandbox.sslcommerz.com # https://securepay.sslcommerz.com in production

# App Base URL (for Gateway Redirects & IPN)
SITE_URL=http://localhost:8000
```

---

## 7. Automated Test Suite Summary

A comprehensive test suite with **35 dedicated payment & refund test cases** validates all workflows:

- **`tests/payments/test_gateways_and_online.py`** (6 tests):
  - Gateway factory configuration validation.
  - Mock gateway full round-trip initiation and completion.
  - Amount tampering detection and rejection.
  - Duplicate callback idempotency.
  - Gateway failure status transitions.
  - SSLCOMMERZ sandbox configuration and parameter integrity.
- **`tests/payments/test_chamber_payments.py`** (7 tests):
  - Confirmed unpaid appointment creation for Pay at Chamber.
  - Assigned receptionist cash collection and staff attribution.
  - Unassigned receptionist authorization denial (`PermissionDenied`).
  - Hospital Administrator cross-doctor collection capability.
  - Patient self-collection prevention (`PermissionDenied`).
  - Duplicate payment collection prevention (`ValidationError`).
  - Underpayment and fee mismatch rejection.
- **`tests/payments/test_cancellation_policy.py`** (8 tests):
  - Patient cancellation $> 24$ hours before appointment $\rightarrow$ 100% refund.
  - Patient cancellation exactly 24 hours before appointment $\rightarrow$ 100% refund.
  - 24 hours plus 1 second $\rightarrow$ 100% refund.
  - 24 hours minus 1 second $\rightarrow$ 80% refund.
  - $< 24$ hours before appointment $\rightarrow$ 80% refund.
  - At appointment start $\rightarrow$ 0% automatic refund.
  - After appointment start $\rightarrow$ 0% automatic refund.
  - Unpaid appointment cancellation $\rightarrow$ 0.00 BDT refundable.
  - Doctor cancellation $\rightarrow$ 100% refund.
  - Decimal rounding precision on 80% calculations (`ROUND_HALF_UP`).
- **`tests/payments/test_refund_workflow.py`** (9 tests):
  - Paid patient cancellation creates valid `RefundRequest`.
  - Unpaid patient cancellation creates no monetary refund.
  - Duplicate refund request prevention.
  - Hospital Administrator review and forward (`UNDER_REVIEW`).
  - Super Admin mandatory approval enforcement.
  - Super Admin rejection workflow with reason.
  - Online gateway refund execution and balance reconciliation.
  - Chamber manual repayment workflow with voucher code.
  - Gateway refund failure handling and retry support.
- **`tests/payments/test_session_cancellation.py`** (3 tests):
  - Doctor consultation session cancellation with multi-patient refund eligibility.
  - Cancelled session cannot be rebooked.
  - Preserves cancelled appointments and financial records without deletion.
- **`tests/payments/test_booking_consistency.py`** (2 tests):
  - Abandoned online session expiration releases doctor slot capacity for new bookings.
  - Expiration routine strictly retains confirmed Pay at Chamber bookings.

**Total Test Results**:
- `tests.payments`: **35/35 PASSED** (100% success)
- `tests.auth` regression suite: **56/56 PASSED** (100% success)
- Total tests verified: **91 tests passing**.
