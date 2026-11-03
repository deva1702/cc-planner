
"""Tests for scheduler.py. Run from the backend folder:  python -m pytest -q"""
import math
import time
from datetime import date, datetime, timedelta

import random

import pytest
from pydantic import ValidationError

from scheduler import (
    MAX_SUPPORTED_DATE,
    MAX_WORKING_OFFSET,
    WorkCalendar,
    add_working_days,
    calculate_schedule,
    round_buffer_days,
    signed_working_day_variance,
    working_days_inclusive,
)
from schemas import ScheduleResponse

START = date(2026, 11, 2)      # Monday
DELIVERY = date(2027, 1, 15)   # Friday

SAMPLE = {   # id: (name, shop, days, predecessors)
    "A": ("Material receipt - Bottom Dish End", "Purchase", 30, []),
    "B": ("Dish End petal welding", "TM5A", 10, ["A"]),
    "C": ("Material receipt - Shell", "Purchase", 25, []),
    "D": ("Shell welding", "TM4B", 12, ["C"]),
    "E": ("Shell + Dish End assembly", "TM5A", 8, ["B", "D"]),
    "F": ("Hydrotest", "TM5A", 5, ["E"]),
    "G": ("Painting", "Paint shop", 3, ["F"]),
    "H": ("Dispatch", "Stores", 1, ["G"]),
}


def sample(extra=None):
    extra = extra or {}
    return [
        {"id": k, "name": v[0], "shop": v[1], "duration": v[2],
         "predecessors": v[3], **extra.get(k, {})}
        for k, v in SAMPLE.items()
    ]


def run(acts=None, **kw):
    kw.setdefault("project_start", START)
    kw.setdefault("delivery_date", DELIVERY)
    return calculate_schedule(acts if acts is not None else sample(), **kw)


def by_id(result):
    return {a["id"]: a for a in result["activities"]}


# ---------------------------------------------------------------- sample plan
def test_sample_activity_dates():
    expected = {
        "A": ("2026-11-02", "2026-12-05"), "B": ("2026-12-07", "2026-12-17"),
        "C": ("2026-11-02", "2026-11-30"), "D": ("2026-12-01", "2026-12-14"),
        "E": ("2026-12-18", "2026-12-26"), "F": ("2026-12-28", "2027-01-01"),
        "G": ("2027-01-02", "2027-01-05"), "H": ("2027-01-06", "2027-01-06"),
    }
    acts = by_id(run())
    for key, (start, finish) in expected.items():
        assert (acts[key]["planned_start"], acts[key]["planned_finish"]) == (start, finish), key


def test_merge_waits_for_the_later_predecessor():
    acts = by_id(run())
    assert acts["B"]["planned_finish"] == "2026-12-17"   # later than D (14-Dec)
    assert acts["E"]["planned_start"] == "2026-12-18"    # day after B, not after D


def test_critical_chain_and_float():
    r = run()
    assert r["critical_activities"] == ["A", "B", "E", "F", "G", "H"]
    acts = by_id(r)
    assert acts["C"]["float_days"] == 3 and acts["D"]["float_days"] == 3
    assert not acts["C"]["is_critical"] and acts["E"]["is_critical"]
    assert {(e["source"], e["target"]) for e in r["critical_edges"]} == {
        ("A", "B"), ("B", "E"), ("E", "F"), ("F", "G"), ("G", "H")}


def test_actual_time_and_buffer_are_separate_answers():
    r = run()
    # answer 1: actual time (chain only)
    assert (r["chain_days"], r["chain_calendar_days"], r["chain_finish"]) == (57, 66, "2027-01-06")
    assert r["actual_chain_delivery_variance_working_days"] == -8      # 8 days early
    # answer 2: buffer on its own
    assert (r["buffer_days"], r["buffer_calendar_days"]) == (14, 16)
    assert (r["buffer_start"], r["buffer_finish"]) == ("2027-01-07", "2027-01-22")
    # third value: chain + buffer
    assert (r["total_buffered_days"], r["total_buffered_calendar_days"]) == (71, 82)
    assert r["buffered_finish"] == "2027-01-22"
    assert r["buffered_delivery_variance_working_days"] == 6           # 6 days late
    assert r["available_working_days"] == 65


def test_response_matches_schema():
    ScheduleResponse.model_validate(run())


