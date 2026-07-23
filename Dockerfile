FROM node:20-alpine AS ui
WORKDIR /ui
# npm ci, not npm install: the lock file pins exact versions, the install is
# reproducible, and a broken node_modules fails loudly instead of exiting 0
# with half the packages missing (seen in the wild: "Exit handler never
# called!" followed by "tsc: not found" one step later).
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend ./
RUN npm run build


FROM python:3.12-slim

# WeasyPrint native dependencies + fonts with Cyrillic coverage
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz-subset0 \
    fonts-dejavu-core \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/linform

COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir .

COPY alembic.ini docker-entrypoint.sh ./
COPY alembic ./alembic
COPY --from=ui /ui/dist ./app/static

EXPOSE 8000

CMD ["sh", "./docker-entrypoint.sh"]
