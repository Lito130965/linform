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
    if connection.dialect.name == "postgresql":
        # Replicas start together, and the entrypoint of each runs `alembic
        # upgrade head`. Without a lock they read the same current revision and
        # race to apply the next one: deadlocks on DDL if you are lucky, a data
        # migration applied twice if you are not. The lock is session-scoped and
        # released when this connection closes, a few lines below in the caller.
        #
        # Taken BEFORE configure(), so a process that waited here re-reads
        # alembic_version afterwards and finds the work already done.
        connection.exec_driver_sql(f"SELECT pg_advisory_lock({MIGRATION_LOCK_ID})")
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(get_settings().database_url)
    async with engine.connect() as connection:
        await connection.run_sync(_run_sync_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
