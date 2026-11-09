# Green Hospital - Phase 9 & Phase 10 Implementation & Progress Notes

## Overview
This document details the implementation of **Phase 9 (Patient Complaints & Multi-Channel Notifications)** and **Phase 10 (Operational Dashboards, Role-Specific Reporting, UI Modernization & Bangladesh Localization)** for the **Doctor Appointment System for Green Hospital**.

---

## 1. Patient Complaints Subsystem (`complaints`)

### 1.1 Architecture & Data Model (`complaints/models.py`)
The `Complaint` model implements structured dispute and grievance handling with auditable lifecycle statuses:
- **Reference**: Auto-generated tracking reference format `CMP-YYYYMMDD-XXXX` (e.g. `CMP-20261109-A1B2`).
- **Participants**:
  - `patient`: Foreign key to `User` (strictly role `PATIENT`).
  - `doctor`: Foreign key to `User` (strictly role `DOCTOR`).
  - `booking`: Optional foreign key to `Booking`, validated to belong to both the complaining patient and the doctor.
- **Classification Categories**:
  - `wait_time`: Excessive Wait Time / Delay
  - `unprofessional_behavior`: Unprofessional or Rude Behavior
  - `diagnosis_concern`: Prescription or Treatment Concern
  - `billing_fee_dispute`: Billing or Consultation Fee Dispute
  - `chamber_cleanliness`: Chamber Facility or Cleanliness
  - `other`: Other Operational Concern
- **Auditable Status Workflow**:
  - `SUBMITTED`: Newly lodged by patient; awaiting review.
  - `UNDER_REVIEW`: Hospital Administrator / Super Admin reviewing incident.
  - `RESOLVED`: Administrative action taken; resolution provided.
  - `REJECTED`: Frivolous or invalid complaint rejected with explanation.
  - `CLOSED`: Final administrative closure.
- **Administrative Response Fields**:
  - `admin_notes`: Internal administrative notes.
  - `admin_response`: Official response visible to the patient.
  - `reviewed_by`: Administrative user handling the complaint.
  - `reviewed_at`: Authoritative timestamp.

### 1.2 Anti-Spam Protection & Rate Limiting (`complaints/services.py`)
- Rate limiting enforces a **maximum of 3 complaints per 24 hours** per patient across the hospital platform.
- Attempting to submit a 4th complaint within 24 hours raises a `ValidationError`, preventing flood attacks and harassment against healthcare practitioners.

### 1.3 Strict Privacy & Access Control Matrix
- **Patients**: Can only create complaints and view their own submitted complaints (`patient=request.user`). Attempting to view another patient's complaint returns `404 Not Found`.
- **Doctors & Receptionists**: **Strictly blocked** (`PermissionDenied` / `403 Forbidden`). Doctors cannot view, modify, or intercept complaints filed against them or peers, preserving patient confidentiality and preventing doctor-patient intimidation.
- **Hospital Administrators & Super Admins**: Full review authority to investigate, leave internal notes, formulate patient responses, and update lifecycle statuses.
- **Audit Logging**: Every complaint filed and reviewed is logged to `AuditLog` with actor, IP address, and metadata.

---

## 2. Notification Subsystem (`notifications`)

### 2.1 Multi-Channel Abstraction (`notifications/channels/`)
Notifications follow a provider-agnostic, extensible channel architecture:
- `BaseNotificationChannel`: Abstract Base Class defining standard contracts.
- `InAppNotificationChannel`: Persists in-app alerts in `Notification` model with read/unread flags, timestamps, and deep links.
- `EmailNotificationChannel`: Formats and delivers emails via Django's mail system.
- `SMSNotificationChannel`: Formats and delivers SMS alerts tailored for Bangladesh mobile networks.

### 2.2 Critical Safety & Privacy Principles
1. **Non-Blocking Resilience**: External email (SMTP) and SMS gateways are wrapped in exception handlers. Network timeouts or API outages log warnings but **never block or fail core bookings, payments, or refund transactions**.
2. **Medical Privacy & Sanitization**:
   - Confidential medical details, symptoms, diagnoses, and prescription texts are **strictly excluded** from SMS and email payloads.
   - Notifications contain only operational details (doctor name, date, time, serial number, transaction ID, chamber number).
