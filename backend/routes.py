
"""API routes for scheduling and project persistence."""

import json
import logging
from collections import deque
from datetime import date, datetime
from typing import Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Activity, Dependency, Project
from scheduler import (
    MAX_ACTIVITIES,
    MAX_DEPENDENCIES,
    MAX_DURATION_DAYS,
    MAX_HOLIDAYS,
    MAX_ID_LENGTH,
    MAX_NAME_LENGTH,
    MAX_SHOP_LENGTH,
    MAX_SUPPORTED_DATE,
    MIN_SUPPORTED_DATE,
    calculate_schedule,
)
from schemas import ScheduleResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["Scheduling and Projects"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ActivityInput(BaseModel):
    """Activity data accepted by the scheduling endpoint."""

    # Reject unexpected fields instead of silently accepting extra input.
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    name: str | None = Field(default=None, max_length=MAX_NAME_LENGTH)
    shop: str | None = Field(default=None, max_length=MAX_SHOP_LENGTH)
    duration: int = Field(ge=1, le=MAX_DURATION_DAYS, strict=True)
    predecessors: list[str] = Field(default_factory=list)
    actual_finish: date | None = None

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        # Normalize whitespace before checking that the ID is not blank.
        value = value.strip()
        if not value:
            raise ValueError("Activity ID cannot be blank.")
        return value

    @field_validator("name", "shop")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("predecessors")
    @classmethod
    def validate_predecessors(cls, value: list[str]) -> list[str]:
        # Normalize predecessor IDs so whitespace does not affect matching.
        result = []
        for predecessor in value:
            if not predecessor.strip():
                raise ValueError("Predecessor IDs cannot be blank.")
            result.append(predecessor.strip())
        return result

    @field_validator("actual_finish")
    @classmethod
    def validate_actual_finish(cls, value: date | None) -> date | None:
        if value is not None:
            _validate_supported_date(value, "Actual finish")
        return value


class ScheduleRequest(BaseModel):
    """Input for calculating a schedule without saving a project."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    activities: list[ActivityInput] = Field(
        min_length=1, max_length=MAX_ACTIVITIES
    )
    project_start: date
    delivery_date: date
    buffer_percent: float = Field(ge=0, le=100)
    holidays: list[date] = Field(default_factory=list, max_length=MAX_HOLIDAYS)

    # Run cross-field and activity-network checks after individual fields validate.
    @model_validator(mode="after")
    def validate_schedule(self):
        _validate_project_dates(self.project_start, self.delivery_date)
        _validate_holidays(self.holidays)
        _validate_activity_network(self.activities)
        return self


class ProjectActivityInput(ActivityInput):
    """Activity input including its saved canvas position and node type."""

    position_x: float = Field(default=0, ge=-1_000_000, le=1_000_000)
    position_y: float = Field(default=0, ge=-1_000_000, le=1_000_000)
    node_type: Literal["activity", "buffer"] = "activity"


class ImportMetadataInput(BaseModel):
    """Metadata describing the source of an imported workflow."""

    model_config = ConfigDict(extra="forbid")

    source_filename: str = Field(min_length=1, max_length=255)
    file_type: Literal["xlsx", "csv"]
    imported_at: datetime
    activity_count: int = Field(ge=1, le=MAX_ACTIVITIES, strict=True)
    import_status: Literal["success"] = "success"

    @field_validator("source_filename")
    @classmethod
    def validate_source_filename(cls, value: str) -> str:
        value = value.strip()
        if not value or value in {".", ".."}:
            raise ValueError("Source filename is invalid.")
        # Accept only a filename, not a path supplied by the client.
        if "/" in value or "\\" in value:
            raise ValueError("Source filename must not contain a path.")
        return value


class ProjectInput(BaseModel):
    """Complete project settings, activity network, and optional import metadata."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=200)
    project_start: date
    delivery_date: date
    buffer_percent: float = Field(default=25, ge=0, le=100)
    holidays: list[date] = Field(default_factory=list, max_length=MAX_HOLIDAYS)
    activities: list[ProjectActivityInput] = Field(
        default_factory=list, max_length=MAX_ACTIVITIES
    )
    import_metadata: ImportMetadataInput | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Project name cannot be blank.")
        return value

    @model_validator(mode="after")
    def validate_project(self):
        _validate_project_dates(self.project_start, self.delivery_date)
        _validate_holidays(self.holidays)
        _validate_activity_network(self.activities)


        return self


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_supported_date(value: date, label: str) -> None:
    if not MIN_SUPPORTED_DATE <= value <= MAX_SUPPORTED_DATE:
        raise ValueError(
            f"{label} must be between {MIN_SUPPORTED_DATE.isoformat()} "
            f"and {MAX_SUPPORTED_DATE.isoformat()}."
        )


def _validate_project_dates(start: date, delivery: date) -> None:
    _validate_supported_date(start, "Project start")
    _validate_supported_date(delivery, "Delivery date")

    if delivery < start:
        raise ValueError("Delivery date cannot precede project start.")


def _validate_holidays(holidays: list[date]) -> None:
    # Duplicate dates could otherwise be counted more than once.
    if len(holidays) != len(set(holidays)):
        raise ValueError("Duplicate holidays are not allowed.")

    for holiday in holidays:
        _validate_supported_date(holiday, "Holiday")


def _validate_activity_network(activities) -> None:
    """Reject duplicate IDs, invalid dependencies, and dependency cycles."""
    ids = [activity.id for activity in activities]

    if len(ids) != len(set(ids)):
        raise ValueError("Activity IDs must be unique within a project.")

    # Build an adjacency list and indegree count for the dependency graph.
    known_ids = set(ids)
    successors = {activity_id: [] for activity_id in ids}
    indegree = {activity_id: 0 for activity_id in ids}
    dependency_count = 0

    for activity in activities:
        predecessors = activity.predecessors

        if len(predecessors) != len(set(predecessors)):
            raise ValueError(
                f"Activity {activity.id} has duplicate predecessors."
            )

        for predecessor in predecessors:
            dependency_count += 1

            if dependency_count > MAX_DEPENDENCIES:
                raise ValueError(
                    f"At most {MAX_DEPENDENCIES} dependencies are allowed."
                )

            if predecessor not in known_ids:
                raise ValueError(
                    f"Unknown predecessor {predecessor} "
                    f"for activity {activity.id}."
                )

            if predecessor == activity.id:
                raise ValueError(
                    f"Activity {activity.id} cannot depend on itself."
                )

            successors[predecessor].append(activity.id)
            indegree[activity.id] += 1

    # Kahn's algorithm detects cycles in O(V + E) time.
    # Start with activities that have no predecessors.
    queue = deque(
        activity_id
        for activity_id, degree in indegree.items()
        if degree == 0
    )
    visited = 0

    while queue:
        current = queue.popleft()
        visited += 1

        # Remove the current activity's outgoing edges from the graph.
        for successor in successors[current]:
            indegree[successor] -= 1
            if indegree[successor] == 0:
                queue.append(successor)

    # If some activities remain unvisited, the graph contains a cycle.
    if visited != len(ids):
        raise ValueError("Dependency cycle detected.")


def _handle_database_error(exc: SQLAlchemyError) -> NoReturn:
    """Log database details internally and raise a safe API error."""
    # Keep internal database details in server logs, not in the API response.
    logger.exception("Database operation failed")
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="The database operation could not be completed.",
    ) from exc


