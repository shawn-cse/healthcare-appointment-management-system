# Doctor Appointment System for Green Hospital

## Description
Doctor Appointment System for Green Hospital is a web-based healthcare management platform designed to streamline patient appointments and doctor consultations. It provides role-based access for administrators, doctors, receptionists, and patients with scheduling, queue tracking, and payment processing. The application is built for reliable hospital operations with high security and data isolation.

## Technology Stack
- **Backend:** Python 3.11+, Django 5.0, Django REST Framework
- **Frontend:** HTML5, CSS3, JavaScript, Bootstrap 4, jQuery, HTMX, Chart.js
- **Database:** SQLite 3 (Default local), PostgreSQL 16 (Production/Docker)
- **Deployment & Server:** Gunicorn, Nginx, Docker, Docker Compose
- **Security & Payments:** SSLCOMMERZ Gateway integration (with local mock sandbox), RBAC permissions, CSRF and Session protection

## Demo Accounts for Testing
All demo user accounts are pre-configured with the default password `abc123`:

| Role | Username | Password | Email | Notes |
|---|---|---|---|---|
| **Super Admin** | `admin` | `abc123` | `admin@gmail.com` | Full administrative control & refund approvals |
| **Receptionist** | `nasrin` | `abc123` | `nasrin@gmail.com` | Patient check-ins & chamber cash collections |
| **Doctor** | `tariq` | `abc123` | `tariq@gmail.com` | Cardiology specialist (50 doctors available) |
| **Patient** | `rahim` | `abc123` | `rahim@gmail.com` | Appointment booking & receipts (5 patients available) |

---

## Without Docker — Windows

### First-Time Installation and Setup
1. Open PowerShell and navigate to the project directory:
   ```powershell
   cd D:\001_LO\Coding\healthcare_appointment_management_system
   ```
2. Create and activate a Python virtual environment:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
3. Install the required dependencies:
   ```powershell
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```
4. Copy the environment configuration template:
   ```powershell
   Copy-Item .env.example .env
   ```
5. Apply database migrations:
   ```powershell
   python manage.py migrate
   ```
6. Seed the demo data (creates admin, receptionist, 50 doctors across 10 departments, and 5 patients):
   ```powershell
   python manage.py seed_demo_data
   ```
7. Start the development server:
   ```powershell
   python manage.py runserver
   ```
8. Open your web browser and navigate to:
   ```
   http://127.0.0.1:8000/
   ```

### How to Start the Project Again
1. Open PowerShell and navigate to the project folder:
   ```powershell
   cd D:\001_LO\Coding\healthcare_appointment_management_system
   ```
2. Activate the virtual environment:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
3. Start the server:
   ```powershell
   python manage.py runserver
   ```
4. Open `http://127.0.0.1:8000/` in your browser.

### How to Stop the Project
1. In the PowerShell terminal running the server, press `Ctrl + C`.
2. Deactivate the virtual environment:
   ```powershell
   deactivate
   ```

### How to Rebuild After Code Changes
1. Activate the virtual environment (if not already activated):
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
2. If new packages were added to `requirements.txt`:
   ```powershell
   pip install -r requirements.txt
   ```
3. If models were modified, create and apply database migrations:
   ```powershell
   python manage.py makemigrations
   python manage.py migrate
   ```
4. Start the server:
   ```powershell
   python manage.py runserver
   ```

### How to Reset and Fresh Start (Wipe and Re-seed Database)
1. Stop the running server (`Ctrl + C`).
2. Delete the existing SQLite database:
   ```powershell
   Remove-Item db.sqlite3 -Force
   ```
3. Run migrations to recreate clean database tables:
   ```powershell
   python manage.py migrate
   ```
4. Re-seed all fresh demo accounts and departments:
   ```powershell
   python manage.py seed_demo_data
   ```
5. Start the server:
   ```powershell
   python manage.py runserver
   ```

---

## With Docker — Windows

### First-Time Installation and Setup
1. Ensure Docker Desktop is installed and running on Windows.
2. Open PowerShell and navigate to the project directory:
   ```powershell
   cd D:\001_LO\Coding\healthcare_appointment_management_system
   ```
3. Copy the environment configuration template:
   ```powershell
   Copy-Item .env.example .env
   ```
4. Build and start the containers:
   ```powershell
   docker compose up -d --build
   ```
5. Seed the demo data inside the running web container:
   ```powershell
   docker compose exec web python manage.py seed_demo_data
   ```
6. Open your web browser and navigate to:
   ```
   http://127.0.0.1:8000/
   ```

### How to Start the Project Again
1. Ensure Docker Desktop is running.
2. Open PowerShell in the project directory and start the existing containers:
   ```powershell
   docker compose up -d
   ```
3. Open `http://127.0.0.1:8000/` in your browser.

### How to Stop the Project
1. Open PowerShell in the project directory.
2. Stop the running containers:
   ```powershell
   docker compose down
   ```

### How to Rebuild After Code Changes
1. Rebuild and restart the Docker containers:
   ```powershell
   docker compose up -d --build
   ```
2. Apply any new database migrations inside the container:
   ```powershell
   docker compose exec web python manage.py migrate
   ```

### How to Reset and Fresh Start (Wipe and Re-seed Database)
1. Stop containers and completely wipe all persistent database volumes:
   ```powershell
   docker compose down -v
   ```
2. Rebuild and start clean containers:
   ```powershell
   docker compose up -d --build
   ```
3. Seed the fresh demo data into the clean database:
   ```powershell
   docker compose exec web python manage.py seed_demo_data
   ```
