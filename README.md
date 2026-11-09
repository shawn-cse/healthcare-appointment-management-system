# Green Hospital - Healthcare Appointment Management System

Green Hospital is an enterprise healthcare appointment booking and clinical management platform designed to connect patients with verified doctors across Bangladesh. The platform streamlines medical specialist discovery, scheduling, consultation workflows, financial collections, refunds, grievance management, and clinical reporting with strict financial integrity and data isolation.

---

## Documentation Quick Links

Comprehensive system documentation is available in the [`docs/`](./docs/) directory:

- 📖 [**Setup Guide (`docs/SETUP.md`)**](./docs/SETUP.md) — Local development environment installation, migrations, and superuser initialization.
- ⚙️ [**Configuration Guide (`docs/CONFIGURATION.md`)**](./docs/CONFIGURATION.md) — Complete environment variable reference, PostgreSQL setup, SSLCOMMERZ gateway, and SMTP/SMS settings.
- 🛡️ [**Roles & Permissions Architecture (`docs/ROLES_AND_PERMISSIONS.md`)**](./docs/ROLES_AND_PERMISSIONS.md) — RBAC permissions matrix, object-level isolation, and refund authority enforcement.
- 🩺 [**Appointment Rules Architecture (`docs/APPOINTMENT_RULES.md`)**](./docs/APPOINTMENT_RULES.md) — 48-hour booking window, Asia/Dhaka time handling, serial allocation, 4-tier fee cycle, and 24-hour refund boundary policy.
- 💳 [**Payment Architecture (`docs/PAYMENT_SETUP.md`)**](./docs/PAYMENT_SETUP.md) — SSLCOMMERZ integration, tamper-proof callbacks, idempotency, local mock gateway, and chamber cash/POS recording.
- 🧪 [**Testing Guide (`docs/TESTING.md`)**](./docs/TESTING.md) — Automated test suite structure, concurrency and boundary testing, and 30-scenario functional checklist.
- 🚀 [**Deployment Guide (`docs/DEPLOYMENT.md`)**](./docs/DEPLOYMENT.md) — Docker containerization, multi-stage Dockerfile, docker-compose, Gunicorn, Nginx reverse proxy, and automated database backups.
- 📊 [**Feature Audit & Implementation Progress (`docs/GREEN_HOSPITAL_PROGRESS.md`)**](./docs/GREEN_HOSPITAL_PROGRESS.md) — Implementation status matrix across all system features and test pass rates.

---

## Core System Architecture & Features

### 1. Identity & Role-Based Access Control (RBAC)
- **5 Discrete System Roles:** Super Admin, Hospital Administrator, Doctor, Receptionist, and Patient.
- **Strict Object-Level Data Isolation:**
  - Doctors view only their own consultations, schedules, and clinical notes.
  - Receptionists access only assigned doctors via `ReceptionistDoctorAssignment`.
  - Patients access only their own medical history, receipts, and refund requests.
  - Private complaints against doctors are strictly isolated from doctors and receptionists.
- **Security Hardening:**
  - Open redirect sanitization on all login workflows.
  - Anti-brute-force login lockout (5 failed attempts within 15 minutes).
  - Super Admin self-demotion and lockout protection.
  - Extension and file-size validation on file uploads (5MB max; `.jpg`, `.jpeg`, `.png`, `.webp` only).