3. **SMS Length Constraints**: Messages formatted for standard 160-character Bangladesh SMS boundaries (`sms_text[:152] + "..."`).
4. **Idempotency & Deduplication Keys**: Notifications accept a `deduplication_key` (e.g. `booking_confirmed_patient_<id>`). Duplicate triggers (such as repeated gateway webhooks or retry requests) are safely skipped.

### 2.3 Integrated Notification Triggers
- `notify_doctor_registration`: Alerts administrators when a new doctor registers with BMDC credentials.
- `notify_doctor_approved` / `notify_doctor_rejected`: Informs doctor of credential verification outcome.
- `notify_booking_confirmed`: Sends appointment confirmation, serial number, and chamber location to both patient and doctor.
- `notify_booking_cancelled`: Sends cancellation alert with reason and actor to both patient and doctor.
- `notify_session_cancelled`: Notifies all affected patients when a doctor cancels a consultation session.
- `notify_payment_success` / `notify_payment_failed`: Sends transaction reference and receipt links upon payment completion.
- `notify_refund_requested`, `notify_refund_approved`, `notify_refund_rejected`, `notify_refund_completed`: Real-time updates throughout the 8-stage refund lifecycle.
- `notify_complaint_submitted`, `notify_complaint_status_update`: Notifies admins of new complaints and updates patients upon administrative review.

---

## 3. Operational Dashboards & Role-Specific Reporting

### 3.1 Super Admin Dashboard (`/admin/`)
Provides real-time clinical, operational, and financial analytics:
- **Personnel Metrics**: Total doctors, active/approved doctors, pending credential approvals, rejected doctors, suspended doctors, registered patients, receptionists, hospital admins.
- **Appointment Metrics**: Today's appointments, upcoming consultations, completed consultations, cancellations, no-shows (calculated using `Asia/Dhaka` timezone).
- **Financial Integrity**:
  - `total_collected`: Gross successful collections across Online and Chamber methods.
  - `online_collected` vs `chamber_collected`: Separation of payment channels.
  - `total_refunded`: Sum of executed refund payouts.
  - `net_revenue`: Decimal-safe calculation (`total_collected - total_refunded`) preventing double counting.
  - `unpaid_bookings_count` & `unpaid_bookings_amount`: Outstanding revenue pending chamber collection.
- **Refund Approval Queue**: Direct review and approval interface for pending refund requests (**Super Admin exclusive**).
- **Complaint Summary**: Total complaints, submitted, under review, and resolved.
- **Hospital Policy Configuration**: In-dashboard control for the appointment booking advance window (`booking_window_hours`, default 48h).

### 3.2 Hospital Administrator Dashboard (`/admin/`)
- Manages daily clinic operations, doctor schedule approvals, receptionist assignments, and patient complaints.
- **Strict Financial Boundary**: Hospital Administrators can view and forward refund requests, but **cannot approve or execute refunds** (`PermissionDenied` enforced).

### 3.3 Doctor Reports & Analytics (`/doctors/reports/`)
- **Strict Data Isolation**: Doctors can only access their own consultations, fees, and patient statistics (`doctor=request.user`).
- **Date Range Filters**: `today`, `this_week`, `this_month`, and custom date ranges.
- **Key Performance Indicators**:
  - Total consultations booked.
  - Completed consultations.
  - Upcoming consultations.
  - Cancellations and no-shows.
  - Total slot capacity across active weekly schedules.
  - **Patient Capacity Utilization Rate** (`(active_booked / total_capacity) * 100%`).
  - Gross consultation fees collected, refunds deducted, and net earnings.
- **CSV Export**: `?export=csv` allows downloading consultation logs.

### 3.4 Receptionist Daily Reports & Queue Oversight (`/accounts/receptionist/reports/`)
- **Doctor Assignment Scoping**: Receptionists see daily queue and chamber collection metrics **only for doctors assigned to them** via `ReceptionistDoctorAssignment`.
- **Queue Metrics**: Total appointments, checked-in count, completed count, paid online, collected at chamber, and outstanding unpaid bookings.
- **CSV Export**: `?export=csv` enables exporting daily doctor queue sheets for front-desk clipboards and cash registers.

