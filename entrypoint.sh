#!/bin/sh
set -eu
python manage.py migrate --noinput
python manage.py collectstatic --noinput
if [ "${SEED_STARTER_ACCOUNTS:-0}" = "1" ]; then
  python manage.py seed_green_hospital
fi
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 3 --timeout 60 --access-logfile -
