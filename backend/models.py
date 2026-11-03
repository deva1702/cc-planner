
"""Database models for projects, activities, and dependencies."""

from datetime import date, datetime, timezone

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Project(Base):
    """Saved project settings and its activity network."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    project_start: Mapped[date] = mapped_column(Date, nullable=False)
    delivery_date: Mapped[date] = mapped_column(Date, nullable=False)
    buffer_percent: Mapped[float] = mapped_column(
        Float, nullable=False, default=25.0
    )

    # JSON-encoded ISO dates; decoded and validated by the API.
    holidays: Mapped[str] = mapped_column(
        Text, nullable=False, default="[]"
    )

    # Nullable JSON metadata for Excel/CSV imports.
    # The original spreadsheet file is never stored.
    import_metadata: Mapped[str | None] = mapped_column(
        Text, nullable=True, default=None
    )

    # Store timestamps in UTC for consistent project tracking.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    # A project owns its activities; deleting the project also removes them.
    activities: Mapped[list["Activity"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="Activity.id",
        passive_deletes=True,
    )


class Activity(Base):
    """An activity and its position in the planning canvas."""

    __tablename__ = "activities"
    # Activity codes must be unique within a project, not globally.
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "activity_code",
            name="uq_activity_project_code",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    activity_code: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    shop: Mapped[str | None] = mapped_column(String(100), nullable=True)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_finish: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Persist canvas coordinates so activity positions are restored when loaded.
    position_x: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    position_y: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0
    )
    node_type: Mapped[str] = mapped_column(
        String(50), nullable=False, default="activity"
    )

    # Link each activity back to its parent project.
    project: Mapped["Project"] = relationship(back_populates="activities")

    # Incoming dependency links identify this activity's predecessors.
    predecessor_links: Mapped[list["Dependency"]] = relationship(
        back_populates="target",
        foreign_keys="Dependency.target_activity_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    # Outgoing dependency links identify this activity's successors.
    successor_links: Mapped[list["Dependency"]] = relationship(
        back_populates="source",
        foreign_keys="Dependency.source_activity_id",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Dependency(Base):
    """A directed edge from a predecessor to a successor activity."""

    __tablename__ = "dependencies"
     # Prevent duplicate connections between the same pair of activities.
    __table_args__ = (
        UniqueConstraint(
            "source_activity_id",
            "target_activity_id",
            name="uq_dependency_edge",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    target_activity_id: Mapped[int] = mapped_column(
        ForeignKey("activities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # The source activity is the predecessor in the directed connection
    source: Mapped["Activity"] = relationship(
        back_populates="successor_links",
        foreign_keys=[source_activity_id],
    )
    # The target activity is the successor in the directed connection.
    target: Mapped["Activity"] = relationship(
        back_populates="predecessor_links",
        foreign_keys=[target_activity_id],
    )
