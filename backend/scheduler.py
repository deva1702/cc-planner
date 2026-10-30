"""Scheduling calculations for the Critical Chain Planning Tool.

Independent of FastAPI, SQLAlchemy, and the frontend.

TERMINOLOGY:
  planned   Baseline dates from durations and dependencies; never move.
  actual    A date entered when an activity is complete (actual_finish).
  forecast  Dates recalculated using actual finishes and planned durations.
  chain     The baseline critical chain without its buffer.
  buffer    The baseline project buffer on its own.
  buffered  The baseline critical chain plus its buffer.

The buffer applies to the baseline only, never to the forecast.
Sunday and configured holidays are non-working days.
A task of N days finishes on the Nth working day, counting its start day.
Variance: negative = early, zero = on time, positive = late (working days).

DATE RULES
  project_start     The date the planner entered. It may be a Sunday or holiday.
  schedule_start    The first working day on or after project_start. The first
                    activities start here, and all day counts begin here.
  actual_finish     A recorded fact, so it MAY fall on a Sunday or holiday. The
                    next activity then starts on the next working day.
  Supported dates   1900-01-01 to 9000-01-01. Input dates AND every calculated
                    date (activity, forecast, chain and buffer finishes) must fall
                    inside it; otherwise a ValueError is raised.
"""
from __future__ import annotations

import math
from bisect import bisect_left
from collections import deque
from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any

Activity = dict[str, Any]

# Input limits protect the engine from accidental or hostile requests.
# The API layer should enforce matching request-body and schema limits.
MAX_ACTIVITIES = 1_000
MAX_DEPENDENCIES = 5_000
MAX_HOLIDAYS = 10_000
MAX_ID_LENGTH = 100
MAX_NAME_LENGTH = 200
MAX_SHOP_LENGTH = 100
MAX_DURATION_DAYS = 5_000
MAX_CHAIN_DAYS = 20_000
MAX_CALENDAR_SPAN_DAYS = 100_000
# Working days never outnumber calendar days, so the calendar span bounds any
# working-day offset. The calendar span binds first (about 85,700 working days);
# this constant is the hard ceiling. The largest legal plan, a 20,000-day chain
# plus a 100% buffer, needs an offset of about 40,000.
MAX_WORKING_OFFSET = MAX_CALENDAR_SPAN_DAYS
MIN_SUPPORTED_DATE = date(1900, 1, 1)
MAX_SUPPORTED_DATE = date(9000, 1, 1)
assert 2 * MAX_CHAIN_DAYS <= MAX_WORKING_OFFSET


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------
def _to_date(value: Any, label: str) -> date:
    """Accept date objects or strict YYYY-MM-DD strings within the supported range."""
    if isinstance(value, datetime):
        raise ValueError(f"{label} must be a date, not a datetime.")
    if isinstance(value, date):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"{label} must use the YYYY-MM-DD date format.") from exc
        # fromisoformat accepts other ISO forms (20261224, week dates); the API
        # contract intentionally accepts only the unambiguous YYYY-MM-DD form.
        if parsed.isoformat() != value:
            raise ValueError(f"{label} must use the YYYY-MM-DD date format.")
    else:
        raise ValueError(f"{label} must be a date or YYYY-MM-DD string.")

    # Keeps every later "+ 1 day" safely away from date.max.
    if not MIN_SUPPORTED_DATE <= parsed <= MAX_SUPPORTED_DATE:
        raise ValueError(
            f"{label} must be between {MIN_SUPPORTED_DATE.isoformat()} and "
            f"{MAX_SUPPORTED_DATE.isoformat()}."
        )
    return parsed


def _normalize_holidays(holidays: Any) -> frozenset[date]:
    """Validate a bounded iterable of dates or ISO date strings."""
    if holidays is None:
        return frozenset()
    if isinstance(holidays, (str, bytes)) or not isinstance(holidays, Iterable):
        raise ValueError("Holidays must be a collection of dates.")

    normalized: set[date] = set()
    for holiday in holidays:
        normalized.add(_to_date(holiday, "Holiday"))
        if len(normalized) > MAX_HOLIDAYS:
            raise ValueError(f"At most {MAX_HOLIDAYS} holidays are allowed.")
    return frozenset(normalized)