# ---------------------------------------------------------------------------
# Scheduling endpoint
# ---------------------------------------------------------------------------

@router.post("/schedule", response_model=ScheduleResponse)
def calculate_schedule_endpoint(
    payload: ScheduleRequest,
) -> dict:
    """Calculate a schedule without persisting it."""
    try:
        # Convert validated activity models into dictionaries for the engine.
        return calculate_schedule(
            activities=[
                activity.model_dump()
                for activity in payload.activities
            ],
            project_start=payload.project_start,
            delivery_date=payload.delivery_date,
            buffer_percent=payload.buffer_percent,
            holidays=payload.holidays,
        )
    except ValueError as exc:
        # Return scheduling validation errors as HTTP 422 responses.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


# ---------------------------------------------------------------------------
# Project persistence helpers
# ---------------------------------------------------------------------------

def _load_project(db: Session, project_id: int) -> Project:
    """Load a project and refresh its activity dependency relationships."""

    # Eagerly load activities and their predecessor links to avoid
    # additional database queries while building the project response.
    statement = (
        select(Project)
        .where(Project.id == project_id)
        .options(
            selectinload(Project.activities).selectinload(
                Activity.predecessor_links
            )
        )
        .execution_options(populate_existing=True)
    )

    project = db.scalar(statement)

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found.",
        )

    return project


def _project_response(project: Project) -> dict:
    """Serialize a project without exposing database implementation details."""
    activities = list(project.activities)

    # Translate database activity IDs back to the activity codes
    # expected by the API and frontend.
    code_by_id = {
        activity.id: activity.activity_code
        for activity in activities
    }

    return {
        "id": project.id,
        "name": project.name,
        "project_start": project.project_start,
        "delivery_date": project.delivery_date,
        "buffer_percent": project.buffer_percent,
        "holidays": json.loads(project.holidays),
        "import_metadata": (
            json.loads(project.import_metadata)
            if project.import_metadata
            else None
        ),
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "activities": [
            {
                "id": activity.activity_code,
                "name": activity.name,
                "shop": activity.shop,
                "duration": activity.duration,
                "actual_finish": activity.actual_finish,
                # Convert predecessor database IDs into activity codes.
                "predecessors": sorted(
                    code_by_id[link.source_activity_id]
                    for link in activity.predecessor_links
                    if link.source_activity_id in code_by_id
                ),
                "position_x": activity.position_x,
                "position_y": activity.position_y,
                "node_type": activity.node_type,
            }
            for activity in activities
        ],
    }


