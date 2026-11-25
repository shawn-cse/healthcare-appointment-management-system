# Green Hospital — Clinical Appointment & Hospital Management System

Green Hospital is a full-stack **TypeScript**, **React 19**, **Express 4**, **Node.js 22**, **Prisma ORM**, and **PostgreSQL 16** clinical consultation booking, reception desk, finance reconciliation, and patient portal platform.

All PostgreSQL tables (`hospital_*`), constraints, identity keys, business logic, and password compatibility (`pbkdf2_sha256` & `bcryptjs`) preserve the hospital database schema intact.

## Project Structure

```text
Green_Hospital/
├── client/                 # React 19 + TypeScript + Vite 6 + Nginx web application
│   ├── public/
│   ├── src/
│   │   ├── api/            # Axios client & error helpers
│   │   ├── components/     # Icons, date/time pickers, layouts, shared UI
│   │   ├── context/        # AuthContext, ConfirmContext, ToastContext
│   │   ├── pages/          # Patient, Doctor, Receptionist & Admin portal pages
│   │   ├── styles/         # Clinical design system stylesheets
│   │   └── types/          # Shared TypeScript interfaces
│   ├── Dockerfile
│   ├── nginx.conf          # SPA static serving + /api & /media reverse proxy
│   └── package.json
├── server/                 # Express 4 + TypeScript + Prisma + Vitest backend API
│   ├── prisma/
│   │   ├── init.sql        # Idempotent PostgreSQL schema bootstrap
│   │   └── schema.prisma   # Exact mapping to hospital_* tables
│   ├── src/
│   │   ├── config/         # Environment & PostgreSQL/Prisma connection
│   │   ├── controllers/    # Auth, catalog, appointments, complaints, refunds, staff, reports
│   │   ├── middleware/     # JWT auth, role guards, centralized error handler
│   │   ├── routes/         # REST API route definitions
│   │   ├── seed/           # Idempotent starter dataset seeder
│   │   ├── services/       # Booking locks, payment gateway, refunds, audit, serializers
│   │   ├── utils/          # Password verification/hashing, TZ dates, Multer uploads
│   │   ├── app.ts
│   │   ├── server.ts       # Express API entrypoint
│   │   └── worker.ts       # 60s background maintenance scheduler
│   ├── tests/              # Vitest + Supertest integration suite
│   ├── Dockerfile
│   └── package.json
├── .env.example
├── .gitignore
├── docker-compose.yml      # Services: db, api, web, scheduler
└── README.md
```

## Quick Start with Docker

1. Copy `.env.example` to `.env` and configure secrets (`JWT_SECRET`, `DATABASE_PASSWORD`):

```bash
cp .env.example .env
```

2. Build and start all services (`db`, `api`, `web`, `scheduler`):

```bash
docker compose build
docker compose up -d
```

3. Open **`http://localhost:8000`** in your browser.
4. Check API health at `http://localhost:8000/health` (`{"status":"ok","db":"connected"}`).

## Verification & Automated Tests

Run TypeScript compilation checks and the Vitest + Supertest integration test suite against PostgreSQL:

```bash
docker build -t green_hospital_api_test -f server/Dockerfile --target builder server
docker run --rm --network green_hospital_default \
  -e "DATABASE_URL=postgresql://green_user:change_this_database_password@db:5432/green_hospital_test" \
  -e "JWT_SECRET=test-jwt-secret-key" \
  -e "NODE_ENV=test" \
  -e "TIME_ZONE=Asia/Dhaka" \
  -v "${PWD}/server/vitest.config.ts:/app/vitest.config.ts:ro" \
  -v "${PWD}/server/tests:/app/tests:ro" \
  green_hospital_api_test sh -c "npm run typecheck && npm test"
```
