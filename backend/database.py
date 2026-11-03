
"""Database configuration and session management."""

from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

#stores the sqlite database alongside the backend code
DATABASE_PATH = Path(__file__).resolve().parent / "cc_planner.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

# Create the SQLAlchemy engine used for database connections.
# check_same_thread=False allows connections to be used across request threads.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

# SQLite does not enforce foreign keys unless explicitly enabled.
@event.listens_for(engine, "connect")
def enable_sqlite_foreign_keys(connection, _record) -> None:
    """Enable referential integrity for every SQLite connection."""
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

# Configure how database sessions are created throughout the application.
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""


def migrate_import_metadata() -> None:
    """
    Add the nullable import_metadata column to existing projects tables.

    Safe to run repeatedly. Existing project records receive NULL.
    This function must be called after Base.metadata.create_all().
    """
    # Inspect the existing database schema before applying the migration.
    inspector = inspect(engine)

    # Skip the migration if the projects table has not been created.
    if not inspector.has_table("projects"):
        return

    existing_columns = {
        column["name"]
        for column in inspector.get_columns("projects")
    }

    # Add the column only when it does not already exist.
    if "import_metadata" not in existing_columns:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "ALTER TABLE projects "
                "ADD COLUMN import_metadata TEXT NULL"
            )


def get_db() -> Generator[Session, None, None]:
    """Yield a session and always close it after the request."""
    # Create a database session for the current request.
    db = SessionLocal()
    try:
        yield db
    finally:
        # Ensure the session is closed even if the request raises an error.
        db.close()