# ------------------------------------------------------------ calendar rules
def test_sunday_is_skipped_and_sunday_start_moves_to_monday():
    assert add_working_days(date(2026, 11, 7), 2) == date(2026, 11, 9)   # Sat -> Mon
    r = run([{"id": "X", "duration": 5}], project_start=date(2026, 11, 1))
    assert r["activities"][0]["planned_start"] == "2026-11-02"


def test_holidays_shift_dates():
    hol = {date(2026, 12, 25), date(2027, 1, 1)}
    r = run(holidays=hol)
    assert r["chain_finish"] == "2027-01-08"
    assert r["buffer_finish"] == "2027-01-25"
    assert r["actual_chain_delivery_variance_working_days"] == -6
    assert r["buffered_delivery_variance_working_days"] == 8


def test_holidays_accept_iso_strings_and_frozenset():
    base = run(holidays={date(2026, 12, 25)})
    assert run(holidays=["2026-12-25"]) == base
    assert run(holidays=frozenset({date(2026, 12, 25)})) == base


def test_sunday_holiday_changes_nothing():
    assert run(holidays={date(2026, 12, 27)}) == run()   # 27-Dec-2026 is a Sunday


@pytest.mark.parametrize("bad", [
    "2026-12-25", b"2026-12-25", 5, [datetime(2026, 12, 25)], ["not-a-date"], [123], [None],
])
def test_invalid_holidays_rejected(bad):
    with pytest.raises(ValueError):
        run(holidays=bad)
    with pytest.raises(ValueError):
        WorkCalendar(START, bad)


def test_variance_helper():
    assert signed_working_day_variance(date(2027, 1, 6), DELIVERY) == -8
    assert signed_working_day_variance(date(2027, 1, 22), DELIVERY) == 6
    assert signed_working_day_variance(DELIVERY, DELIVERY) == 0
    assert working_days_inclusive(START, DELIVERY) == 65


# ----------------------------------------------------------------- the buffer
@pytest.mark.parametrize("days,pct,expected", [
    (57, 25, 14), (10, 25, 3), (50, 25, 13), (30, 25, 8), (4, 25, 1), (1, 25, 0), (57, 0, 0), (57, 100, 57),
])
def test_buffer_rounds_half_up(days, pct, expected):
    assert round_buffer_days(days, pct) == expected


def test_buffer_percent_is_configurable():
    r = run(buffer_percent=10)
    assert r["buffer_days"] == 6 and r["total_buffered_days"] == 63


def test_zero_buffer_has_no_dates():
    r = run(buffer_percent=0)
    assert r["buffer_days"] == 0 and r["buffer_calendar_days"] == 0
    assert r["buffer_start"] is None and r["buffer_finish"] is None
    assert r["buffered_finish"] == r["chain_finish"] == "2027-01-06"
    assert r["buffered_delivery_variance_working_days"] == r["actual_chain_delivery_variance_working_days"]
    ScheduleResponse.model_validate(r)


@pytest.mark.parametrize("bad", [
    math.nan, math.inf, -math.inf, -1, 100.01, 101, True, "25", None,
])
def test_invalid_buffer_percent_rejected(bad):
    with pytest.raises(ValueError):
        run(buffer_percent=bad)


# ------------------------------------------------- actual finish and forecast
def test_actual_finish_changes_forecast_only():
    r = run(sample({"B": {"actual_finish": "2026-12-24"}}))     # B finished a week late
    acts = by_id(r)
    assert acts["B"]["planned_finish"] == "2026-12-17"          # baseline unchanged
    assert acts["B"]["forecast_finish"] == "2026-12-24" and acts["B"]["is_complete"]
    assert acts["E"]["forecast_start"] == "2026-12-25"
    assert acts["H"]["planned_finish"] == "2027-01-06"
    assert acts["H"]["forecast_finish"] == "2027-01-13"
    assert r["chain_finish"] == "2027-01-06" and r["buffer_finish"] == "2027-01-22"
    assert r["forecast_finish"] == "2027-01-13"
    assert r["forecast_delivery_variance_working_days"] == -2   # still 2 days before delivery


def test_actual_finish_accepts_a_date_object():
    r = run(sample({"A": {"actual_finish": date(2026, 12, 5)}}))
    assert by_id(r)["A"]["actual_finish"] == "2026-12-05"


