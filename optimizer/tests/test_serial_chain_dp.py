import json
import unittest
from unittest.mock import patch

from optimizer.energy_data import DEMO_SOLAR_PROFILE, DEMO_TARIFF_PROFILE
from optimizer.input_layer import validate_user_input
from optimizer.models import (
    COST_SCALE,
    SOLAR_SCALE,
    TIME_SCALE,
    exact_minute_count,
    schedule_time_to_minute_count,
    time_to_grid_floor,
)
from optimizer.optimizer import (
    _add_shared_solar_pool,
    _build_base_model,
    _serial_chain_order,
    _serial_process_cost_by_phase,
    _new_solver,
    create_baseline_schedule,
    create_cost_optimized_schedule,
    get_solar_availability,
    get_tariff,
)
from optimizer.public_api import optimize_request
from optimizer.verification import verify_schedule


CANONICAL_DURATIONS = (120, 45, 300, 720, 60, 35, 25, 40)
CANONICAL_POWERS = (250, 200, 165, 60, 85, 130, 95, 38)


def _request(horizon_hours=24, durations=CANONICAL_DURATIONS,
             powers=CANONICAL_POWERS, dependencies=None, flexible=None):
    if dependencies is None:
        dependencies = [
            [] if index == 0 else [f"process-{index - 1}"]
            for index in range(len(durations))
        ]
    if flexible is None:
        flexible = [True] * len(durations)
    return {
        "factory": {
            "factory_name": "Serial Chain DP Test",
            "planning_horizon_hours": horizon_hours,
            "production_deadline": horizon_hours,
            "processes": [
                {
                    "process_id": f"process-{index}",
                    "process_name": f"Process {index}",
                    "duration_hours": duration / TIME_SCALE,
                    "power_kw": powers[index],
                    "dependencies": dependencies[index],
                    "is_flexible": flexible[index],
                    "machine_id": f"machine-{index}",
                }
                for index, duration in enumerate(durations)
            ],
            "machines": [
                {
                    "machine_id": f"machine-{index}",
                    "machine_name": f"Machine {index}",
                    "capacity": 1,
                }
                for index in range(len(durations))
            ],
        },
        "energy": {
            "solar_profile": {
                str(hour): value
                for hour, value in DEMO_SOLAR_PROFILE.items()
            },
            "tariff_profile": {
                str(hour): value
                for hour, value in DEMO_TARIFF_PROFILE.items()
            },
        },
        "options": {"objective": "cost", "max_time_seconds": 10},
    }


def _legacy_cp_objective(config):
    model, starts, ends = _build_base_model(config)
    horizon = time_to_grid_floor(config.planning_horizon_hours)
    hours = (horizon + TIME_SCALE - 1) // TIME_SCALE
    tariffs = {
        hour: int(round(
            get_tariff(hour, config.energy["tariff_profile"]) * COST_SCALE
        ))
        for hour in range(hours)
    }
    active_hours = {
        hour for hour in range(hours) if tariffs[hour % 24] != 0
    }
    share, demand = _add_shared_solar_pool(
        config,
        model,
        starts,
        config.energy["solar_profile"],
        collect_demand=True,
        active_hours=active_hours,
    )
    cost = sum(
        tariffs[hour % 24] * (demand[hour] - share[hour])
        for hour in sorted(active_hours)
    )
    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, list(ends.values()))
    model.Minimize(cost * (horizon + 1) + makespan)
    solver = _new_solver(10)
    status = solver.Solve(model)
    if status not in (2, 4):
        raise AssertionError(f"reference CP-SAT solve: {solver.StatusName(status)}")
    return solver.ObjectiveValue(), solver.StatusName(status)