def _check_duration(value: Any, label: str = "Duration") -> int:
    """Require a positive, bounded integer; booleans are not durations."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} must be an integer.")
    if value < 1:
        raise ValueError(f"{label} must be at least one working day.")
    if value > MAX_DURATION_DAYS:
        raise ValueError(
            f"{label} cannot exceed {MAX_DURATION_DAYS} working days."
        )
    return value


def _check_percent(value: Any) -> float:
    """Validate the buffer percentage and reject NaN and infinity."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Buffer percentage must be numeric.")
    if not math.isfinite(value):
        raise ValueError("Buffer percentage must be a finite number.")
    if not 0 <= value <= 100:
        raise ValueError("Buffer percentage must be between 0 and 100.")
    return float(value)


def _optional_text(
    activity: Activity, key: str, activity_id: str, max_length: int
) -> str | None:
    """Validate optional text fields and constrain their stored length."""
    value = activity.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{key.capitalize()} for {activity_id} must be text.")
    value = value.strip()
    if len(value) > max_length:
        raise ValueError(
            f"{key.capitalize()} for {activity_id} cannot exceed "
            f"{max_length} characters."
        )
    return value or None


# ---------------------------------------------------------------------------
# Working-day calendar
# ---------------------------------------------------------------------------
class WorkCalendar:
    """Convert dates to working-day offsets without storing every date.

    Date-to-offset conversion counts weekdays arithmetically. Offset-to-date
    conversion uses binary search, so far-future dates do not allocate a
    potentially huge list of individual working dates.
    """

    def __init__(self, anchor: date, holidays: Any = None) -> None:
        self.anchor = _to_date(anchor, "Calendar anchor")
        self._holidays = _normalize_holidays(holidays)
        # Only non-Sunday holidays on or after the anchor remove a working day.
        # Sorted once so each count is a binary search, not a scan of all holidays.
        self._effective_holidays = sorted(
            h for h in self._holidays
            if h >= self.anchor and h.weekday() != 6
        )

    @staticmethod
    def _ordinary_workdays_before(start: date, end: date) -> int:
        """Count non-Sunday dates in [start, end), ignoring custom holidays."""
        if end <= start:
            return 0
        days = (end - start).days
        full_weeks, remainder = divmod(days, 7)
        count = full_weeks * 6
        # At most six iterations regardless of the range length.
        for offset in range(remainder):
            if (start + timedelta(days=full_weeks * 7 + offset)).weekday() != 6:
                count += 1
        return count

    def _workdays_before(self, day: date) -> int:
        """Count working dates in [anchor, day), returning zero before anchor."""
        if day <= self.anchor:
            return 0
        count = self._ordinary_workdays_before(self.anchor, day)
        # A non-Sunday holiday removes one otherwise-working date.
        return count - bisect_left(self._effective_holidays, day)

    def _check_span(self, day: date) -> None:
        """Bound calendar queries to prevent pathological date ranges."""
        if abs((day - self.anchor).days) > MAX_CALENDAR_SPAN_DAYS:
            raise ValueError(
                f"Calendar dates must be within {MAX_CALENDAR_SPAN_DAYS} "
                "calendar days of the project start."
            )

    def index(self, day: date) -> int:
        """Index of the first working day on or after day."""
        self._check_span(day)
        # The number of working dates before day is its zero-based index if
        # day is working, and the index of the next working date otherwise.
        return self._workdays_before(day)

    def date_at(self, index: int) -> date:
        """Return the working date at a zero-based offset from the anchor."""
        if isinstance(index, bool) or not isinstance(index, int) or index < 0:
            raise ValueError("Working-day index must be a nonnegative integer.")
        if index > MAX_WORKING_OFFSET:
            raise ValueError("Working-day offset exceeds the supported limit.")

        anchor_ordinal = self.anchor.toordinal()
        # Stop one day short of date.max so rank_through's "+ 1 day" cannot overflow.
        max_ordinal = min(
            date.max.toordinal() - 1,
            anchor_ordinal + MAX_CALENDAR_SPAN_DAYS,
        )

        def rank_through(ordinal: int) -> int:
            # Count working dates from anchor through the candidate date.
            candidate = date.fromordinal(ordinal)
            return self._workdays_before(candidate + timedelta(days=1))

        low = anchor_ordinal
        high = min(max_ordinal, anchor_ordinal + max(14, index * 2 + 14))
        while rank_through(high) <= index:
            if high >= max_ordinal:
                raise ValueError("Requested working-day offset exceeds calendar limit.")
            high = min(max_ordinal, anchor_ordinal + (high - anchor_ordinal) * 2)

        # Find the first date whose inclusive rank is greater than index.
        while low < high:
            middle = (low + high) // 2
            if rank_through(middle) > index:
                high = middle
            else:
                low = middle + 1

        result = date.fromordinal(low)
        self._check_span(result)
        if result > MAX_SUPPORTED_DATE:
            raise ValueError(
                "The schedule runs past the latest supported date "
                f"({MAX_SUPPORTED_DATE.isoformat()}). Shorten the plan or the buffer."
            )
        if result.weekday() == 6 or result in self._holidays:
            raise RuntimeError("Internal calendar index error.")
        return result

    def on_or_after(self, day: date) -> date:
        """Return the first working day on or after day."""
        return self.date_at(self.index(day))

    def after(self, day: date) -> date:
        """Return the first working day strictly after day."""
        return self.on_or_after(day + timedelta(days=1))

    def add_days(self, start: date, duration: int) -> date:
        """Finish date for a duration counted inclusively from start."""
        _check_duration(duration)
        return self.date_at(self.index(start) + duration - 1)

    def count_inclusive(self, start: date, finish: date) -> int:
        """Count working dates in [start, finish], including both endpoints."""
        if finish < start:
            return 0
        return self.index(finish + timedelta(days=1)) - self.index(start)

    def variance(self, finish: date, delivery: date) -> int:
        """Return signed working-day variance: early negative, late positive."""
        if finish == delivery:
            return 0
        if finish < delivery:
            return -self.count_inclusive(finish + timedelta(days=1), delivery)
        return self.count_inclusive(delivery + timedelta(days=1), finish)


