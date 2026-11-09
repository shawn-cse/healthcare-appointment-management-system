# Green Hospital Roles & Permissions Architecture

Green Hospital implements strict Role-Based Access Control (RBAC) and object-level authorization across 5 distinct system roles.

---

## 1. System Roles

1. **Super Admin (`super_admin`):**
   Hospital Director or Chief Administrative Officer. Holds full operational authority, configuration privileges, staff role assignment, audit-log inspection, and is the **sole authority for approving financial refunds**.
2. **Hospital Administrator (`hospital_admin`):**
   Operational administrator. Manages doctor profile verification/approvals, department and chamber assignments, receptionist-to-doctor assignments, schedule monitoring, patient complaints, and refund request triage. **Hospital Administrators are strictly prohibited from approving refunds.**
3. **Doctor (`doctor`):**
   Licensed medical practitioner verified via Bangladesh Medical & Dental Council (BMDC) registration. Manages their weekly schedule sessions, views their assigned patients and consultations, updates clinical notes and consultation completion status, and views their personal practice performance reports.
4. **Receptionist (`receptionist`):**
   Front-desk staff. Assigned by administration to one or more specific doctors. Manages patient queue, processes check-ins, books walk-in appointments, records in-person chamber payments (cash/POS), and generates physical receipts.
5. **Patient (`patient`):**
   Hospital visitor seeking consultation. Can search approved doctors, view available slots within the 48-hour booking window, book appointments with online or chamber payment options, download receipts, view their appointment history, request refunds for cancellations, and submit complaints regarding services.

---

## 2. RBAC Permissions Matrix

| Feature / Resource | Super Admin | Hospital Admin | Doctor | Receptionist | Patient |
|---|:---:|:---:|:---:|:---:|:---:|
| **Doctor Profile Approvals & BMDC Verification** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Department & Chamber Room Assignments** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Receptionist-to-Doctor Assignments** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Hospital Setting (48h Window Configuration)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Staff Role Management & Suspension** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Audit Log Inspection** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Review & Triage Refund Requests** | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Final Refund Approval Authority** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Execute Refund Payout (Gateway/Manual)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Review & Resolve Patient Complaints** | ✅ | ✅ | ❌ (Strict) | ❌ (Strict) | ❌ |
| **Submit Patient Complaint** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **View Own Complaints** | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Create & Manage Doctor Consultation Schedules** | ✅ | ✅ | ✅ (Own) | ❌ | ❌ |
| **Emergency Consultation Session Cancellation** | ✅ | ✅ | ✅ (Own) | ❌ | ❌ |
| **Book Appointment (Online / Chamber)** | ✅ | ✅ | ❌ | ✅ (Walk-in) | ✅ (Online) |
| **Record Chamber Payment (Cash/POS)** | ✅ | ✅ | ❌ | ✅ (Assigned) | ❌ |
| **Patient Check-In** | ✅ | ✅ | ❌ | ✅ (Assigned) | ❌ |
| **Complete Consultation** | ❌ | ❌ | ✅ (Own) | ❌ | ❌ |
| **View Clinical & Financial Reports** | ✅ (Global) | ✅ (Global) | ✅ (Own) | ✅ (Assigned) | ❌ |

---

## 3. Object-Level Data Isolation Rules

### 3.1 Doctor Isolation
- Doctors can only view, query, or cancel appointments where `booking.doctor == request.user`.
- Attempting to access another doctor's consultation or medical note raises HTTP 403 Forbidden.
- Doctors have no visibility into administrative audit logs or complaints filed against themselves or peers.

### 3.2 Receptionist Doctor Assignment Isolation
- Receptionists can only access doctor schedules, queues, check-ins, and chamber payment records for doctors explicitly linked to them via `ReceptionistDoctorAssignment`.
- Attempting to check in a patient or view the appointment list for an unassigned doctor raises `PermissionDenied` ("Access denied: You are not assigned to Dr. [Name]").

### 3.3 Patient Privacy Isolation
- Patients can only view, download invoices for, cancel, or request refunds for appointments where `booking.patient == request.user`.
- Attempting to query another patient's booking ID returns HTTP 404 / 403.

### 3.4 Strict Complaint Confidentiality
- Patient complaints against doctors are strictly isolated from doctors and receptionists.
- Views in the `complaints` module enforce `AdminRequiredMixin`. Unauthorized attempts by doctors or receptionists are blocked and logged.

---

## 4. Refund Approval Sole Authority Enforcement

Financial integrity rules dictate a two-tier refund workflow:
1. **Hospital Administrator:** Can view refund requests, inspect cancellation timestamps against Asia/Dhaka appointment schedules, and mark requests as `UNDER_REVIEW` with administrative notes.
2. **Super Admin:** Is the **only role** with `payments.can_approve_refund` authority. When a non-Super Admin attempts to approve or reject a refund, `SuperAdminRequiredMixin` halts the transaction, raises `PermissionDenied`, and creates a high-priority `SECURITY_ALERT` audit log.

---

## 5. Privilege Escalation & Account Safeguards

- **Super Admin Self-Demotion / Lockout Guard:**
  In `StaffRoleChangeView`, a Super Admin cannot demote their own account to another role or suspend their own account (`target_user == request.user`).
- **Anti-Brute-Force Login Throttling:**
  The login form inspects `AuditLog` for 5 consecutive `LOGIN_FAILED` entries within a rolling 15-minute window for the target username, temporarily locking the account to prevent credential stuffing.
- **Unapproved Doctor Access Restriction:**
  `DoctorRequiredMixin` verifies `request.user.status == StatusChoices.ACTIVE` and profile approval. Unapproved or suspended doctor accounts cannot publish schedules or consult patients.
