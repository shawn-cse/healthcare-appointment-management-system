# 🏥 Doctor Appointment System for Green Hospital

A role-based clinic and hospital appointment management system built with **Django** and **PostgreSQL**. Designed for **Green Hospital**, it enables patients to book appointments, doctors to manage clinical consultations, receptionists to handle queues and schedules, and administrators to oversee hospital analytics.

---

## 🔑 Sign-In Accounts

All pre-seeded test accounts use the password: **`abc123`**

| Role | Username | Phone Number | Email | Password |
| --- | --- | --- | --- | --- |
| **Admin** | `admin` | `01900000000` | `admin@greenhospital.local` | `abc123` |
| **Doctor** | `karim` | `01800000001` | `karim@gmail.com` | `abc123` |
| **Doctor** | `mahmud_rahman` | `01800000002` | `mahmud_rahman@gmail.com` | `abc123` |
| **Doctor (Prof.)** | `shamima_sultana` | `01899990707` | `shamima.sultana@greenhospital.local` | `abc123` |
| **Receptionist** | `shirin` | `01700004001` | `shirin.reception@gmail.com` | `abc123` |
| **Receptionist** | `masud` | `01700004002` | `masud.reception@gmail.com` | `abc123` |
| **Patient** | `patient1` | `01600005001` | `patient.amin1@gmail.com` | `abc123` |
| **Patient** | `patient2` | `01600005002` | `patient.joya2@gmail.com` | `abc123` |

> 💡 **Note for Patients:** Patients can sign in with **Username** (`patient1`), **Phone** (`01600005001`), or **Email** (`patient.amin1@gmail.com`). When registering, leaving the username blank automatically assigns `patient1`, `patient2`, etc.

---

## 🐳 Setup with Docker (Windows)

When running, the project will display in Docker Desktop and terminal with the container name **`Green_Hospital`** on port **`8000`**.

### 📦 1. First-Time Setup & How to Close

Run these commands in **PowerShell** from the project root folder:

```powershell
# Step 1: Create your environment file
Copy-Item .env.example .env

# Step 2: Build and start the project
docker compose up --build
```

- 🌐 **Web App:** [http://localhost:8000](http://localhost:8000)
- 🏷️ **Docker Container:** `Green_Hospital` | **Port:** `8000`
- 👤 *(Optional)* **Create Admin Superuser (in a new terminal):**
  ```powershell
  docker compose exec web python manage.py createsuperuser
  ```

#### 🛑 How to Close / Stop the Project:
Press `Ctrl + C` in the running terminal, or run:
```powershell
docker compose down
```

---

### 📦 2. How to Reopen (2nd Time Run) & How to Close

Once built, you can start the project instantly without rebuilding:

```powershell
# Start the project
docker compose up
```

*(Tip: Add `-d` to run in background: `docker compose up -d`)*

- 🌐 **Web App:** [http://localhost:8000](http://localhost:8000)
- 🔍 **Verify running status:** `docker ps`

#### 🛑 How to Close / Stop the Project:
```powershell
docker compose down
```

---

### 📦 3. Clean Setup / Full Reset & Restart Fresh

Use this to completely reset the project (wipes database volume, clears cache, and starts fresh):

```powershell
# Step 1: Stop containers and delete all database volumes (-v)
docker compose down -v

# Step 2: Rebuild images from scratch with no cache
docker compose build --no-cache

# Step 3: Start the clean project
docker compose up --build
```