def test_actual_finish_before_predecessors_rejected():
    with pytest.raises(ValueError, match="earlier than"):
        run(sample({"E": {"actual_finish": "2026-12-10"}}))      # B/D not finished yet


def test_actual_finish_before_predecessor_actual_rejected():
    extra = {"B": {"actual_finish": "2026-12-24"}, "E": {"actual_finish": "2026-12-20"}}
    with pytest.raises(ValueError, match="earlier than"):
        run(sample(extra))


def test_actual_finish_on_first_possible_day_allowed():
    run(sample({"E": {"actual_finish": "2026-12-18"}}))          # 1-day-late finish is fine
    run([{"id": "X", "duration": 1, "actual_finish": "2026-11-02"}])


def test_actual_finish_before_project_start_rejected():
    with pytest.raises(ValueError, match="earlier than"):
        run([{"id": "X", "duration": 1, "actual_finish": "2026-10-01"}])


@pytest.mark.parametrize("bad", ["31-12-2026", 20261224, datetime(2026, 12, 24), "x"])
def test_invalid_actual_finish_rejected(bad):
    with pytest.raises(ValueError):
        run([{"id": "X", "duration": 1, "actual_finish": bad}])


# ------------------------------------------------------- response schema/leaks
def test_unknown_input_fields_are_not_returned():
    acts = sample({"A": {"secret": "token-123", "internal_notes": "x", "pos_x": 10}})
    r = run(acts)
    assert "token-123" not in repr(r)
    assert not ({"secret", "internal_notes", "pos_x"} & set(by_id(r)["A"]))
    ScheduleResponse.model_validate(r)


def test_schema_rejects_undeclared_fields():
    r = run()
    r["activities"][0]["leak"] = 1
    with pytest.raises(ValidationError, match="leak"):
        ScheduleResponse.model_validate(r)


def test_name_and_shop_must_be_text():
    with pytest.raises(ValueError):
        run([{"id": "X", "duration": 1, "name": 5}])
    with pytest.raises(ValueError):
        run([{"id": "X", "duration": 1, "shop": ["a"]}])


# ------------------------------------------------------------ graph validation
def test_cycle_rejected_and_names_activities():
    acts = [{"id": "A", "duration": 1, "predecessors": ["B"]},
            {"id": "B", "duration": 1, "predecessors": ["A"]},
            {"id": "C", "duration": 1}]
    with pytest.raises(ValueError, match="cycle.*A, B"):
        run(acts)


@pytest.mark.parametrize("acts,msg", [
    ([{"id": "A", "duration": 1, "predecessors": ["A"]}], "itself"),
    ([{"id": "A", "duration": 1, "predecessors": ["Z"]}], "Unknown predecessor"),
    ([{"id": "A", "duration": 1}, {"id": "B", "duration": 1, "predecessors": ["A", "A"]}], "duplicate"),
    ([{"id": "A", "duration": 1}, {"id": "A", "duration": 1}], "Duplicate"),
    ([], "at least one"),
    ([{"id": "A", "duration": 0}], "at least one working day"),
    ([{"id": "A", "duration": 30.0}], "integer"),
    ([{"id": "A", "duration": True}], "integer"),
    ([{"id": "A", "duration": 5001}], "cannot exceed"),
    ([{"id": " ", "duration": 1}], "non-empty"),
    ([{"id": "A", "duration": 1, "predecessors": "B"}], "list"),
    (["A"], "object"),
])
def test_invalid_activities_rejected(acts, msg):
    with pytest.raises(ValueError, match=msg):
        run(acts)


def test_delivery_before_start_rejected():
    with pytest.raises(ValueError):
        run(delivery_date=date(2026, 10, 1))


def test_chain_length_cap():
    acts = [{"id": f"T{i}", "duration": 5000, "predecessors": [f"T{i-1}"] if i else []}
            for i in range(5)]
    with pytest.raises(ValueError, match="cannot exceed"):
        run(acts)


def test_parallel_branch_longer_than_chain_is_critical():
    acts = [{"id": "P", "duration": 10},
            {"id": "Q", "duration": 2},
            {"id": "R", "duration": 2, "predecessors": ["Q"]}]
    r = run(acts)
    assert r["critical_activities"] == ["P"] and r["chain_days"] == 10
    assert by_id(r)["R"]["float_days"] == 6


