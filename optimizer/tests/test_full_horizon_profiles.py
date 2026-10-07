import unittest
from unittest.mock import patch

from optimizer.input_layer import InputValidationError, validate_user_input
from optimizer.models import (
    COST_SCALE,
    SOLAR_SCALE,
    TIME_SCALE,
)
from optimizer.optimizer import (
    _serial_process_cost_by_start,
    create_baseline_schedule,
    create_cost_optimized_schedule,
    get_solar_availability,
    get_tariff,
)
from optimizer.verification import verify_schedule


PROCESS_DURATIONS = (120, 45, 300, 720, 60, 35, 25, 40)
PROCESS_POWERS = (250, 200, 165, 60, 85, 130, 95, 38)


def full_horizon_request(horizon_hours=168):
    solar = {
        hour: (0.4 if hour == 30 else 0.2)
        for hour in range(horizon_hours)
    }
    tariff = {
        hour: (
            0.165 if 128 <= hour < 140
            else 0.218 if hour % 24 >= 17
            else 0.142 if hour % 24 >= 7
            else 0.085
        )
        for hour in range(horizon_hours)
    }
    return {
        "factory": {
            "factory_name": "Mock Chocolate Seven-Day Test",
            "planning_horizon_hours": horizon_hours,
            "production_deadline": horizon_hours,
            "processes": [
                {
                    "process_id": f"process-{index}",
                    "process_name": f"Mock Process {index}",
                    "duration_hours": duration / TIME_SCALE,
                    "power_kw": PROCESS_POWERS[index],
                    "dependencies": (
                        [f"process-{index - 1}"] if index else []
                    ),
                    "is_flexible": True,
                    "machine_id": f"machine-{index}",
                }
                for index, duration in enumerate(PROCESS_DURATIONS)
            ],
            "machines": [
                {
                    "machine_id": f"machine-{index}",
                    "machine_name": f"Mock Machine {index}",
                    "capacity": 1,
                }
                for index in range(len(PROCESS_DURATIONS))
            ],
        },
        "energy": {
            "solar_profile": {
                str(hour): value for hour, value in solar.items()
            },
            "tariff_profile": {
                str(hour): value for hour, value in tariff.items()
            },
        },
        "options": {"objective": "cost", "max_time_seconds": 10},
    }


class FullHorizonProfileTests(unittest.TestCase):
    def test_legacy_24_hour_profiles_still_repeat_cyclically(self):
        request = full_horizon_request()
        request["energy"]["solar_profile"] = {
            str(hour): 0.2 for hour in range(24)
        }
        request["energy"]["tariff_profile"] = {
            str(hour): 0.1 for hour in range(24)
        }

        config = validate_user_input(request)

        self.assertEqual(get_solar_availability(25, config.energy["solar_profile"]), 0.2)
        self.assertEqual(get_tariff(25, config.energy["tariff_profile"]), 0.1)
        self.assertTrue(any("cyclically repeated" in warning for warning in config.warnings))

    def test_full_horizon_profiles_preserve_each_elapsed_hour(self):
        config = validate_user_input(full_horizon_request())

        self.assertEqual(len(config.energy["solar_profile"]), 168)
        self.assertEqual(len(config.energy["tariff_profile"]), 168)
        self.assertEqual(get_solar_availability(30, config.energy["solar_profile"]), 0.4)
        self.assertEqual(get_solar_availability(54, config.energy["solar_profile"]), 0.2)
        self.assertEqual(get_tariff(127, config.energy["tariff_profile"]), 0.142)
        self.assertEqual(get_tariff(128, config.energy["tariff_profile"]), 0.165)
        self.assertEqual(get_tariff(161, config.energy["tariff_profile"]), 0.218)
        self.assertFalse(any("cyclically repeated" in warning for warning in config.warnings))

    def test_mixed_profiles_and_incomplete_full_horizon_profiles_are_rejected(self):
        mixed = full_horizon_request()
        mixed["energy"]["solar_profile"] = {
            str(hour): 0.2 for hour in range(24)
        }
        with self.assertRaisesRegex(InputValidationError, "must both use"):
            validate_user_input(mixed)

        missing = full_horizon_request()
        del missing["energy"]["solar_profile"]["167"]
        with self.assertRaisesRegex(InputValidationError, "full-horizon keys"):
            validate_user_input(missing)

        extra = full_horizon_request()
        extra["energy"]["tariff_profile"]["168"] = 0.1
        with self.assertRaisesRegex(InputValidationError, "full-horizon keys"):
            validate_user_input(extra)

    def test_full_horizon_serial_dp_uses_elapsed_hour_costs_and_verifies(self):
        config = validate_user_input(full_horizon_request())
        baseline = create_baseline_schedule(
            config,
            solar_profile=config.energy["solar_profile"],
            tariff_profile=config.energy["tariff_profile"],
            max_time_seconds=10,
        )
        process = config.get_process("process-0")
        start_minute = 30 * TIME_SCALE
        table = _serial_process_cost_by_start(
            process,
            config.energy["solar_profile"],
            config.energy["tariff_profile"],
            start_minute,
            lambda: None,
        )
        demand_units = int(process.power_kw * (SOLAR_SCALE // TIME_SCALE))
        expected = 0
        for minute in range(start_minute, start_minute + process.duration_minutes):
            hour = minute // TIME_SCALE
            solar_units = int(
                min(get_solar_availability(hour, config.energy["solar_profile"]),
                    process.power_kw)
                * (SOLAR_SCALE // TIME_SCALE)
            )
            tariff_units = int(round(
                get_tariff(hour, config.energy["tariff_profile"]) * COST_SCALE
            ))
            expected += tariff_units * (demand_units - solar_units)
        self.assertEqual(table[start_minute], expected)

        with patch(
            "optimizer.optimizer._build_base_model",
            side_effect=AssertionError("the guarded serial DP should handle this chain"),
        ):
            optimized = create_cost_optimized_schedule(
                config,
                baseline_schedule=baseline,
                solar_profile=config.energy["solar_profile"],
                tariff_profile=config.energy["tariff_profile"],
                max_time_seconds=10,
            )

        self.assertEqual(optimized["status"], "OPTIMAL")
        verify_schedule(config, optimized, baseline=baseline)


if __name__ == "__main__":
    unittest.main()
