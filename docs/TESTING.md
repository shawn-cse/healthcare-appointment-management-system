# Green Hospital Automated & Manual Testing Guide

This guide documents the automated test suite architecture, execution commands, security tests, concurrency/boundary tests, and the 30-scenario manual verification checklist.

---

## 1. Automated Test Suite Architecture

Green Hospital includes a comprehensive, multi-layer automated test suite spanning unit, functional, permission, security, boundary, and full integration tests:

```
tests/
├── auth/                               # Role-based access control & identity tests (56 tests)
│   ├── test_models.py                  # User & Profile model constraints and signals
│   ├── test_views.py                   # Common auth views (login, logout, registration)
│   ├── test_rbac_phase2.py             # Role access matrix and permissions
│   ├── test_doctor_phase3.py           # Doctor verification, BMDC, profile editing
│   ├── test_scheduling_and_booking_phase4_5.py # Schedules, slots, booking logic
│   └── test_dashboards_phase6.py       # Role-specific dashboard views
├── security/                           # Vulnerability & security hardening suite (7 tests)
│   └── test_security_hardening.py      # Open redirect, brute-force, upload validation, isolation
├── payments/                           # Gateway, chamber collection & refund tests (35 tests)
│   ├── test_booking_consistency.py     # Slot holding, abandoned sessions, consistency
│   ├── test_cancellation_refunds.py    # Cancellation policy, calculations, 8-stage refund
│   ├── test_chamber_payments.py        # Receptionist cash/POS collection & permissions
│   └── test_gateways_and_online.py     # SSLCOMMERZ & Mock gateway, callbacks, idempotency
├── complaints/                         # Patient complaint system tests (7 tests)
│   └── test_complaints.py              # Submission, admin review, status transitions, doctor isolation
├── notifications/                      # Transactional in-app, SMS, email tests (6 tests)
│   └── test_notifications.py           # Notifications, deduplication, external failure isolation
├── reporting/                          # Operational & clinical dashboard reports (6 tests)
│   └── test_reporting_dashboards.py    # Daily/weekly statistics, revenue, queue reports
├── integration/                        # End-to-end clinical & financial lifecycle (1 test)
│   └── test_end_to_end_lifecycle.py    # Full 11-stage hospital workflow verification
└── concurrency/                        # Concurrency safeguards & exact boundaries (5 tests)
    └── test_concurrency_and_boundaries.py # 48h boundary, 24.0h refund boundary, serial locks
```

---

## 2. Test Execution Commands

Execute tests using Python inside the activated virtual environment (`.venv`):

### Run All Production Test Suites (Recommended)
```bash
python manage.py test tests.auth tests.payments tests.security tests.integration tests.concurrency tests.complaints tests.notifications tests.reporting
```

### Run by Specific Functional Module
- **Security Hardening Suite:**
  ```bash
  python manage.py test tests.security
  ```
- **Concurrency & Boundary Suite:**
  ```bash
  python manage.py test tests.concurrency
  ```
- **End-to-End Hospital Lifecycle:**
  ```bash
  python manage.py test tests.integration
  ```
- **Payment & Financial Suite:**
  ```bash
  python manage.py test tests.payments
  ```
- **Patient Complaints Suite:**
  ```bash
  python manage.py test tests.complaints
  ```
- **Notification Suite:**
  ```bash
  python manage.py test tests.notifications
  ```
- **Reporting & Operational Dashboards:**
  ```bash
  python manage.py test tests.reporting
  ```

---

## 3. Key Automated Test Coverage Highlights

### 3.1 Security Hardening Tests (`tests.security`)
- `test_login_open_redirect_sanitization`: Verifies that malicious off-site `next` parameters are rejected and sanitized to the default dashboard.
- `test_login_anti_brute_force_lockout`: Confirms accounts are locked for 15 minutes after 5 consecutive failed login attempts.
- `test_super_admin_cannot_demote_or_suspend_self`: Validates protection preventing Super Admin self-lockout or demotion.
- `test_avatar_file_upload_validation`: Confirms non-image or executable files uploaded as avatars are rejected.
- `test_unapproved_doctor_cannot_manage_schedules`: Confirms pending/unapproved doctors cannot publish schedules.
- `test_unauthorized_user_cannot_approve_refund`: Confirms non-Super Admins receive 403 Forbidden when attempting refund approvals.
- `test_object_level_data_isolation`: Confirms patients and doctors cannot access records belonging to other users.