### 2. Clinical Scheduling & 48-Hour Booking Window
- **Asia/Dhaka Fixed Timezone (`UTC+6`):** All scheduling, slot generation, and cancellation policies are authoritative in Bangladesh Standard Time.
- **48-Hour Booking Window Boundary:** Slots unlock exactly 48 hours prior to start and lock at start time.
- **Monotonic Serial Numbers:** Concurrency-safe serial allocation (#1, #2, #3, ...) locked per doctor and date.
- **Capacity Enforcement:** Maximum patient capacity per session and per day is strictly capped.
- **4-Tier Visit Pricing Cycle in BDT:**
  - 1st Visit $\rightarrow$ `fee_first_visit` (Visit Stage 1)
  - 2nd Visit $\rightarrow$ `fee_second_visit` (Visit Stage 2)
  - 3rd Visit $\rightarrow$ `fee_third_visit` (Visit Stage 3)
  - 4th Visit $\rightarrow$ Resets back to Stage 1.
  - Report Check $\rightarrow$ `fee_report_check` (does not advance stage).

### 3. Dual Payment Architecture & Financial Integrity
- **Decoupled Gateway Abstraction:** `PaymentGatewayInterface` with `SSLCommerzGateway` and local `MockPaymentGateway`.
- **Authoritative Server Validation:** Never trusts frontend redirects; verifies Validation IDs directly with gateway server.
- **Tamper & Underpayment Defense:** Manipulated callback amounts are rejected and logged to `AuditLog`.
- **Idempotency on Webhooks & IPNs:** Duplicate callbacks return existing transactions and receipts without double-crediting.
- **15-Minute Checkout TTL:** Abandoned sessions automatically expire to release slot capacity.
- **Pay at Chamber:** Cash and POS card collection by authorized receptionists with official `Receipt` generation.
- **PCI-DSS Compliance:** Zero raw bank card numbers or CVVs stored.

### 4. Strict 24-Hour Cancellation & Refund Subsystem
- **Patient Cancellation Policy:**
  - $\ge 24$ hours before appointment start: **100% refund**.
  - Exactly 24.0 hours before start: **100% refund**.
  - Less than 24 hours before start: **80% refund** (20% hospital processing fee).
  - At or after appointment start: **0% automatic refund** (Admin exception review only).
- **Doctor / Hospital Session Cancellation:** **100% automatic refund** eligibility for all paid patients.
- **Financial Integrity:** Refunds are calculated strictly from money actually paid; unpaid bookings create 0 BDT refundable amount.
- **Super Admin Sole Approval Authority:** Hospital Administrators review and triage requests; Super Admin is the sole authority for final financial payout approval.

### 5. Patient Grievance Subsystem & Multi-Channel Notifications
- **Structured Complaints:** Tracked via references (`CMP-YYYYMMDD-XXXX`) with 24-hour rate limiting.
- **Complete Confidentiality:** Doctor and receptionist access denied to protect patients from retaliation.
- **Multi-Channel Alerts:** Real-time in-app notification center, SMTP transactional emails, and Bangladesh SMS push notifications (`mock`, `greenweb`, `sslwireless`) with deduplication keys.

---

## Tech Stack

- **Backend:** Python 3.11+, Django 5, Django REST Framework
- **Database:** PostgreSQL 15+ (Production/Staging), SQLite 3 (Local Development fallback)
- **Server:** Gunicorn WSGI, Nginx Reverse Proxy
- **Containerization:** Docker (multi-stage build, non-root user), Docker Compose
- **Frontend:** HTML5, CSS3, Bootstrap 4, jQuery, Chart.js, HTMX, Font Awesome

---

## Quickstart Installation

```bash
# 1. Clone repository
git clone https://github.com/shawn-al-amin/green_hospital.git
cd green_hospital

# 2. Set up virtual environment
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install --upgrade pip
pip install -r requirements.txt

# 4. Copy environment configuration
cp .env.example .env

# 5. Apply database migrations
python manage.py migrate

# 6. Create initial Super Admin account
python manage.py createsuperuser

# 7. Start local development server
python manage.py runserver
```
Navigate to `http://127.0.0.1:8000/` in your browser.

---

## Running Automated Tests

Run the complete test suite across all modules (122+ passing tests):

```bash
# Run all core test suites
python manage.py test tests.auth tests.payments tests.security tests.integration tests.concurrency tests.complaints tests.notifications tests.reporting

# Or run individual modules:
python manage.py test tests.security      # Security hardening & vulnerability tests (7 tests)
python manage.py test tests.concurrency   # Concurrency & exact boundary tests (5 tests)
python manage.py test tests.integration   # End-to-end 11-stage hospital lifecycle (1 test)
python manage.py test tests.payments      # Payment gateways & 24h refund workflow (35 tests)
python manage.py test tests.complaints    # Patient complaints & grievance review (7 tests)
python manage.py test tests.notifications # Multi-channel notifications & deduplication (6 tests)
python manage.py test tests.reporting     # Operational & clinical dashboard reports (6 tests)
python manage.py test tests.auth          # Multi-role RBAC & authentication (56 tests)
```

---

## Staging & Production Deployment via Docker

```bash
# Build and start container stack (Django + PostgreSQL 16)
docker compose up -d --build

# Inspect logs
docker compose logs -f web

# Check container health status
docker compose ps
```

See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for complete production hardening, Nginx configuration, and backup automation scripts.
