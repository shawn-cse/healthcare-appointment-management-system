# Green Hospital Staging & Production Deployment Guide

This document provides complete instructions for deploying the Green Hospital Doctor Appointment Management System to Staging and Production environments using Docker or standalone Linux servers.

---

## 1. Production Architecture Overview

A production Green Hospital deployment typically consists of:
1. **Nginx Reverse Proxy:** Terminates SSL/TLS (HTTPS), manages security headers, and serves cached static/media files.
2. **Gunicorn WSGI Application Server:** Executes Django worker processes behind an unprivileged system user (`appuser`).
3. **PostgreSQL Database Server:** Version 15+ relational database cluster with persistent SSD storage and automated backups.
4. **Volume Mounts:** Persistent volumes for media uploads (`/app/media`) and collected static assets (`/app/staticfiles`).

---

## 2. Docker Container Deployment

### Step 2.1: Prepare Environment File
Create a production `.env` file from the template:
```bash
cp .env.example .env
```
Ensure all production variables are set:
```env
DEBUG=False
SECRET_KEY=generate_with_python_secrets_token_urlsafe_50
ALLOWED_HOSTS=hospital.yourdomain.com
POSTGRES_DB=green_hospital_db
POSTGRES_USER=green_hospital_admin
POSTGRES_PASSWORD=generate_strong_random_db_password
PAYMENT_GATEWAY_PROVIDER=sslcommerz
SSLCOMMERZ_STORE_ID=live_merchant_store_id
SSLCOMMERZ_STORE_PASS=live_merchant_store_pass
SSLCOMMERZ_IS_SANDBOX=False
SECURE_SSL_REDIRECT=True
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_HSTS_SECONDS=31536000
```

### Step 2.2: Build and Start Containers
```bash
docker compose up -d --build
```
The startup sequence in `entrypoint.sh` will:
1. Wait for the PostgreSQL container to become healthy.
2. Automatically apply pending database migrations (`python manage.py migrate --noinput`).
3. Collect static files into the shared volume (`python manage.py collectstatic --noinput`).
4. Start Gunicorn with 3 workers and 2 threads.

### Step 2.3: Verify Container Health
```bash
docker compose ps
docker compose logs -f web
```
The health check will poll `http://localhost:8000/` every 30 seconds.

---

## 3. Nginx Reverse Proxy Configuration

Below is a reference Nginx configuration block (`/etc/nginx/sites-available/green_hospital.conf`):

```nginx
server {
    listen 80;
    server_name hospital.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hospital.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/hospital.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hospital.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security Headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Maximum file upload size for doctor licenses / medical docs
    client_max_body_size 10M;

    # Static Assets
    location /static/ {
        alias /var/lib/docker/volumes/green_hospital_static_volume/_data/;
        expires 30d;
        access_log off;
    }

    # Media Uploads
    location /media/ {
        alias /var/lib/docker/volumes/green_hospital_media_volume/_data/;
        expires 7d;
        access_log off;
    }

    # Application Proxy
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_redirect off;
    }
}
```

---

## 4. Database Backup & Recovery Procedures

### 4.1 Automated Daily Backup Script (`backup_db.sh`)
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/green_hospital"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="$BACKUP_DIR/green_hospital_$TIMESTAMP.sql.gz"

mkdir -p $BACKUP_DIR
docker exec green_hospital_db pg_dump -U green_hospital_admin green_hospital_db | gzip > $FILENAME

# Retain backups for 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
echo "Backup successfully saved to $FILENAME"
```

Add to cron (`crontab -e`):
```cron
0 2 * * * /usr/local/bin/backup_db.sh >> /var/log/green_hospital_backup.log 2>&1
```

### 4.2 Database Restore Procedure
To restore from a compressed SQL backup:
```bash
gunzip -c /var/backups/green_hospital/green_hospital_YYYYMMDD_HHMMSS.sql.gz | \
    docker exec -i green_hospital_db psql -U green_hospital_admin -d green_hospital_db
```

---

## 5. Security & Secrets Management Best Practices

1. **Never Commit Secrets:** `.env`, SSL certificates, and database backup dumps must be excluded in `.gitignore`.
2. **Rotate `SECRET_KEY` Periodically:** Rotating the key invalidates existing sessions without destroying user credentials.
3. **Database Network Isolation:** In Docker Compose, the PostgreSQL container is bound only to the internal bridge network (`green_net`) and does not publish port `5432` to the public host.
4. **Non-Root Execution:** The Docker container executes under unprivileged UID `appuser` (UID 1000) to prevent container escape exploits.