### 3.5 Patient Portal & Dashboard (`/patients/dashboard/`)
- Consolidated tabbed interface:
  - **Appointments**: Upcoming and historical appointments with doctor details, serial numbers, chamber numbers, and invoices.
  - **Refund Progress**: Real-time tracker for cancellation refunds (status, eligible amount, requested amount, repayment reference).
  - **Complaints & Grievances**: Patient complaint status tracker, administrative response feedback, and direct link to "File a Complaint".

---

## 4. Complete Application Page Inventory

| URL Path | Name | Role / Permission | Template | Key Features |
|---|---|---|---|---|
| `/` | `core:home` | Public | `home.html` | Hero search, doctor listings, specialization cards, Green Hospital branding |
| `/doctors/` | `doctors:doctor-list` | Public | `doctors/doctor-list.html` | Search by name, specialization, fee filter, availability calendar link |
| `/doctors/<username>/` | `doctors:doctor-profile` | Public | `doctors/doctor-profile.html` | Doctor qualifications, BMDC verification badge, weekly schedule, pricing |
| `/bookings/create/<username>/` | `bookings:create-booking` | Patient | `bookings/booking.html` | Slot selection, visit type, dynamic fee calculation, online vs chamber payment choice |
| `/bookings/<id>/invoice/` | `bookings:booking-invoice` | Patient / Staff | `bookings/invoice.html` | Appointment confirmation, serial number, printable invoice |
| `/payments/checkout/<id>/` | `payments:checkout-start` | Patient | `payments/checkout_start.html` | Payment session creation, fee verification, SSLCOMMERZ redirection |
| `/payments/receipt/<receipt_no>/` | `payments:receipt-detail` | Patient / Staff | `payments/receipt_detail.html` | Verifiable official receipt with QR/barcode, method, and transaction references |
| `/payments/receipt/<receipt_no>/print/`| `payments:receipt-print` | Patient / Staff | `payments/receipt_print.html` | Clean, printer-optimized official receipt |
| `/payments/chamber-collect/<id>/` | `payments:chamber-collect` | Receptionist / Admin | `payments/chamber_collect.html` | Cash / POS chamber collection, idempotency guard, receipt issuance |
| `/payments/refund/request/<id>/` | `payments:refund-request` | Patient | `payments/refund_request_form.html` | 24h cancellation refund calculator (100% vs 80%), submission form |
| `/payments/refund/<ref>/` | `payments:refund-detail` | Patient / Admin | `payments/refund_detail.html` | 8-stage refund status tracker, approval timestamps, payout voucher |
| `/payments/admin/refunds/` | `payments:admin-refund-list`| Hospital / Super Admin | `payments/admin_refund_list.html` | Multi-status filter, queue monitoring, review action |
| `/payments/admin/refunds/<ref>/approve/`| `payments:superadmin-refund-approve` | Super Admin Only | View action | Final approval authorization, updates status to APPROVED |
| `/payments/session-cancel/` | `payments:doctor-session-cancel` | Doctor / Admin | `payments/doctor_session_cancel.html` | Mass-cancellation with reason, automatic 100% refund eligibility trigger |
| `/complaints/submit/` | `complaints:patient-create` | Patient | `complaints/patient_complaint_form.html` | Rate-limited complaint submission, category selection, doctor reference |
| `/complaints/my-complaints/` | `complaints:patient-list` | Patient | `complaints/patient_complaint_list.html` | List of submitted complaints, status badges, response indicators |
| `/complaints/my-complaints/<id>/` | `complaints:patient-detail`| Patient | `complaints/patient_complaint_detail.html` | Timeline, admin response, status resolution |
| `/complaints/admin/list/` | `complaints:admin-list` | Hospital / Super Admin | `complaints/admin_complaint_list.html` | Queue of complaints, category/status filtering, search |
| `/complaints/admin/<id>/review/` | `complaints:admin-review` | Hospital / Super Admin | `complaints/admin_complaint_review.html` | Update status (`RESOLVED`, `REJECTED`), record internal notes & response |
| `/notifications/` | `notifications:list` | Authenticated | `notifications/notification_list.html` | Notification center, unread filter, mark as read, deep linking |
| `/doctors/reports/` | `doctors:reports` | Doctor | `doctors/reports.html` | Capacity utilization, fee summaries, consultation logs, CSV export |
| `/accounts/receptionist/reports/` | `accounts:receptionist-reports`| Receptionist | `receptionist/reports.html` | Assigned doctor daily queue, chamber cash tally, CSV export |
| `/admin/reports/appointments/` | `admin-appointment-report` | Admin | `dashboard/appointment-report.html` | Hospital-wide appointment analytics and CSV export |
| `/admin/reports/revenue/` | `admin-revenue-report` | Admin | `dashboard/revenue-report.html` | Hospital-wide revenue, collections vs refunds, CSV export |
| `/patients/dashboard/` | `patients:dashboard` | Patient | `patients/dashboard.html` | Appointments, serial numbers, refund progress, complaints |
| `/admin/` | `admin-dashboard` | Hospital / Super Admin | `dashboard/index.html` | Executive KPI dashboard, refund approvals, policy configuration |