# ---------------------------------------------------------------------------
# Public helper functions
# ---------------------------------------------------------------------------
def round_buffer_days(chain_days: int, buffer_percent: float) -> int:
    """Round nonnegative buffer days using round-half-up."""
    if isinstance(chain_days, bool) or not isinstance(chain_days, int):
        raise ValueError("Chain duration must be an integer.")
    if chain_days < 1:
        raise ValueError("Chain duration must be positive.")
    return int(chain_days * _check_percent(buffer_percent) / 100 + 0.5)


def add_working_days(
    start_date: date, duration: int, holidays: Any = None
) -> date:
    """Add an inclusive working-day duration."""
    start = _to_date(start_date, "Start date")
    return WorkCalendar(start, holidays).add_days(start, duration)


def working_days_inclusive(
    start_date: date, finish_date: date, holidays: Any = None
) -> int:
    """Count working days in an inclusive date range."""
    start = _to_date(start_date, "Start date")
    finish = _to_date(finish_date, "Finish date")
    return WorkCalendar(start, holidays).count_inclusive(start, finish)


def calendar_days_inclusive(start_date: date, finish_date: date) -> int:
    """Count calendar dates including both endpoints."""
    start = _to_date(start_date, "Start date")
    finish = _to_date(finish_date, "Finish date")
    return 0 if finish < start else (finish - start).days + 1


def signed_working_day_variance(
    finish_date: date, delivery_date: date, holidays: Any = None
) -> int:
    """Calculate signed delivery variance in working days."""
    finish = _to_date(finish_date, "Finish date")
    delivery = _to_date(delivery_date, "Delivery date")
    return WorkCalendar(min(finish, delivery), holidays).variance(finish, delivery)


# ---------------------------------------------------------------------------
# Input normalization and dependency graph
# ---------------------------------------------------------------------------
def _normalize_activities(activities: list[Activity]) -> dict[str, Activity]:
    """Validate activities and retain only supported fields."""
    if not isinstance(activities, list) or not activities:
        raise ValueError("Add at least one activity.")
    if len(activities) > MAX_ACTIVITIES:
        raise ValueError(f"At most {MAX_ACTIVITIES} activities are allowed.")

    normalized: dict[str, Activity] = {}
    dependency_count = 0

    for activity in activities:
        if not isinstance(activity, dict):
            raise ValueError("Each activity must be an object.")

        raw_id = activity.get("id")
        if not isinstance(raw_id, str) or not raw_id.strip():
            raise ValueError("Every activity needs a non-empty string ID.")
        activity_id = raw_id.strip()
        if len(activity_id) > MAX_ID_LENGTH:
            raise ValueError(f"Activity IDs cannot exceed {MAX_ID_LENGTH} characters.")
        if activity_id in normalized:
            raise ValueError(f"Duplicate activity ID: {activity_id}")

        predecessors = activity.get("predecessors", [])
        if not isinstance(predecessors, list):
            raise ValueError(f"Predecessors for {activity_id} must be a list.")
        if any(not isinstance(p, str) or not p.strip() for p in predecessors):
            raise ValueError(
                f"Predecessor IDs for {activity_id} must be non-empty strings."
            )
        dependency_count += len(predecessors)
        if dependency_count > MAX_DEPENDENCIES:
            raise ValueError(
                f"At most {MAX_DEPENDENCIES} dependencies are allowed."
            )

        actual = activity.get("actual_finish")
        normalized[activity_id] = {
            "id": activity_id,
            "name": _optional_text(activity, "name", activity_id, MAX_NAME_LENGTH),
            "shop": _optional_text(activity, "shop", activity_id, MAX_SHOP_LENGTH),
            "duration": _check_duration(
                activity.get("duration"), f"Duration for {activity_id}"
            ),
            "predecessors": [p.strip() for p in predecessors],
            "actual_finish": (
                None if actual is None
                else _to_date(actual, f"Actual finish for {activity_id}")
            ),
        }
    return normalized


