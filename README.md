# Green Hospital — Clinical Appointment & Hospital Management System

Green Hospital is a self-hosted, web-based hospital appointment and management platform for specialist consultations, chamber & room scheduling, reception booking, payments & refunds, and patient portal services.

## Demo Credentials

When initialized with the starter seed (`SEED_STARTER_PASSWORD=abc123`):

| Role | Username | Email | Password | Access |
| :--- | :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin@greenhospital.local` | `abc123` | Full hospital & dashboard access |
| **Doctor** | `karim` | `karim@gmail.com` | `abc123` | Schedule & consultation workspace |
| **Receptionist** | `shirin` | `shirin.reception@gmail.com` | `abc123` | Front desk booking & check-in |
| **Patient** | `patient1` | `patient.amin1@gmail.com` | `abc123` | Patient portal & booking |
| **Clean Setup** | `(BOOTSTRAP_ADMIN_USERNAME)` | `(BOOTSTRAP_ADMIN_EMAIL)` | `(BOOTSTRAP_ADMIN_PASSWORD)` | Set in `.env` for first administrator |

Sign in at `http://localhost:8000/login` using your **Username**, **Email**, or **Phone** with your **Password**.

---

## Docker Setup & Operations

Containers run via `docker-compose.yml`:

- **Frontend Web UI:** `Green_Hospital` → `http://localhost:8000`
- **Backend API:** `Green_Hospital_API` → Port `5000` (proxied via `/api` and `/media`)
- **Database:** `Green_Hospital_DB` → Port `5432`
- **Scheduler Worker:** `Green_Hospital_Scheduler` → Background maintenance tasks

### 1. Fast Setup (First Time)

**Step 1: Create `.env` file**

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

Update `JWT_SECRET` (at least 32 characters) and `DATABASE_PASSWORD` in `.env` before starting.

**Step 2: Build and start containers**

```bash
docker compose up -d --build
```

**Step 3: (Optional) Seed demo data**

```bash
docker compose exec -e SEED_STARTER_PASSWORD=abc123 api npm run seed
```

Open **`http://localhost:8000`** (API health check: `http://localhost:8000/health`).

---

### 2. Daily Workflow (Run, Stop & Maintain)

**Start / Re-run the project:**

```bash
docker compose up -d
```

**Stop / Close the project** *(safe — preserves PostgreSQL data & uploaded media)*:

```bash
docker compose down
```

**Rebuild after code edits:**

```bash
docker compose up -d --build
```

**Check status & view logs:**

```bash
# Check container status
docker compose ps

# View live backend & frontend logs
docker compose logs -f api web

# Restart all services
docker compose restart
```

---

### 3. Clean Setup / Full Reset (Wipe All Data)

Wipes all database records, appointments, payments, and schedules to start completely fresh:

**Step 1: Stop containers and delete all volumes**

```bash
docker compose down -v
```

**Step 2: Start fresh containers**

```bash
docker compose up -d --build
```

**Step 3: Choose setup path**

- **Fresh Hospital:** Set `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` in `.env` before starting, open `http://localhost:8000/login/staff`, then remove `BOOTSTRAP_ADMIN_PASSWORD` from `.env` after signing in.
- **Demo Hospital:** Run the starter seed:

```bash
docker compose exec -e SEED_STARTER_PASSWORD=abc123 api npm run seed
```
