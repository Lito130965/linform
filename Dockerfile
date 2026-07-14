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

EXPOSE 8000

CMD ["sh", "./docker-entrypoint.sh"]
