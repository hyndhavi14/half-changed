"""Exact, scenario-only CP-SAT path for APERC kVAh historical replays."""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from zoneinfo import ZoneInfo

from ortools.sat.python import cp_model


ENERGY_SCALE = 600_000
PF_DENOMINATOR = 19
COST_DENOMINATOR = ENERGY_SCALE * PF_DENOMINATOR
MAX_CP_SAT_INTEGER = (1 << 63) - 1
MINUTES_PER_HOUR = 60
MINUTES_PER_WEEK = 7 * 24 * 60
SCHEDULE_TICK_MINUTES = 30
TICKS_PER_WEEK = MINUTES_PER_WEEK // SCHEDULE_TICK_MINUTES
LOCAL_TZ = ZoneInfo("Asia/Kolkata")
DECIMAL_PATTERN = re.compile(r"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$")
APERC_PRICE_CENTS = {
    "HGD": {"peak": 780, "normal": 630, "off_peak": 555},
    "LGD": {"peak": 730, "normal": 630, "off_peak": 555},
}
EXPECTED_WINDOWS = {
    ("off_peak", 0, 360),
    ("peak", 360, 600),
    ("off_peak", 600, 900),
    ("normal", 900, 1080),
    ("peak", 1080, 1320),
    ("normal", 1320, 0),
}


class ScenarioInputError(ValueError):
    """Invalid exact-decimal historical scenario input."""


def _decimal_units(value: Any, field: str, scale: int = 10_000) -> int:
    if not isinstance(value, str) or not DECIMAL_PATTERN.fullmatch(value):
        raise ScenarioInputError(f"{field} must be a non-negative decimal string with at most 4 places.")
    amount = Decimal(value)
    units = amount * scale
    if units != units.to_integral_value():
        raise ScenarioInputError(f"{field} cannot be represented at scale {scale}.")
    return int(units)


def _parse_clock(value: Any, field: str) -> int:
    if not isinstance(value, str):
        raise ScenarioInputError(f"{field} must be a local-time string.")
    match = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?", value)
    if not match:
        raise ScenarioInputError(f"{field} must be an exact local-time minute.")
    return int(match.group(1)) * 60 + int(match.group(2))


def _prepare_tariffs(payload: dict[str, Any], regime: str) -> list[dict[str, Any]]:
    rows = payload.get("tariffs")
    if not isinstance(rows, list) or len(rows) != 6:
        raise ScenarioInputError("exactly six persisted APERC local-time tariff windows are required.")
    if payload.get("power_factor_ratio") != "19/20":
        raise ScenarioInputError("the scenario PF must explicitly be the approved modeled ratio 19/20.")
    prepared = []
    seen: set[tuple[str, int, int]] = set()
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            raise ScenarioInputError("each APERC tariff window must be an object.")
        if row.get("regime") != regime or row.get("currency") != "INR" or row.get("energy_basis") != "kVAh":
            raise ScenarioInputError("APERC windows must use the scenario regime, INR, and kVAh basis.")
        band = row.get("band")
        start = _parse_clock(row.get("start_time"), f"tariffs[{index}].start_time")
        end = _parse_clock(row.get("end_time"), f"tariffs[{index}].end_time")
        key = (band, start, end)
        if key not in EXPECTED_WINDOWS or key in seen:
            raise ScenarioInputError("APERC local-time tariff windows are incomplete, duplicated, or unsupported.")
        seen.add(key)
        price_cents = _decimal_units(row.get("energy_price"), f"tariffs[{index}].energy_price", 100)
        if price_cents != APERC_PRICE_CENTS[regime][band]:
            raise ScenarioInputError("APERC tariff price does not match the verified FY2025-26 11 kV rate.")
        rate_scaled_numerator = price_cents * 20
        if rate_scaled_numerator % 100:
            raise ScenarioInputError("the approved PF conversion cannot represent this tariff at denominator 19.")
        effective_months = row.get("effective_months")
        if not isinstance(effective_months, list) or not effective_months:
            raise ScenarioInputError("APERC tariff windows require their effective local months.")
        prepared.append({
            **row,
            "start_minute": start,
            "end_minute": end,
            "rate_numerator": rate_scaled_numerator // 100,
            "effective_months": {int(month) for month in effective_months},
        })
    if seen != EXPECTED_WINDOWS:
        raise ScenarioInputError("APERC tariff windows do not cover the six verified local-time periods.")
    return prepared