def _topological_order(
    by_id: dict[str, Activity],
) -> tuple[list[str], dict[str, list[str]]]:
    """Validate dependencies and return a topological order."""
    successors: dict[str, list[str]] = {activity_id: [] for activity_id in by_id}
    indegree = {activity_id: 0 for activity_id in by_id}

    for activity_id, activity in by_id.items():
        predecessors = activity["predecessors"]
        if len(predecessors) != len(set(predecessors)):
            raise ValueError(f"Activity {activity_id} has duplicate predecessors.")
        for predecessor in predecessors:
            if predecessor not in by_id:
                raise ValueError(
                    f"Unknown predecessor {predecessor} for {activity_id}."
                )
            if predecessor == activity_id:
                raise ValueError(f"Activity {activity_id} cannot depend on itself.")
            successors[predecessor].append(activity_id)
            indegree[activity_id] += 1

    queue = deque(
        activity_id for activity_id, degree in indegree.items() if degree == 0
    )
    order: list[str] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for successor in successors[node]:
            indegree[successor] -= 1
            if indegree[successor] == 0:
                queue.append(successor)

    if len(order) != len(by_id):
        stuck = sorted(
            activity_id for activity_id, degree in indegree.items() if degree > 0
        )
        raise ValueError("Dependency cycle detected involving: " + ", ".join(stuck))
    return order, successors


