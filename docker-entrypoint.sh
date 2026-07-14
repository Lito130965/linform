#!/bin/sh
set -e

python -m app.prestart
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port 8000
