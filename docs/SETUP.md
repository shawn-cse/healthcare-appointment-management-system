# Green Hospital System Setup Guide

This guide details the step-by-step procedure for setting up the **Green Hospital Doctor Appointment Management System** in a local development or evaluation environment.

---

## 1. System Requirements

- **Operating System:** Windows, Linux, or macOS.
- **Python:** Python 3.11 or higher (tested with Python 3.11, 3.12, 3.14).
- **Database:** SQLite 3 (default for local development) or PostgreSQL 15+ (recommended for staging/production).
- **Git:** Version 2.30+.
- **Virtual Environment Tool:** `venv` (bundled with Python).

---

## 2. Repository Cloning and Virtual Environment Setup

### Step 2.1: Clone Repository
```bash
git clone https://github.com/shawn-al-amin/green_hospital.git
cd green_hospital
```

### Step 2.2: Create and Activate Virtual Environment
**On Windows (PowerShell):**
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

**On Linux / macOS (Bash):**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Step 2.3: Upgrade Package Installer and Install Dependencies
```bash
python -m pip install --upgrade pip
pip install -r requirements.txt
```

---

## 3. Environment Configuration

Copy the template environment configuration file:
```bash
cp .env.example .env
```
*(On Windows PowerShell: `Copy-Item .env.example .env`)*

For local development with SQLite and simulated payment/SMS gateways, the defaults in `.env.example` are pre-configured:
- `DEBUG=True`
- `PAYMENT_GATEWAY_PROVIDER=mock`
- `SMS_GATEWAY_PROVIDER=mock`
- `EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend`
- Default SQLite database (`db.sqlite3`).

---

## 4. Database Setup and Migrations

Apply all schema migrations to create database tables:
```bash
python manage.py migrate
```

Verify that all apps (`accounts`, `doctors`, `bookings`, `patients`, `payments`, `complaints`, `notifications`) are migrated cleanly.

---

## 5. Administrative Account Creation

Create an initial Super Admin account:
```bash
python manage.py createsuperuser
```
Follow the prompts to enter:
- **Username:** `admin` (or your choice)
- **Email:** `director@greenhospital.org`
- **Password:** Strong password meeting standard Django security validators (min 8 characters, non-numeric, not common).

---

## 6. Running the Development Server

Start the local HTTP development server:
```bash
python manage.py runserver 127.0.0.1:8000
```
Open your browser to:
- **Public Portal & Doctor Directory:** `http://127.0.0.1:8000/`
- **Admin Dashboard:** `http://127.0.0.1:8000/dashboard/`
- **Django Core Admin:** `http://127.0.0.1:8000/admin/`

---

## 7. Initial Data Seeding (Optional)

To test operational flows quickly:
1. Log in as Super Admin (`/accounts/login/`).
2. Register a Doctor account (`/accounts/register/doctor/`) or promote an existing user.
3. As Super Admin, navigate to **Doctor Approvals** (`/accounts/admin/doctor-approvals/`), verify the BMDC registration number, and click **Approve Doctor**.
4. Log in as the approved Doctor to configure weekly consultation sessions and fee tiers.
5. Create a Patient account to book appointments within the 48-hour booking window.
