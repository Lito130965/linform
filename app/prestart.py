"""Wait for the database before running migrations / starting the app.
Used by docker-entrypoint.sh; retrying here keeps docker-compose free of
healthcheck/version quirks."""

import asyncio
import sys

from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings

ATTEMPTS = 30


async def main() -> None:
    engine = create_async_engine(get_settings().database_url)
    for attempt in range(1, ATTEMPTS + 1):
        try:
            async with engine.connect():
                break
        except Exception as exc:
            print(f"Database not ready ({exc.__class__.__name__}), attempt {attempt}/{ATTEMPTS}")
            await asyncio.sleep(1)
    else:
        sys.exit("Database never became ready")
    await engine.dispose()
    print("Database is ready")


if __name__ == "__main__":
    asyncio.run(main())
