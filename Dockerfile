# Base images are pinned by digest, not just by tag: a tag is mutable, so
# "node:20-alpine" can mean different bytes next week and a build that passed CI
# is not the build that ships. Update these deliberately (and read the upstream
# changelog when you do) rather than drifting silently.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS ui
WORKDIR /ui
# npm ci, not npm install: the lock file pins exact versions, the install is
# reproducible, and a broken node_modules fails loudly instead of exiting 0
# with half the packages missing (seen in the wild: "Exit handler never
# called!" followed by "tsc: not found" one step later).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build


FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

# WeasyPrint native dependencies + fonts with Cyrillic coverage
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz-subset0 \
    fonts-dejavu-core \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/linform

COPY pyproject.toml constraints.txt README.md ./
COPY app ./app
# Constraints for the same reason the base images carry digests: without them
# the packages inside a reproducible image are whatever resolved that day —
# including WeasyPrint, whose version decides what the PDFs look like.
RUN pip install --no-cache-dir . -c constraints.txt

COPY alembic.ini docker-entrypoint.sh ./
COPY alembic ./alembic
# Showcase examples the editor gallery serves (single source of truth with the
# curl-able examples/ folder). parents[2] from app/services resolves here.
COPY examples ./examples
COPY --from=ui /ui/dist ./app/static

# Run as an unprivileged user. A template is untrusted input and the renderer
# executes a large native stack (Pango, cairo, image codecs) on it, so a bug
# there should not land on a root shell. The application directory is handed to
# the user because the zero-config SQLite default writes its file next to the
# code; with PostgreSQL nothing here is written at runtime.
RUN useradd --system --uid 10001 --create-home linform \
    && chown -R linform:linform /srv/linform
USER linform

EXPOSE 8000

# Liveness only — /health deliberately does not touch the database, so a
# database blip cannot make Docker restart a healthy container. Readiness
# (/ready) is for the load balancer, not for the restart policy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

CMD ["sh", "./docker-entrypoint.sh"]