def test_equal_parallel_chains_are_both_critical():
    r = run([{"id": "P", "duration": 5}, {"id": "Q", "duration": 5}])
    assert r["critical_activities"] == ["P", "Q"]


def test_straight_line_would_be_wrong():
    assert run()["chain_days"] == 57 != sum(v[2] for v in SAMPLE.values())   # not 94


def test_dates_follow_arrows_not_input_order():
    shuffled = list(reversed(sample()))
    assert run(shuffled)["chain_finish"] == "2027-01-06"


@pytest.mark.perf
def test_large_plan_is_fast():
    acts = [{"id": f"T{i}", "duration": 3, "predecessors": [f"T{i-1}"] if i else []}
            for i in range(1000)]
    t = time.perf_counter()
    run(acts, delivery_date=date(2032, 1, 1))
    assert time.perf_counter() - t < 15   # old per-day code took 17s+; this is ~0.2s


@pytest.mark.perf
def test_many_holidays_stay_fast():
    acts = [{"id": f"T{i}", "duration": 3, "predecessors": [f"T{i-1}"] if i else []}
            for i in range(1000)]
    hol = {date(2026, 11, 2) + timedelta(days=i * 3) for i in range(5000)}
    t = time.perf_counter()
    run(acts, delivery_date=date(2040, 1, 1), holidays=hol)
    assert time.perf_counter() - t < 15   # old per-day code took 17s+; this is ~0.2s


# ------------------------------------------------------------- input limits
def test_activity_count_limit():
    ok = [{"id": f"T{i}", "duration": 1} for i in range(1000)]
    run(ok)
    with pytest.raises(ValueError, match="At most 1000 activities"):
        run(ok + [{"id": "extra", "duration": 1}])


def test_dependency_count_limit():
    acts = [{"id": f"T{i}", "duration": 1, "predecessors": [f"T{j}" for j in range(i)]}
            for i in range(100)]          # 4950 dependencies: allowed
    run(acts)
    acts.append({"id": "last", "duration": 1, "predecessors": [f"T{j}" for j in range(100)]})
    with pytest.raises(ValueError, match="dependencies"):
        run(acts)


def test_holiday_count_limit():
    base = date(2027, 6, 1)
    run(holidays={base + timedelta(days=i) for i in range(10_000)})
    with pytest.raises(ValueError, match="At most 10000 holidays"):
        run(holidays={base + timedelta(days=i) for i in range(10_001)})


def test_text_limits_and_trimming():
    r = run([{"id": " A ", "duration": 1, "name": "  Weld  ", "shop": "   "}])
    a = r["activities"][0]
    assert (a["id"], a["name"], a["shop"]) == ("A", "Weld", None)
    for bad in ({"id": "x" * 101, "duration": 1},
                {"id": "A", "duration": 1, "name": "n" * 201},
                {"id": "A", "duration": 1, "shop": "s" * 101}):
        with pytest.raises(ValueError, match="exceed"):
            run([bad])


@pytest.mark.parametrize("bad", ["20261224", "2026-W52-4", "2026-1-5", " 2026-12-24", "2026-12-24 "])
def test_only_strict_iso_dates_accepted(bad):
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        run(project_start=bad)
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        run(holidays=[bad])


def test_far_away_dates_rejected():
    with pytest.raises(ValueError, match="within"):
        run(delivery_date=date(2400, 1, 1))


def test_calendar_days_counted_from_first_working_day():
    r = run([{"id": "X", "duration": 5}], project_start=date(2026, 11, 1))   # a Sunday
    assert r["chain_calendar_days"] == 5          # Mon 2-Nov .. Fri 6-Nov


# ------------------------------------------ date range, offsets, non-working days
@pytest.mark.parametrize("bad", [date(9999, 12, 31), date(9999, 12, 20), date(1800, 1, 1), date.min, date.max])
def test_out_of_range_dates_give_value_error_not_overflow(bad):
    acts = [{"id": "A", "duration": 1}]
    with pytest.raises(ValueError, match="between"):
        calculate_schedule(acts, project_start=bad, delivery_date=date(9999, 12, 31))
    with pytest.raises(ValueError, match="between"):
        calculate_schedule(acts, project_start=date(2026, 11, 2), delivery_date=bad)
    with pytest.raises(ValueError, match="between"):
        calculate_schedule(acts, START, DELIVERY, holidays=[bad])
    with pytest.raises(ValueError, match="between"):
        calculate_schedule([{"id": "A", "duration": 1, "actual_finish": bad}], START, DELIVERY)
    with pytest.raises(ValueError, match="between"):
        WorkCalendar(bad)


