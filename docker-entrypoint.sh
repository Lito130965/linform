#!/bin/sh
set -e

python -m app.prestart
alembic upgrade head
# $PORT if the platform sets one — Cloud Run, Heroku and their kind assign a
# port and expect the process to listen on it. 8000 otherwise, which is what
# the compose files and the Dockerfile's healthcheck know about.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
