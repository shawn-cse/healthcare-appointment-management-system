#!/bin/sh
set -e

# ==============================================================================
# Green Hospital Application Entrypoint Script
# Handles database wait, automatic schema migration, and static asset collection
# ==============================================================================

echo ">>> [Green Hospital] Initializing container startup..."

# Wait for PostgreSQL database if host is specified
if [ -n "$POSTGRES_HOST" ] || [ -n "$DATABASE_URL" ]; then
    echo ">>> [Green Hospital] Waiting for database connection..."
    python << 'EOF'
import os
import sys
import time
import psycopg2

db_url = os.getenv("DATABASE_URL")
if db_url:
    import urllib.parse
    parsed = urllib.parse.urlparse(db_url)
    dbname = parsed.path.lstrip('/')
    user = parsed.username
    password = parsed.password
    host = parsed.hostname
    port = parsed.port or 5432
else:
    dbname = os.getenv("POSTGRES_DB")
    user = os.getenv("POSTGRES_USER", "postgres")
    password = os.getenv("POSTGRES_PASSWORD", "")
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")

max_retries = 30
retry_count = 0
while retry_count < max_retries:
    try:
        conn = psycopg2.connect(
            dbname=dbname,
            user=user,
            password=password,
            host=host,
            port=port,
            connect_timeout=3
        )
        conn.close()
        print(">>> [Green Hospital] Database connection established successfully.")
        sys.exit(0)
    except Exception as e:
        retry_count += 1
        time.sleep(1)

print(f">>> [Green Hospital] ERROR: Database unreachable after {max_retries} attempts.")
sys.exit(1)
EOF
fi

# Run Django migrations
echo ">>> [Green Hospital] Applying database migrations..."
python manage.py migrate --noinput

# Collect static assets
echo ">>> [Green Hospital] Collecting static files..."
python manage.py collectstatic --noinput --clear || true

echo ">>> [Green Hospital] Startup preparation complete. Launching server process..."
exec "$@"