def test_supported_date_range_edges_are_accepted():
    r = calculate_schedule([{"id": "A", "duration": 1}], date(1900, 1, 2), date(1900, 3, 1))
    assert r["schedule_start"] == "1900-01-02"
    r = calculate_schedule([{"id": "A", "duration": 1}], date(8999, 12, 1), date(9000, 1, 1))
    assert r["project_start"] == "8999-12-01"                  # a Sunday
    assert r["schedule_start"] == r["chain_finish"] == "8999-12-02"


def test_largest_legal_plan_with_full_buffer_is_accepted():
    """20,000-day chain + 100% buffer needs a working-day offset of ~40,000."""
    acts = [{"id": f"T{i}", "duration": 5000, "predecessors": [f"T{i-1}"] if i else []}
            for i in range(4)]
    r = run(acts, delivery_date=date(2100, 1, 1), buffer_percent=100)
    assert r["chain_days"] == 20_000 and r["buffer_days"] == 20_000
    assert r["total_buffered_days"] == 40_000
    assert r["buffered_finish"] > r["chain_finish"] > "2026-11-02"
    ScheduleResponse.model_validate(r)


def test_actual_finish_may_fall_on_a_sunday():
    """Rule: actual_finish is a recorded fact, so Sundays and holidays are allowed."""
    r = run([{"id": "A", "duration": 3, "actual_finish": "2026-11-08"},      # a Sunday
             {"id": "B", "duration": 2, "predecessors": ["A"]}])
    acts = by_id(r)
    assert acts["A"]["forecast_finish"] == "2026-11-08"
    assert acts["B"]["forecast_start"] == "2026-11-09"                      # next working day
    assert acts["B"]["forecast_finish"] == "2026-11-10"


def test_actual_finish_may_fall_on_a_holiday():
    r = run([{"id": "A", "duration": 3, "actual_finish": "2026-11-11"},
             {"id": "B", "duration": 1, "predecessors": ["A"]}],
            holidays={date(2026, 11, 11)})
    assert by_id(r)["B"]["forecast_start"] == "2026-11-12"


def test_schedule_start_differs_from_project_start_on_a_sunday():
    r = run([{"id": "A", "duration": 2}], project_start=date(2026, 11, 1))      # Sunday
    assert r["project_start"] == "2026-11-01"
    assert r["schedule_start"] == "2026-11-02"
    assert by_id(r)["A"]["planned_start"] == r["schedule_start"]


def test_schedule_start_skips_a_holiday_start():
    r = run([{"id": "A", "duration": 1}], project_start=date(2026, 12, 25),
            holidays={date(2026, 12, 25)})
    assert r["schedule_start"] == "2026-12-26"


def test_schedule_start_equals_project_start_on_a_working_day():
    r = run()
    assert r["schedule_start"] == r["project_start"] == "2026-11-02"


# --------------------------------------------- boundaries for offsets and dates
def test_working_day_offset_boundaries():
    cal = WorkCalendar(date(2026, 11, 2))
    assert cal.date_at(0) == date(2026, 11, 2)
    assert cal.date_at(40_000) > cal.date_at(39_999)            # chain + 100% buffer
    assert cal.date_at(85_000) < MAX_SUPPORTED_DATE             # near the calendar span
    with pytest.raises(ValueError, match="calendar limit"):     # span binds before the ceiling
        cal.date_at(MAX_WORKING_OFFSET)
    with pytest.raises(ValueError, match="supported limit"):    # beyond the hard ceiling
        cal.date_at(MAX_WORKING_OFFSET + 1)
    for bad in (-1, True, 1.5, "3", None):
        with pytest.raises(ValueError):
            cal.date_at(bad) # type: ignore[arg-type]