---

## 5. External Credentials & Environment Configuration

All third-party credentials reside strictly in environment variables (`.env`):

```bash
# ==============================================================================
# Green Hospital - Production / Sandbox Configuration
# ==============================================================================

# General
DEBUG=False
SECRET_KEY=production-secret-key-green-hospital
ALLOWED_HOSTS=greenhospital.com,www.greenhospital.com,127.0.0.1,localhost
SITE_URL=https://greenhospital.com

# Payment Gateway (SSLCOMMERZ)
PAYMENT_GATEWAY_PROVIDER=sslcommerz           # Options: "sslcommerz" (live/sandbox) or "mock" (dev)
SSLCOMMERZ_IS_SANDBOX=True                    # Set False for production
SSLCOMMERZ_STORE_ID=your_store_id_here
SSLCOMMERZ_STORE_PASSWORD=your_store_passwd_here

# Outbound Email (SMTP)
EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
EMAIL_HOST=smtp.gmail.com                     # Or hospital mail server
EMAIL_PORT=587
EMAIL_USE_TLS=True
EMAIL_HOST_USER=notifications@greenhospital.com
EMAIL_HOST_PASSWORD=your_app_specific_password_here
DEFAULT_FROM_EMAIL=Green Hospital <notifications@greenhospital.com>

# Outbound SMS Gateway (Bangladesh Mobile Operators: Grameenphone, Robi, Banglalink, Teletalk)
BANGLADESH_SMS_GATEWAY_URL=https://api.sms-provider.com.bd/v3/send
BANGLADESH_SMS_API_KEY=your_bangladesh_sms_api_key_here
BANGLADESH_SMS_SENDER_ID=GreenHosp             # Approved BTRC Sender Masking
```

---

## 6. Test Suite Execution & Verification Matrix

The test suite validates compliance with all functional, security, and financial integrity requirements.

| Suite | Tests | Status | Core Assertions Verified |
|---|---|---|---|
| `tests.complaints` | 7 | **PASS** | Auto-reference generation (`CMP-`), anti-spam rate limit (max 3/24h), patient data isolation, doctor/receptionist access denial, administrative review & status transition, patient notification |
| `tests.notifications` | 6 | **PASS** | In-app creation, read tracking, deduplication key enforcement, email failure resilience (non-blocking), SMS length truncation & sanitization, domain trigger event dispatch, context processor |
| `tests.reporting` | 6 | **PASS** | Super Admin dashboard KPIs & policy form, Hospital Admin refund rejection (Super Admin only permission check), Doctor report data isolation & CSV, Receptionist assigned doctor scoping & CSV, Admin reports CSV, Patient dashboard tabs |
| `tests.payments` | 35 | **PASS** | Decimal-safe BDT math, amount tampering detection, idempotency, duplicate callback protection, chamber collection security, 24h cancellation refund policy (100% vs 80%), session cancellation |
| `tests.auth` | 56 | **PASS** | RBAC, BMDC verification, doctor registration review, receptionist assignments, profile editing, audit logs |
| **Total** | **110** | **100% PASS** | **Zero failures, zero regressions** |

```
Ran 19 tests in 40.936s (complaints, notifications, reporting) -> OK
Ran 35 tests in 24.883s (payments & refunds)                   -> OK
Ran 56 tests in 38.102s (auth, rbac, schedules)                -> OK
```
