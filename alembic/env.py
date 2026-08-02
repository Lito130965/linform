import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.models.database import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=get_settings().database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# Any constant works as long as every process uses the same one; this is
# "linf" in ASCII, read as a number, so it is recognisable in pg_locks.
MIGRATION_LOCK_ID = 0x6C696E66


def _run_sync_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Apply migrations, holding a lock so that replicas starting together do
    not race.

    Every container runs `alembic upgrade head` on startup. Without a lock they
    read the same current revision and both try to apply the next one, which on
    PostgreSQL means one of them fails with "relation already exists" — during a
    rolling deploy, when nobody is watching the logs of the container that lost.

    The lock is held on its OWN connection, and the migration connection is left
    exactly as alembic expects it. That is not fastidiousness: taking the lock on
    the migration connection opens a transaction before alembic opens its own,
    alembic's commit then lands on the inner one, and every migration is quietly
    rolled back when the connection closes. Which looks, in the log, precisely
    like a successful upgrade.
    """
    engine = create_async_engine(get_settings().database_url)
    # Advisory locks are a PostgreSQL feature, and the databases that lack them
    # (SQLite) are single-node by nature, so there is nothing to serialise.
    needs_lock = engine.sync_engine.dialect.name == "postgresql"
    lock_connection = await engine.connect() if needs_lock else None
    try:
        if lock_connection is not None:
            # Session-scoped, so it survives the commits alembic makes below and
            # is only given up where it is released.
            await lock_connection.exec_driver_sql(
                f"SELECT pg_advisory_lock({MIGRATION_LOCK_ID})"
            )
        async with engine.connect() as connection:
            await connection.run_sync(_run_sync_migrations)
    finally:
        if lock_connection is not None:
            await lock_connection.exec_driver_sql(
                f"SELECT pg_advisory_unlock({MIGRATION_LOCK_ID})"
            )
            await lock_connection.close()
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