def test_activity_finish_past_supported_range_gives_clear_error():
    with pytest.raises(ValueError, match="past the latest supported date"):
        calculate_schedule([{"id": "A", "duration": 3000}],
                           date(8999, 12, 1), date(9000, 1, 1))


def test_buffer_finish_past_supported_range_gives_clear_error():
    # The chain itself ends inside the range; only the 25% buffer crosses 9000-01-01.
    chain_only = calculate_schedule([{"id": "A", "duration": 300}],
                                    date(8999, 1, 4), date(9000, 1, 1), buffer_percent=0)
    assert chain_only["chain_finish"] < MAX_SUPPORTED_DATE.isoformat()
    with pytest.raises(ValueError, match="past the latest supported date"):
        calculate_schedule([{"id": "A", "duration": 300}],
                           date(8999, 1, 4), date(9000, 1, 1), buffer_percent=25)


def test_forecast_finish_past_supported_range_gives_clear_error():
    acts = [{"id": "A", "duration": 1, "actual_finish": "8999-12-31"},
            {"id": "B", "duration": 400, "predecessors": ["A"]}]
    with pytest.raises(ValueError, match="past the latest supported date"):
        calculate_schedule(acts, date(8999, 1, 4), date(9000, 1, 1), buffer_percent=0)


def test_last_supported_dates_still_work():
    r = calculate_schedule([{"id": "A", "duration": 1}], date(8999, 12, 20), date(9000, 1, 1))
    assert r["chain_finish"] <= MAX_SUPPORTED_DATE.isoformat()
    ScheduleResponse.model_validate(r)


def test_no_overflow_error_for_any_extreme_input():
    extremes = [date.min, date(1900, 1, 1), date(9000, 1, 1), date(9999, 12, 31), date.max]
    for a in extremes:
        for b in extremes:
            try:
                calculate_schedule([{"id": "A", "duration": 5000}], a, b)
            except ValueError:
                pass                      # a clear ValueError is fine; OverflowError is not


# --------------------------------------------------- response schema constraints
def good():
    return run()


def break_it(mutator):
    r = good()
    mutator(r)
    with pytest.raises(ValidationError):
        ScheduleResponse.model_validate(r)


@pytest.mark.parametrize("name,mutator", [
    ("is_complete disagrees with actual_finish",
     lambda r: r["activities"][0].update(is_complete=True)),
    ("total_buffered_days wrong", lambda r: r.update(total_buffered_days=70)),
    ("zero buffer must have no dates",
     lambda r: r.update(buffer_days=0, total_buffered_days=57)),
    ("buffer_finish differs from buffered_finish", lambda r: r.update(buffer_finish="2027-01-21")),
    ("buffer starts before the chain ends", lambda r: r.update(buffer_start="2027-01-06")),
    ("buffered_finish before chain_finish", lambda r: r.update(buffered_finish="2027-01-05")),
    ("schedule_start before project_start", lambda r: r.update(schedule_start="2026-10-30")),
    ("delivery before start", lambda r: r.update(delivery_date="2026-10-01")),
    ("critical list not matching activities", lambda r: r.update(critical_activities=["A"])),
    ("critical edge touches a non-critical activity",
     lambda r: r["critical_edges"].append({"source": "C", "target": "D"})),
    ("duration below minimum", lambda r: r["activities"][0].update(duration=0)),
    ("duration above maximum", lambda r: r["activities"][0].update(duration=5001)),
    ("buffer percent above 100", lambda r: r.update(buffer_percent=101)),
    ("buffer percent NaN", lambda r: r.update(buffer_percent=math.nan)),
    ("negative buffer days", lambda r: r.update(buffer_days=-1)),
    ("negative float", lambda r: r["activities"][0].update(float_days=-1)),
    ("critical flag contradicts float", lambda r: r["activities"][1].update(is_critical=True)),
    ("offsets do not match duration", lambda r: r["activities"][0].update(early_finish_offset=5)),
    ("chain_finish not the latest finish", lambda r: r.update(chain_finish="2027-01-05")),
    ("forecast_finish not the latest", lambda r: r.update(forecast_finish="2027-01-05")),
    ("unknown predecessor", lambda r: r["activities"][1].update(predecessors=["Z"])),
    ("duplicate activity id", lambda r: r["activities"][1].update(id="A")),
    ("planned start after finish",
     lambda r: r["activities"][0].update(planned_start="2027-01-01")),
    ("name too long", lambda r: r["activities"][0].update(name="n" * 201)),
])
def test_schema_rejects_inconsistent_responses(name, mutator):
    break_it(mutator)