def _minute_tariff(
    utc_at: datetime,
    regime: str,
    tariff_rows: list[dict[str, Any]],
) -> tuple[str, int]:
    local = utc_at.astimezone(LOCAL_TZ)
    minute = local.hour * 60 + local.minute
    local_day = local.date().isoformat()
    matches = []
    for row in tariff_rows:
        if (
            local_day < row["effective_from"]
            or local_day >= row["effective_to"]
            or local.month not in row["effective_months"]
        ):
            continue
        start = row["start_minute"]
        end = row["end_minute"]
        in_window = start <= minute < end if start < end else minute >= start or minute < end
        if in_window:
            matches.append(row)
    if len(matches) != 1:
        raise ScenarioInputError(
            f"expected one persisted APERC tariff at {local.isoformat()}, found {len(matches)}."
        )
    match = matches[0]
    return match["band"], match["rate_numerator"]


def _process_cost_prefix(
    process_power_units: int,
    solar_power_units: list[int],
    tariff_numerators: list[int],
) -> tuple[list[int], list[int], list[int]]:
    cost_prefix = [0]
    solar_prefix = [0]
    grid_prefix = [0]
    for solar_units, rate_numerator in zip(solar_power_units, tariff_numerators):
        allocated = min(process_power_units, solar_units)
        grid = process_power_units - allocated
        cost_prefix.append(cost_prefix[-1] + grid * rate_numerator)
        solar_prefix.append(solar_prefix[-1] + allocated)
        grid_prefix.append(grid_prefix[-1] + grid)
    return cost_prefix, solar_prefix, grid_prefix


def _entry(
    process: dict[str, Any],
    start_minute: int,
    horizon_start: datetime,
    solar_power_units: list[int],
    tariff_numerators: list[int],
) -> dict[str, Any]:
    duration = process["duration_minutes"]
    power_units = _decimal_units(process["power_kw"], "process.power_kw")
    cost_prefix, solar_prefix, grid_prefix = _process_cost_prefix(
        power_units, solar_power_units, tariff_numerators
    )
    start = horizon_start + timedelta(minutes=start_minute)
    end = start + timedelta(minutes=duration)
    cost_numerator = cost_prefix[start_minute + duration] - cost_prefix[start_minute]
    energy_units = power_units * duration
    solar_units = solar_prefix[start_minute + duration] - solar_prefix[start_minute]
    grid_units = grid_prefix[start_minute + duration] - grid_prefix[start_minute]
    display_cost = (Decimal(cost_numerator) / COST_DENOMINATOR).quantize(
        Decimal("0.000001"), rounding=ROUND_HALF_UP
    )
    return {
        "process_id": process["id"],
        "machine_id": process["machine_id"],
        "starts_at": start.isoformat().replace("+00:00", "Z"),
        "ends_at": end.isoformat().replace("+00:00", "Z"),
        "start_minute": start_minute,
        "duration_minutes": duration,
        "power_kw": process["power_kw"],
        "energy_units": str(energy_units),
        "solar_energy_units": str(solar_units),
        "grid_energy_units": str(grid_units),
        "cost_numerator": str(cost_numerator),
        "cost_denominator": str(COST_DENOMINATOR),
        "cost_display_inr": str(display_cost),
        "energy_kwh_display": str(
            (Decimal(energy_units) / ENERGY_SCALE).quantize(Decimal("0.000001"))
        ),
        "solar_kwh_display": str(
            (Decimal(solar_units) / ENERGY_SCALE).quantize(Decimal("0.000001"))
        ),
        "grid_kwh_display": str(
            (Decimal(grid_units) / ENERGY_SCALE).quantize(Decimal("0.000001"))
        ),
    }


def _validate_schedule(
    entries: list[dict[str, Any]],
    processes: list[dict[str, Any]],
    dependencies: list[dict[str, Any]],
) -> None:
    by_id = {entry["process_id"]: entry for entry in entries}
    if len(by_id) != len(processes):
        raise RuntimeError("Solver did not schedule each canonical process exactly once.")
    for edge in dependencies:
        successor = by_id[edge["process_id"]]
        predecessor = by_id[edge["depends_on_process_id"]]
        if successor["start_minute"] < predecessor["start_minute"] + predecessor["duration_minutes"]:
            raise RuntimeError("Solver output violates a finish-to-start dependency.")
    by_machine: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        by_machine.setdefault(entry["machine_id"], []).append(entry)
    for machine_entries in by_machine.values():
        ordered = sorted(machine_entries, key=lambda item: item["start_minute"])
        for previous, current in zip(ordered, ordered[1:]):
            if current["start_minute"] < previous["start_minute"] + previous["duration_minutes"]:
                raise RuntimeError("Solver output violates machine non-overlap.")


def _total(entries: list[dict[str, Any]], field: str) -> int:
    return sum(int(entry[field]) for entry in entries)