### 3.2 Concurrency & Exact Boundaries (`tests.concurrency`)
- `test_exact_48_hour_booking_window_boundaries`: Verifies slot availability at 48h+1min (blocked), 48.0h exact (allowed), 24h (allowed), 1min (allowed), and 0min (past/blocked).
- `test_exact_cancellation_refund_percentage_boundaries`: Verifies refund percentage at 24h+1min (100%), exactly 24.0h (100%), 23h59min (80%), 1min (80%), and post-start (0%).
- `test_concurrency_serial_allocation_and_capacity_enforcement`: Tests monotonic serial allocation (#1, #2, #3) under atomic row locking and capacity capping.
- `test_duplicate_booking_prevention`: Verifies double booking of the same slot and overlapping patient bookings are blocked.
- `test_duplicate_gateway_callback_idempotency`: Verifies multiple IPN callbacks with identical transaction IDs do not create duplicate receipts.

---

## 4. 30-Scenario Functional Verification Checklist

The system was evaluated against 30 operational scenarios:

1. **Super Admin Setup:** Super Admin created, verified, and accesses executive dashboard. *(VERIFIED)*
2. **Hospital Administrator Account:** Operational staff accesses doctor queue, schedules, and complaints. *(VERIFIED)*
3. **Doctor Registration & BMDC Input:** Doctor registers with mandatory BMDC credential. *(VERIFIED)*
4. **BMDC Manual/API Verification:** Admin verifies BMDC status before approval. *(VERIFIED)*
5. **Doctor Profile Approval:** Doctor account approved; status changes to ACTIVE; in-app/SMS notification sent. *(VERIFIED)*
6. **Doctor Profile Directory Visibility:** Only approved ACTIVE doctors appear in public directory. *(VERIFIED)*
7. **4-Tier Fee Configuration:** Doctor sets 1st, 2nd, 3rd visit fees and report check fee. *(VERIFIED)*
8. **Weekly Consultation Scheduling:** Doctor configures day, start/end time, slot duration, capacity, and chamber. *(VERIFIED)*
9. **Chamber Conflict Detection:** System blocks schedule overlapping another doctor in same room. *(VERIFIED)*
10. **Break & Blocked Interval Handling:** Break periods and holidays are omitted from bookable slots. *(VERIFIED)*
11. **Capacity Enforcement:** Maximum patient capacity per session strictly capped. *(VERIFIED)*
12. **Public Doctor Search & Filtering:** Patients filter doctors by specialization, department, or date. *(VERIFIED)*
13. **48-Hour Booking Window Boundary:** Slots > 48 hours away are strictly locked. *(VERIFIED)*
14. **Patient Booking Journey:** Patient selects open slot within 48h window. *(VERIFIED)*
15. **Daily Serial Number Allocation:** Monotonic sequence (#1, #2, ...) generated per doctor-date. *(VERIFIED)*
16. **Duplicate Booking Prevention:** Same slot cannot be booked twice; overlapping patient bookings blocked. *(VERIFIED)*
17. **Visit Pricing Cycle (1 $\rightarrow$ 2 $\rightarrow$ 3 $\rightarrow$ 1):** Successive visits automatically apply discounted tier fees. *(VERIFIED)*
18. **Report Check Pricing Rule:** Report checking charges report fee and preserves visit stage. *(VERIFIED)*
19. **Receptionist Walk-In Booking:** Receptionist books immediate walk-in patient. *(VERIFIED)*
20. **Receptionist Check-In:** Receptionist marks patient checked in upon arrival. *(VERIFIED)*
21. **Pay at Chamber Recording:** Receptionist records cash/POS payment, issuing official receipt. *(VERIFIED)*
22. **Online Payment (SSLCOMMERZ / Mock):** Checkout initiated, server-verified callback confirms payment. *(VERIFIED)*
23. **Tamper & Underpayment Defense:** Manipulated callback amount rejected, logged to AuditLog. *(VERIFIED)*
24. **Patient Cancellation $\ge 24$h:** 100% refund calculated; RefundRequest created. *(VERIFIED)*
25. **Patient Cancellation $< 24$h:** 80% refund calculated; RefundRequest created. *(VERIFIED)*
26. **Doctor Emergency Session Cancellation:** Doctor cancels session; all affected patients notified and granted 100% refund. *(VERIFIED)*
27. **Refund Approval & Payout:** Super Admin approves refund; gateway/cash repayment executed. *(VERIFIED)*
28. **Patient Complaint Submission & Resolution:** Patient submits complaint; admin reviews, resolves, and replies. *(VERIFIED)*
29. **Doctor & Receptionist Confidentiality:** Private complaints completely hidden from doctors/receptionists. *(VERIFIED)*
30. **Operational Reports & Audit Inspection:** Real-time revenue, consultation, and queue reports rendered. *(VERIFIED)*
