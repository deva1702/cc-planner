"""Explicit response shapes for the scheduling API.

Three layers of protection:
  1. extra="forbid"      -> a field that is not declared here is rejected.
  2. numeric constraints -> every number has a minimum and maximum, taken from the
                            scheduler's own limits so there is one source of truth.
  3. cross-field checks  -> related fields must agree with each other (a response
                            that contradicts itself fails validation).
Dates are ISO strings (YYYY-MM-DD) in JSON; a missing actual finish or buffer date
is null. Request models are added in the API layer.
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator

from scheduler import (
    MAX_ACTIVITIES,
    MAX_CHAIN_DAYS,
    MAX_DEPENDENCIES,
    MAX_DURATION_DAYS,
    MAX_ID_LENGTH,
    MAX_NAME_LENGTH,
    MAX_SHOP_LENGTH,
)

MAX_VARIANCE = 100_000          # working days early / late


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ActivityResult(_Strict):
    id: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    name: str | None = Field(None, max_length=MAX_NAME_LENGTH)
    shop: str | None = Field(None, max_length=MAX_SHOP_LENGTH)
    duration: int = Field(ge=1, le=MAX_DURATION_DAYS, description="Working days.")
    predecessors: list[str] = Field(max_length=MAX_ACTIVITIES)
    actual_finish: date | None = Field(
        None, description="ACTUAL: entered by the planner when the activity is done. "
                          "May fall on a Sunday or holiday.")
    is_complete: bool
    planned_start: date = Field(description="PLANNED (baseline): never moves.")
    planned_finish: date = Field(description="PLANNED (baseline): never moves.")
    early_start_offset: int = Field(ge=0, le=MAX_CHAIN_DAYS)
    early_finish_offset: int = Field(ge=0, le=MAX_CHAIN_DAYS)
    float_days: int = Field(ge=0, le=MAX_CHAIN_DAYS,
                            description="Working days of slack; 0 = critical.")
    is_critical: bool
    forecast_start: date = Field(description="FORECAST: uses actual finishes of predecessors.")
    forecast_finish: date = Field(description="FORECAST: the actual finish if entered.")

    @model_validator(mode="after")
    def _consistent(self) -> "ActivityResult":
        if self.is_complete != (self.actual_finish is not None):
            raise ValueError("is_complete must be true exactly when actual_finish is set.")
        if self.planned_start > self.planned_finish:
            raise ValueError("planned_start cannot be after planned_finish.")
        if self.forecast_start > self.forecast_finish:
            raise ValueError("forecast_start cannot be after forecast_finish.")
        if self.early_finish_offset - self.early_start_offset + 1 != self.duration:
            raise ValueError("Offsets must span exactly the activity duration.")
        if self.is_critical != (self.float_days == 0):
            raise ValueError("An activity is critical exactly when its float is 0.")
        return self


class CriticalEdge(_Strict):
    source: str = Field(min_length=1, max_length=MAX_ID_LENGTH)
    target: str = Field(min_length=1, max_length=MAX_ID_LENGTH)


class ScheduleResponse(_Strict):
    project_start: date = Field(description="The date entered; may be a Sunday or holiday.")
    schedule_start: date = Field(
        description="First working day on or after project_start; day counts begin here. "
                    "The UI should show both when they differ.")
    delivery_date: date
    available_working_days: int = Field(ge=0)

    # Chain = ACTUAL TIME, baseline
    chain_days: int = Field(ge=1, le=MAX_CHAIN_DAYS)
    chain_calendar_days: int = Field(ge=1)
    chain_finish: date
    actual_chain_delivery_variance_working_days: int = Field(
        ge=-MAX_VARIANCE, le=MAX_VARIANCE, description="Negative = early, positive = late.")

    # Buffer, baseline. With a zero-day buffer there are no buffer dates.
    buffer_percent: float = Field(ge=0, le=100)
    buffer_days: int = Field(ge=0, le=MAX_CHAIN_DAYS)
    buffer_calendar_days: int = Field(ge=0)
    buffer_start: date | None = Field(
        None, description="None when buffer_days is 0 (a zero buffer has no dates).")
    buffer_finish: date | None = Field(
        None, description="None when buffer_days is 0 (a zero buffer has no dates).")

    # Chain + buffer, baseline
    total_buffered_days: int = Field(ge=1, le=2 * MAX_CHAIN_DAYS)
    total_buffered_calendar_days: int = Field(ge=1)
    buffered_finish: date = Field(description="Equals chain_finish when buffer_days is 0.")
    buffered_delivery_variance_working_days: int = Field(
        ge=-MAX_VARIANCE, le=MAX_VARIANCE, description="Negative = early, positive = late.")

    # Forecast from actual progress. The buffer is never added to the forecast.
    forecast_finish: date
    forecast_delivery_variance_working_days: int = Field(
        ge=-MAX_VARIANCE, le=MAX_VARIANCE, description="Negative = early, positive = late.")

    critical_activities: list[str] = Field(max_length=MAX_ACTIVITIES)
    critical_edges: list[CriticalEdge] = Field(max_length=MAX_DEPENDENCIES)
    activities: list[ActivityResult] = Field(min_length=1, max_length=MAX_ACTIVITIES)

    @model_validator(mode="after")
    def _consistent(self) -> "ScheduleResponse":
        # ---- date order ------------------------------------------------------
        if not (self.project_start <= self.schedule_start <= self.chain_finish
                <= self.buffered_finish):
            raise ValueError("Dates must run project_start <= schedule_start <= "
                             "chain_finish <= buffered_finish.")
        if self.delivery_date < self.project_start:
            raise ValueError("delivery_date cannot precede project_start.")

        # ---- chain + buffer = total -----------------------------------------
        if self.total_buffered_days != self.chain_days + self.buffer_days:
            raise ValueError("total_buffered_days must equal chain_days + buffer_days.")
        if self.total_buffered_calendar_days < self.chain_calendar_days:
            raise ValueError("total_buffered_calendar_days cannot be below chain_calendar_days.")

        # ---- zero buffer vs real buffer ---------------------------------------
        if self.buffer_days == 0:
            if self.buffer_start is not None or self.buffer_finish is not None:
                raise ValueError("A zero-day buffer must have null buffer_start and buffer_finish.")
            if self.buffer_calendar_days != 0:
                raise ValueError("A zero-day buffer must have 0 buffer_calendar_days.")
            if self.buffered_finish != self.chain_finish:
                raise ValueError("With a zero-day buffer, buffered_finish must equal chain_finish.")
        else:
            if self.buffer_start is None or self.buffer_finish is None:
                raise ValueError("A buffer of 1 or more days needs buffer_start and buffer_finish.")
            if self.buffer_finish != self.buffered_finish:
                raise ValueError("buffer_finish must equal buffered_finish.")
            if self.buffer_start <= self.chain_finish:
                raise ValueError("The buffer must start after the critical chain finishes.")

        # ---- activities and critical lists agree ------------------------------
        ids = [a.id for a in self.activities]
        if len(set(ids)) != len(ids):
            raise ValueError("Activity ids must be unique.")
        known = set(ids)
        if any(p not in known for a in self.activities for p in a.predecessors):
            raise ValueError("A predecessor refers to an unknown activity.")
        critical = {a.id for a in self.activities if a.is_critical}
        if set(self.critical_activities) != critical or \
                len(self.critical_activities) != len(critical):
            raise ValueError("critical_activities must list exactly the critical activities.")
        for edge in self.critical_edges:
            if edge.source not in critical or edge.target not in critical:
                raise ValueError("Critical edges must join two critical activities.")
        if self.chain_finish != max(a.planned_finish for a in self.activities):
            raise ValueError("chain_finish must equal the latest planned finish.")
        if self.forecast_finish != max(a.forecast_finish for a in self.activities):
            raise ValueError("forecast_finish must equal the latest activity forecast finish.")
        return self