def _schedule_metrics(entries: list[dict[str, Any]]) -> dict[str, Any]:
    makespan = max(
        entry["start_minute"] + entry["duration_minutes"] for entry in entries
    )
    cost_numerator = _total(entries, "cost_numerator")
    display_cost = (Decimal(cost_numerator) / COST_DENOMINATOR).quantize(
        Decimal("0.000001"), rounding=ROUND_HALF_UP
    )
    return {
        "makespan_minutes": makespan,
        "total_energy_units": str(_total(entries, "energy_units")),
        "total_solar_units": str(_total(entries, "solar_energy_units")),
        "total_grid_units": str(_total(entries, "grid_energy_units")),
        "cost_numerator": str(cost_numerator),
        "cost_denominator": str(COST_DENOMINATOR),
        "modeled_tariff_energy_cost_inr": str(display_cost),
    }


def solve_scenario(payload: dict[str, Any]) -> dict[str, Any]:
    regime = payload.get("regime")
    if regime not in APERC_PRICE_CENTS:
        raise ScenarioInputError("regime must be HGD or LGD.")
    tariff_rows = _prepare_tariffs(payload, regime)
    start_text = payload.get("horizon_start")
    if not isinstance(start_text, str):
        raise ScenarioInputError("horizon_start must be an ISO UTC timestamp.")
    try:
        horizon_start = datetime.fromisoformat(start_text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ScenarioInputError("horizon_start must be an ISO UTC timestamp.") from error
    if horizon_start.utcoffset() != timedelta(0):
        raise ScenarioInputError("horizon_start must use UTC.")

    resource = payload.get("hourly_resource_wh_m2")
    if not isinstance(resource, list) or len(resource) != 168:
        raise ScenarioInputError("exactly 168 hourly NASA observations are required.")
    solar_power_units: list[int] = []
    for index, value in enumerate(resource):
        source_units = _decimal_units(value, f"hourly_resource_wh_m2[{index}]", 100)
        if source_units > 200_000:
            raise ScenarioInputError("NASA hourly resource exceeds the validated 2,000 Wh/m2 bound.")
        solar_power_units.append(source_units * 24)
    solar_power_units = [
        solar_units
        for hourly_units in solar_power_units
        for solar_units in [hourly_units] * MINUTES_PER_HOUR
    ]

    processes = payload.get("processes")
    dependencies = payload.get("dependencies")
    if not isinstance(processes, list) or len(processes) != 8:
        raise ScenarioInputError("the canonical eight-process Chocolate model is required.")
    if not isinstance(dependencies, list) or len(dependencies) != 7:
        raise ScenarioInputError("the canonical seven dependencies are required.")
    seen = set()
    for process in processes:
        if not isinstance(process.get("id"), str) or not isinstance(process.get("machine_id"), str):
            raise ScenarioInputError("each process requires its persisted process and machine UUIDs.")
        if process["id"] in seen:
            raise ScenarioInputError("process UUIDs must be unique.")
        seen.add(process["id"])
        if not isinstance(process.get("duration_minutes"), int) or process["duration_minutes"] <= 0:
            raise ScenarioInputError("process durations must be positive whole minutes.")
        _decimal_units(process.get("power_kw"), "process.power_kw")
    for edge in dependencies:
        if edge.get("dependency_type") != "finish_to_start" or edge.get("lag_minutes") != 0:
            raise ScenarioInputError("only zero-lag finish-to-start dependencies are supported.")
        if edge.get("process_id") not in seen or edge.get("depends_on_process_id") not in seen:
            raise ScenarioInputError("dependency references an unknown process UUID.")

    tariff_numerators = [
        _minute_tariff(
            horizon_start + timedelta(minutes=minute),
            regime,
            tariff_rows,
        )[1]
        for minute in range(MINUTES_PER_WEEK)
    ]
    if horizon_start.second != 0 or horizon_start.microsecond != 0:
        raise ScenarioInputError("the approved half-hour schedule lattice requires a minute-aligned UTC horizon.")
    if any(process["duration_minutes"] % SCHEDULE_TICK_MINUTES for process in processes):
        raise ScenarioInputError("canonical process durations must align to the exact 30-minute schedule lattice.")
    if any(
        (solar_power_units[minute], tariff_numerators[minute])
        != (solar_power_units[minute - 1], tariff_numerators[minute - 1])
        and minute % SCHEDULE_TICK_MINUTES != 0
        for minute in range(1, MINUTES_PER_WEEK)
    ):
        raise ScenarioInputError("solar or local tariff changes fall outside the exact 30-minute schedule lattice.")

    baseline_entries: list[dict[str, Any]] = []
    starts: dict[str, int] = {}
    process_by_id = {process["id"]: process for process in processes}
    pending = list(processes)
    while pending:
        ready = [
            process
            for process in pending
            if all(
                edge["depends_on_process_id"] in starts
                for edge in dependencies
                if edge["process_id"] == process["id"]
            )
        ]
        if not ready:
            raise ScenarioInputError("process dependencies contain a cycle.")
        for process in ready:
            dependencies_for_process = [
                edge["depends_on_process_id"]
                for edge in dependencies
                if edge["process_id"] == process["id"]
            ]
            start_minute = max(
                (
                    starts[dep] + process_by_id[dep]["duration_minutes"]
                    for dep in dependencies_for_process
                ),
                default=0,
            )
            starts[process["id"]] = start_minute
            baseline_entries.append(
                _entry(process, start_minute, horizon_start, solar_power_units, tariff_numerators)
            )
            pending.remove(process)
    _validate_schedule(baseline_entries, processes, dependencies)

    model = cp_model.CpModel()
    start_vars: dict[str, Any] = {}
    end_vars: dict[str, Any] = {}
    intervals_by_machine: dict[str, list[Any]] = {}
    cost_vars: list[Any] = []
    max_cost_by_process = 0

    for process in processes:
        process_id = process["id"]
        duration = process["duration_minutes"]
        duration_ticks = duration // SCHEDULE_TICK_MINUTES
        max_start = TICKS_PER_WEEK - duration_ticks
        start_var = model.new_int_var(0, max_start, f"start_{process_id}")
        end_var = model.new_int_var(duration_ticks, TICKS_PER_WEEK, f"end_{process_id}")
        interval = model.new_interval_var(start_var, duration_ticks, end_var, f"interval_{process_id}")
        start_vars[process_id] = start_var
        end_vars[process_id] = end_var
        model.add_hint(start_var, starts[process_id] // SCHEDULE_TICK_MINUTES)
        intervals_by_machine.setdefault(process["machine_id"], []).append(interval)

        power_units = _decimal_units(process["power_kw"], "process.power_kw")
        prefix, _, _ = _process_cost_prefix(
            power_units, solar_power_units, tariff_numerators
        )
        cost_table = [
            prefix[start_tick * SCHEDULE_TICK_MINUTES + duration]
            - prefix[start_tick * SCHEDULE_TICK_MINUTES]
            for start_tick in range(max_start + 1)
        ]
        largest = max(cost_table, default=0)
        max_cost_by_process += largest
        cost_var = model.new_int_var(0, largest, f"cost_{process_id}")
        model.add_element(start_var, cost_table, cost_var)
        cost_vars.append(cost_var)

    if max_cost_by_process * (TICKS_PER_WEEK + 1) + TICKS_PER_WEEK > MAX_CP_SAT_INTEGER:
        raise ScenarioInputError("CP-SAT objective exceeds the signed 64-bit integer bound.")

    for machine_intervals in intervals_by_machine.values():
        model.add_no_overlap(machine_intervals)
    for edge in dependencies:
        model.add(
            start_vars[edge["process_id"]]
            >= end_vars[edge["depends_on_process_id"]]
        )

    makespan = model.new_int_var(0, TICKS_PER_WEEK, "makespan")
    model.add_max_equality(makespan, list(end_vars.values()))
    model.minimize(sum(cost_vars) * (TICKS_PER_WEEK + 1) + makespan)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = float(payload.get("max_time_seconds", 60))
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"Historical scenario optimization failed with CP-SAT status {solver.status_name(status)}.")

    optimized_entries = [
        _entry(
            process,
            solver.value(start_vars[process["id"]]) * SCHEDULE_TICK_MINUTES,
            horizon_start,
            solar_power_units,
            tariff_numerators,
        )
        for process in processes
    ]
    _validate_schedule(optimized_entries, processes, dependencies)
    if solver.objective_value > MAX_CP_SAT_INTEGER:
        raise RuntimeError("CP-SAT returned an objective outside the checked signed 64-bit bound.")

    return {
        "status": solver.status_name(status),
        "regime": regime,
        "objective_units": str(_total(optimized_entries, "cost_numerator")),
        "objective_denominator": str(COST_DENOMINATOR),
        "energy_scale": ENERGY_SCALE,
        "cost_scale": COST_DENOMINATOR,
        "schedule_tick_minutes": SCHEDULE_TICK_MINUTES,
        "maximum_cost_units_checked": str(max_cost_by_process),
        "baseline": {
            "entries": baseline_entries,
            "metrics": _schedule_metrics(baseline_entries),
        },
        "optimized": {
            "entries": optimized_entries,
            "metrics": _schedule_metrics(optimized_entries),
        },
    }


if __name__ == "__main__":
    try:
        result = solve_scenario(json.load(sys.stdin))
    except Exception as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        sys.exit(2)
    print(json.dumps(result, separators=(",", ":")))
