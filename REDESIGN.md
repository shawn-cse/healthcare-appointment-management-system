# Green Hospital redesign audit

## Baseline comparison

| Area | Implemented | Missing, incorrect, or redundant |
| --- | --- | --- |
| Database and authentication | PostgreSQL bootstrap, Prisma mappings, JWT authentication, bcrypt and legacy password verification, duplicate checks | Versioned upgrades, independent login permission, session revocation, required username and gender at registration, canonical phone handling, verified ownership for historical linking |
| Public website | Hospital information, departments, doctor catalog, appointment availability | Shared doctor cards and recurring consultation details, multiline professional experience, combined About & Contact navigation |
| Patient portal | Booking, appointment detail, complaints and gateway payment | Appointment issue intake, searchable payment history, notifications, payment-method changes, patient workflow restrictions |
| Doctor panel | Scoped appointments, recurring rules, doctor fees, complaints | Recurring-only administration, independent validity periods, profile fields, staff directory and internal support |
| Reception | Scoped appointments, assisted booking, counter collections and refund routes | Verified patient association, authorized operational requests, admin-only refund approval, transaction history and support |
| Admin | Staff onboarding, departments, rooms, appointments, complaints and audit | Independent account controls, support, commission management, transaction reports and system settings |
| Finance | Gateway verification, transaction records, appointment snapshots and ExcelJS | Transaction-date reconciliation and comprehensive filtered exports, stricter paid-fee and refund authorization |
| UI and verification | Shared layouts and controls, existing PostgreSQL integration suite | Consistent tables and responsive navigation, updated regression coverage, fresh and existing database verification |

## Implemented changes

- Account status and login permission are independent. Blocking and password changes invalidate issued sessions. Registration uses a full name, explicit username, gender, and normalized phone number. Staff onboarding accepts doctor registration details and profile photos.
- The public doctor catalog and patient directory share doctor cards. Public consultation times come from recurring schedules, and booking screens display applicable fees, payment methods, and policies. Recurring edits retain the original dates and times of booked appointments.
- The patient portal includes appointment issue reporting, complaint conversations, verified phone ownership, payment history, and dashboard updates. Staff-assisted booking stores age and gender directly and requires verified phone ownership and identity confirmation before associating a registered account.
- Appointment adjustments, counter payments, refund review, complaint routing, and internal support enforce role and assignment checks on the API. Complaint attachments require authorization.
- Financial reports use transaction dates for verified charges and completed refunds and consultation dates for appointment records. Excel exports use the filtered records and corresponding totals. Commission rules are independent of the patient fee and new bookings store their commission rule and calculated shares.

## Verification and operating limits

- The backend build, frontend production build, and TypeScript checks passed. The PostgreSQL integration suite passed 20 tests against a disposable database. Coverage includes session revocation, role restrictions, verified guest linking, recurring schedule edits, authorized rescheduling, payment method changes, refund authorization, transaction-date reconciliation, Excel export, and mocked gateway cancellation and callback verification.
- PostgreSQL 16 bootstrapped successfully from an empty database. A separate legacy fixture applied six migrations and accepted a repeat run. The historical appointment, payment, commission amounts, and complaint remained present with the original values.
- Edge layout checks covered the public doctor directory at 390, 768, 1280, and 1440 px. Nine admin tables fit the available content widths at 1280 and 1440 px. The checks covered staff, appointments, commissions, reports, rooms, departments, payments, complaints, and support.
- A hospital database and live payment and SMS providers require environment-specific acceptance testing. The suite exercises the phone verification and linking logic using a stored test challenge. It does not send SMS or submit real charges or refunds.
- Existing legacy booking rules remain in effect until edited. Old appointments keep their original stored fee and share amounts. A legacy booking cannot reconstruct a commission rule that was not stored at the time.
- The production dependency audit reported seven unresolved advisories, five rated high. Vite reported that the main minified JavaScript chunk exceeds 500 kB.