# ---------------------------------------------------------------------------
# Main scheduling entry point
# ---------------------------------------------------------------------------
def calculate_schedule(
    activities: list[Activity],
    project_start: date,
    delivery_date: date,
    buffer_percent: float = 25.0,
    holidays: Any = None,
) -> dict[str, Any]:
    """Calculate baseline dates, forecast dates, critical edges, and buffer.

    Each activity requires id and duration. Predecessors, name, shop, and
    actual_finish are optional. Entering actual_finish marks it complete.

    Baseline dates and float never change when actual dates are entered. An
    actual finish earlier than the earliest possible forecast start is rejected.
    The project buffer applies to the baseline only.
    """
    start = _to_date(project_start, "Project start")
    delivery = _to_date(delivery_date, "Delivery date")
    if delivery < start:
        raise ValueError("Delivery date cannot precede project start.")
    percent = _check_percent(buffer_percent)
    normalized_holidays = _normalize_holidays(holidays)

    calendar = WorkCalendar(start, normalized_holidays)
    by_id = _normalize_activities(activities)
    order, successors = _topological_order(by_id)

    # ---- forward pass: offsets are zero-based working days ------------------
    early_start: dict[str, int] = {}
    early_finish: dict[str, int] = {}
    for node in order:
        activity = by_id[node]
        early_start[node] = max(
            (early_finish[p] + 1 for p in activity["predecessors"]),
            default=0,
        )
        early_finish[node] = early_start[node] + activity["duration"] - 1

    chain_days = max(early_finish.values()) + 1
    if chain_days > MAX_CHAIN_DAYS:
        raise ValueError(
            f"The critical chain cannot exceed {MAX_CHAIN_DAYS} working days."
        )

    # ---- backward pass: latest starts and total float ------------------------
    late_start: dict[str, int] = {}
    for node in reversed(order):
        late_finish = (
            min(late_start[successor] - 1 for successor in successors[node])
            if successors[node]
            else chain_days - 1
        )
        late_start[node] = late_finish - by_id[node]["duration"] + 1

    critical = {node for node in order if early_start[node] == late_start[node]}
    critical_edges = [
        {"source": predecessor, "target": successor}
        for predecessor in order
        for successor in successors[predecessor]
        if (
            predecessor in critical
            and successor in critical
            and early_finish[predecessor] + 1 == early_start[successor]
        )
    ]

    # ---- forecast: actual finishes override; unfinished tasks follow ---------
    forecast: dict[str, tuple[date, date]] = {}
    for node in order:
        activity = by_id[node]
        predecessors = activity["predecessors"]
        forecast_start = (
            calendar.after(max(forecast[p][1] for p in predecessors))
            if predecessors
            else calendar.date_at(0)
        )

        actual_finish = activity["actual_finish"]
        if actual_finish is None:
            forecast_finish = calendar.add_days(forecast_start, activity["duration"])
        else:
            if actual_finish < forecast_start:
                raise ValueError(
                    f"Actual finish {actual_finish.isoformat()} for {node} is "
                    f"earlier than {forecast_start.isoformat()}, the first day "
                    "it could start after its predecessors' finish dates."
                )
            forecast_finish = actual_finish
        forecast[node] = (forecast_start, forecast_finish)

    # Build an explicit response; do not return arbitrary input fields.
    results = []
    for node in order:
        activity = by_id[node]
        forecast_start, forecast_finish = forecast[node]
        actual_finish = activity["actual_finish"]
        results.append({
            "id": node,
            "name": activity["name"],
            "shop": activity["shop"],
            "duration": activity["duration"],
            "predecessors": list(activity["predecessors"]),
            "actual_finish": actual_finish.isoformat() if actual_finish else None,
            "is_complete": actual_finish is not None,
            "planned_start": calendar.date_at(early_start[node]).isoformat(),
            "planned_finish": calendar.date_at(early_finish[node]).isoformat(),
            "early_start_offset": early_start[node],
            "early_finish_offset": early_finish[node],
            "float_days": late_start[node] - early_start[node],
            "is_critical": node in critical,
            "forecast_start": forecast_start.isoformat(),
            "forecast_finish": forecast_finish.isoformat(),
        })

    # ---- chain alone (baseline) ----------------------------------------------
    chain_start = calendar.date_at(0)
    chain_finish = calendar.date_at(chain_days - 1)

    # ---- buffer alone (baseline) ---------------------------------------------
    buffer_days = round_buffer_days(chain_days, percent)
    if buffer_days:
        buffer_start: date | None = calendar.date_at(chain_days)
        buffered_finish = calendar.date_at(chain_days + buffer_days - 1)
    else:
        # A zero-day buffer has no separate date range.
        buffer_start = None
        buffered_finish = chain_finish

    forecast_finish = max(finish for _, finish in forecast.values())

    return {
        "project_start": start.isoformat(),
        # First working day on or after project_start (they differ if the start
        # date is a Sunday or holiday). The UI should show this when they differ.
        "schedule_start": chain_start.isoformat(),
        "delivery_date": delivery.isoformat(),
        "available_working_days": calendar.count_inclusive(start, delivery),
        # Critical chain (baseline, without the buffer).
        "chain_days": chain_days,
        "chain_calendar_days": calendar_days_inclusive(chain_start, chain_finish),
        "chain_finish": chain_finish.isoformat(),
        "actual_chain_delivery_variance_working_days":
            calendar.variance(chain_finish, delivery),
        # Project buffer (baseline, shown separately from the chain).
        "buffer_percent": percent,
        "buffer_days": buffer_days,
        "buffer_calendar_days": (
            calendar_days_inclusive(buffer_start, buffered_finish)
            if buffer_start is not None else 0
        ),
        "buffer_start": buffer_start.isoformat() if buffer_start else None,
        "buffer_finish": buffered_finish.isoformat() if buffer_start else None,
        # Critical chain plus buffer.
        "total_buffered_days": chain_days + buffer_days,
        "total_buffered_calendar_days":
            calendar_days_inclusive(chain_start, buffered_finish),
        "buffered_finish": buffered_finish.isoformat(),
        "buffered_delivery_variance_working_days":
            calendar.variance(buffered_finish, delivery),
        # Forecast uses actual progress; the baseline remains unchanged.
        "forecast_finish": forecast_finish.isoformat(),
        "forecast_delivery_variance_working_days":
            calendar.variance(forecast_finish, delivery),
        # IDs and edges let the React Flow canvas highlight critical elements.
        "critical_activities": [node for node in order if node in critical],
        "critical_edges": critical_edges,
        "activities": results,
    }