def _replace_activities(
    db: Session,
    project: Project,
    activities: list[ProjectActivityInput],
) -> None:
    """Replace the activity network inside the current transaction."""
    # Remove the previous network before creating the replacement.
    project.activities.clear()
    db.flush()

    records = [
        Activity(
            project_id=project.id,
            activity_code=item.id,
            name=item.name,
            shop=item.shop,
            duration=item.duration,
            actual_finish=item.actual_finish,
            position_x=item.position_x,
            position_y=item.position_y,
            node_type=item.node_type,
        )
        for item in activities
    ]

    db.add_all(records)
    # Flush to generate database IDs before creating dependency records.
    db.flush()

    # Map activity codes to their newly generated database IDs.
    activity_by_code = {
        activity.activity_code: activity
        for activity in records
    }

    # Rebuild dependency edges using the new activity database IDs.
    dependencies = [
        Dependency(
            source_activity_id=activity_by_code[predecessor].id,
            target_activity_id=activity_by_code[item.id].id,
        )
        for item in activities
        for predecessor in item.predecessors
    ]

    db.add_all(dependencies)
    db.flush()


# ---------------------------------------------------------------------------
# Project CRUD endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/projects",
    status_code=status.HTTP_201_CREATED,
)
def create_project(
    payload: ProjectInput,
    db: Session = Depends(get_db),
) -> dict:
    """Create a project and persist its complete activity network."""
    project = Project(
        name=payload.name,
        project_start=payload.project_start,
        delivery_date=payload.delivery_date,
        buffer_percent=payload.buffer_percent,
        #store holiday dates as JSON-encoded ISO date strings.
        holidays=json.dumps(
            [day.isoformat() for day in payload.holidays]
        ),
        import_metadata=(
            payload.import_metadata.model_dump_json()
            if payload.import_metadata is not None
            else None
        ),
    )

    try:
        db.add(project)
        # Flush to obtain the generated project ID before saving activities.
        db.flush()

        _replace_activities(db, project, payload.activities)

        # Commit the project, activities and dependencies together.
        db.commit()

        # Reload after commit so the response contains persisted activities
        # and predecessor links rather than a stale relationship collection.
        saved_project = _load_project(db, project.id)
        return _project_response(saved_project)

    except SQLAlchemyError as exc:
        db.rollback()
        _handle_database_error(exc)
    except Exception:
        db.rollback()
        raise


@router.get("/projects")
def list_projects(
    db: Session = Depends(get_db),
) -> list[dict]:
    """List project summaries without loading every activity."""

    # Return lightweight project summaries rather than loading full networks.
    projects = db.scalars(
        select(Project).order_by(
            Project.updated_at.desc(),
            Project.id,
        )
    ).all()

    return [
        {
            "id": project.id,
            "name": project.name,
            "project_start": project.project_start,
            "delivery_date": project.delivery_date,
            "buffer_percent": project.buffer_percent,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }
        for project in projects
    ]


@router.get("/projects/{project_id}")
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
) -> dict:
    """Retrieve a saved project and its complete activity network."""
    return _project_response(_load_project(db, project_id))


@router.put("/projects/{project_id}")
def update_project(
    project_id: int,
    payload: ProjectInput,
    db: Session = Depends(get_db),
) -> dict:
    """Update project settings and replace its activity network atomically."""
    project = _load_project(db, project_id)

    try:
        project.name = payload.name
        project.project_start = payload.project_start
        project.delivery_date = payload.delivery_date
        project.buffer_percent = payload.buffer_percent
        project.holidays = json.dumps(
            [day.isoformat() for day in payload.holidays]
        )

        # Omitted metadata means an ordinary save: preserve the existing value.
        # Explicit null clears it; an object replaces it with the new import.
        if "import_metadata" in payload.model_fields_set:
            project.import_metadata = (
                payload.import_metadata.model_dump_json()
                if payload.import_metadata is not None
                else None
            )

        _replace_activities(db, project, payload.activities)
        db.commit()

        saved_project = _load_project(db, project_id)
        return _project_response(saved_project)

    except SQLAlchemyError as exc:
        db.rollback()
        _handle_database_error(exc)
    except Exception:
        db.rollback()
        raise


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Delete a project and its associated activity network."""
    project = db.get(Project, project_id)

    if project is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found.",
        )

    try:
        db.delete(project)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        _handle_database_error(exc)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