def _minute_cost(process, start, solar_profile, tariff_profile):
    demand_units = int(process.power_kw * (SOLAR_SCALE // TIME_SCALE))
    total = 0
    for minute in range(start, start + process.duration_minutes):
        hour = minute // TIME_SCALE
        solar_kw = get_solar_availability(hour, solar_profile)
        pool_units = max(
            int(solar_kw * (SOLAR_SCALE // TIME_SCALE)), 0
        )
        process_cap = int(
            min(solar_kw, process.power_kw)
            * (SOLAR_SCALE // TIME_SCALE)
        )
        grid_units = demand_units - min(pool_units, process_cap)
        tariff_units = int(round(
            get_tariff(hour, tariff_profile) * COST_SCALE
        ))
        total += tariff_units * grid_units
    return total


class SerialChainDynamicProgrammingTests(unittest.TestCase):
    def test_guard_requires_a_total_precedence_order_and_feasible_single_loads(self):
        chain = validate_user_input(_request())
        self.assertEqual(
            _serial_chain_order(chain),
            [f"process-{index}" for index in range(8)],
        )

        incomparable = validate_user_input(_request(
            horizon_hours=4,
            durations=(25, 35),
            powers=(0.4, 0.6),
            dependencies=[[], []],
        ))
        self.assertIsNone(_serial_chain_order(incomparable))

    def test_exhaustive_two_process_chain_matches_cp_sat_and_all_schedules(self):
        request = _request(
            horizon_hours=2,
            durations=(25, 35),
            powers=(0.4, 0.6),
        )
        config = validate_user_input(request)
        optimized = create_cost_optimized_schedule(
            config,
            max_time_seconds=10,
        )
        self.assertEqual(optimized["status"], "OPTIMAL")
        verify_schedule(config, optimized)

        processes = config.processes
        feasible = []
        for first_start in range(0, 120 - processes[0].duration_minutes + 1):
            for second_start in range(
                0, 120 - processes[1].duration_minutes + 1
            ):
                if first_start + processes[0].duration_minutes > second_start:
                    continue
                cost = (
                    _minute_cost(
                        processes[0], first_start,
                        config.energy["solar_profile"],
                        config.energy["tariff_profile"],
                    )
                    + _minute_cost(
                        processes[1], second_start,
                        config.energy["solar_profile"],
                        config.energy["tariff_profile"],
                    )
                )
                feasible.append((cost, second_start + processes[1].duration_minutes))

        brute_force_optimum = min(feasible)
        reported_cost_units = round(
            optimized["total_energy_cost"] * COST_SCALE * SOLAR_SCALE
        )
        self.assertEqual(
            (reported_cost_units, round(optimized["makespan"] * TIME_SCALE)),
            brute_force_optimum,
        )
        self.assertEqual(
            _legacy_cp_objective(config),
            (
                brute_force_optimum[0] * (120 + 1)
                + brute_force_optimum[1],
                "OPTIMAL",
            ),
        )

    def test_cost_profile_lookup_matches_minute_sum_for_every_daily_phase(self):
        profiles = (
            (
                {hour: 0.0 for hour in range(24)},
                {hour: 0.1 for hour in range(24)},
            ),
            (
                {hour: 0.2 for hour in range(24)},
                {
                    hour: 0.085 if hour < 7 else 0.218
                    for hour in range(24)
                },
            ),
            (
                {hour: 2.0 for hour in range(24)},
                {
                    hour: 0.142 if hour < 17 else 0.218
                    for hour in range(24)
                },
            ),
        )
        config = validate_user_input(_request(
            horizon_hours=24,
            durations=(25, 35, 40, 45, 720),
            powers=(0.4, 0.6, 0.8, 1.0, 2.0),
        ))
        for solar_profile, tariff_profile in profiles:
            for process in config.processes:
                table = _serial_process_cost_by_phase(
                    process, solar_profile, tariff_profile
                )
                self.assertEqual(len(table), 24 * TIME_SCALE)
                for phase, value in enumerate(table):
                    self.assertEqual(
                        value,
                        _minute_cost(
                            process, phase, solar_profile, tariff_profile
                        ),
                        (process.duration_minutes, phase),
                    )

    def test_canonical_shape_24h_matches_legacy_cp_sat_objective(self):
        config = validate_user_input(_request(horizon_hours=24))
        result = create_cost_optimized_schedule(
            config,
            max_time_seconds=10,
        )
        self.assertEqual(result["status"], "OPTIMAL")
        verify_schedule(config, result)
        cost_units = round(
            result["total_energy_cost"] * COST_SCALE * SOLAR_SCALE
        )
        expected_objective = (
            cost_units * (time_to_grid_floor(24) + 1)
            + round(result["makespan"] * TIME_SCALE)
        )
        self.assertEqual(
            expected_objective,
            _legacy_cp_objective(config)[0],
        )

    def test_canonical_shape_168h_is_optimal_and_json_round_trips_exact_minutes(self):
        config = validate_user_input(_request(horizon_hours=168))
        result = create_cost_optimized_schedule(
            config,
            max_time_seconds=10,
        )
        self.assertEqual(result["status"], "OPTIMAL")
        verify_schedule(config, result)

        serialized = json.loads(json.dumps(result))
        verify_schedule(config, serialized)
        starts = {
            row["process_id"]: schedule_time_to_minute_count(row["start_time"])
            for row in serialized["processes"]
        }
        self.assertEqual(len(starts), 8)
        self.assertTrue(all(value is not None for value in starts.values()))
        for row in serialized["processes"]:
            self.assertEqual(
                schedule_time_to_minute_count(row["end_time"])
                - schedule_time_to_minute_count(row["start_time"]),
                round(row["duration_hours"] * TIME_SCALE),
            )
        self.assertIsNone(exact_minute_count(7955 / TIME_SCALE))
        self.assertEqual(
            schedule_time_to_minute_count(7955 / TIME_SCALE),
            7955,
        )
        public_result = optimize_request(_request(horizon_hours=168))
        self.assertEqual(public_result["status"], "OPTIMAL")
        public_schedule = json.loads(json.dumps(
            public_result["result"]["optimized"]
        ))
        for row in public_schedule["processes"]:
            self.assertIsNotNone(
                schedule_time_to_minute_count(row["start_time"])
            )
            self.assertIsNotNone(
                schedule_time_to_minute_count(row["end_time"])
            )

    def test_nonflexible_process_remains_pinned_to_baseline(self):
        config = validate_user_input(_request(
            horizon_hours=24,
            durations=(25, 35, 40),
            powers=(0.4, 0.6, 0.8),
            flexible=(True, False, True),
        ))
        baseline = create_baseline_schedule(config)
        result = create_cost_optimized_schedule(
            config,
            baseline_schedule=baseline,
            max_time_seconds=10,
        )
        verify_schedule(config, result, baseline=baseline)
        baseline_start = next(
            row["start_time"] for row in baseline["processes"]
            if row["process_id"] == "process-1"
        )
        optimized_start = next(
            row["start_time"] for row in result["processes"]
            if row["process_id"] == "process-1"
        )
        self.assertEqual(optimized_start, baseline_start)

    def test_incomparable_processes_keep_the_cp_sat_fallback(self):
        request = _request(
            horizon_hours=4,
            durations=(25, 35),
            powers=(0.4, 0.6),
            dependencies=[[], []],
        )
        request["factory"]["processes"][1]["machine_id"] = "machine-0"
        request["factory"]["machines"] = request["factory"]["machines"][:1]
        config = validate_user_input(request)
        with patch(
            "optimizer.optimizer._create_serial_chain_cost_schedule",
            side_effect=AssertionError("DP must not handle concurrency"),
        ):
            result = create_cost_optimized_schedule(
                config,
                max_time_seconds=10,
            )
        self.assertIn(result["status"], {"OPTIMAL", "FEASIBLE"})
        verify_schedule(config, result)
        rows = sorted(result["processes"], key=lambda row: row["start_time"])
        self.assertGreaterEqual(rows[1]["start_time"], rows[0]["end_time"])


if __name__ == "__main__":
    unittest.main()