def test_schema_accepts_null_dates_for_zero_buffer_and_open_activities():
    r = ScheduleResponse.model_validate(run(buffer_percent=0))
    assert r.buffer_start is None and r.buffer_finish is None
    assert all(a.actual_finish is None for a in r.activities)


def test_random_plans_always_produce_valid_responses():
    rng = random.Random(3)
    for t in range(150):
        n = rng.randint(1, 25)
        acts = []
        for i in range(n):
            preds = rng.sample([f"T{j}" for j in range(i)], k=min(i, rng.randint(0, 3)))
            acts.append({"id": f"T{i}", "name": f"Task {i}", "shop": "S",
                         "duration": rng.randint(1, 50), "predecessors": preds})
        start = date(2026, 11, 1) + timedelta(days=rng.randint(0, 30))
        hol = {start + timedelta(days=rng.randint(0, 250)) for _ in range(rng.choice([0, 5, 40]))}
        r = calculate_schedule(acts, start, start + timedelta(days=rng.randint(0, 300)),
                               rng.choice([0, 10, 25, 33.3, 100]), hol)
        ScheduleResponse.model_validate(r)


# ------------------------------------------------ forecast buffer regression tests

def test_delayed_actual_finish_moves_forecast_buffer_only():
    activities = [
        {"id": "A", "duration": 2, "actual_finish": "2026-11-06"},
        {"id": "B", "duration": 2, "predecessors": ["A"]},
    ]

    r = run(activities)

    # Baseline dates and buffer remain unchanged.
    assert r["chain_finish"] == "2026-11-05"
    assert r["buffer_finish"] == "2026-11-06"

    # Actual progress moves the forecast network and its separate buffer.
    assert r["forecast_finish"] == "2026-11-09"
    assert r["forecast_buffer_start"] == "2026-11-10"
    assert r["forecast_buffer_finish"] == "2026-11-10"


def test_zero_buffer_forecast_has_no_buffer_start():
    activities = [
        {"id": "A", "duration": 1, "actual_finish": "2026-11-04"},
    ]

    r = run(activities, buffer_percent=0)

    assert r["buffer_days"] == 0
    assert r["forecast_finish"] == "2026-11-04"
    assert r["forecast_buffer_start"] is None
    assert r["forecast_buffer_finish"] == r["forecast_finish"]


def test_sunday_actual_finish_moves_successor_to_monday():
    activities = [
        {"id": "A", "duration": 1, "actual_finish": "2026-11-08"},
        {"id": "B", "duration": 1, "predecessors": ["A"]},
    ]

    r = run(activities)
    acts = by_id(r)

    assert acts["A"]["actual_finish"] == "2026-11-08"
    assert acts["B"]["forecast_start"] == "2026-11-09"
    assert acts["B"]["forecast_finish"] == "2026-11-09"
    assert r["forecast_finish"] == "2026-11-09"


def test_forecast_skips_custom_holiday():
    activities = [
        {"id": "A", "duration": 1, "actual_finish": "2026-11-02"},
        {"id": "B", "duration": 1, "predecessors": ["A"]},
    ]

    r = run(activities, holidays=["2026-11-03"])
    acts = by_id(r)

    # Tuesday, 3 November, is a configured holiday.
    assert acts["B"]["forecast_start"] == "2026-11-04"
    assert acts["B"]["forecast_finish"] == "2026-11-04"


def test_forecast_buffer_supports_more_than_5000_working_days():
    activities = [
        {"id": "A", "duration": 3000},
        {"id": "B", "duration": 3000, "predecessors": ["A"]},
    ]

    r = run(
        activities,
        buffer_percent=100,
    )

    assert r["chain_days"] == 6000
    assert r["buffer_days"] == 6000
    assert r["forecast_finish"] == r["chain_finish"]

    # The same 6,000-day buffer is applied to the forecast.
    assert r["forecast_buffer_start"] is not None
    assert r["forecast_buffer_finish"] == r["buffered_finish"]
    assert r["forecast_buffer_finish"] > r["forecast_finish"]
