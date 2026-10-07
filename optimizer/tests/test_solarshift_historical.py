import unittest
from datetime import datetime

from optimizer.solarshift_historical import (
    COST_DENOMINATOR,
    ENERGY_SCALE,
    ScenarioInputError,
    _minute_tariff,
    _prepare_tariffs,
    solve_scenario,
)


PROCESS_SPECS = (
    ("roast", 120, "250.0000"),
    ("grind", 60, "200.0000"),
    ("conche", 300, "165.0000"),
    ("age", 720, "60.0000"),
    ("temper", 60, "85.0000"),
    ("mould", 60, "130.0000"),
    ("cool", 30, "95.0000"),
    ("pack", 30, "38.0000"),
)


def tariff_rows(regime):
    peak = "7.80" if regime == "HGD" else "7.30"
    months = [3] if regime == "HGD" else [1]
    return [
        {
            "regime": regime,
            "band": band,
            "currency": "INR",
            "energy_basis": "kVAh",
            "energy_price": price or peak,
            "start_time": start,
            "end_time": end,
            "effective_from": "2025-04-01",
            "effective_to": "2026-04-01",
            "effective_months": months,
        }
        for band, start, end, price in (
            ("off_peak", "00:00", "06:00", "5.55"),
            ("peak", "06:00", "10:00", None),
            ("off_peak", "10:00", "15:00", "5.55"),
            ("normal", "15:00", "18:00", "6.30"),
            ("peak", "18:00", "22:00", None),
            ("normal", "22:00", "00:00", "6.30"),
        )
    ]


def tariff_payload(regime, rows=None):
    return {
        "power_factor_ratio": "19/20",
        "tariffs": tariff_rows(regime) if rows is None else rows,
    }


def scenario_input(regime="HGD", solar_value="0.00"):
    processes = [
        {
            "id": f"process-{slug}",
            "machine_id": f"machine-{index % 6}",
            "duration_minutes": duration,
            "power_kw": power,
        }
        for index, (slug, duration, power) in enumerate(PROCESS_SPECS)
    ]
    dependencies = [
        {
            "process_id": processes[index + 1]["id"],
            "depends_on_process_id": processes[index]["id"],
            "dependency_type": "finish_to_start",
            "lag_minutes": 0,
        }
        for index in range(7)
    ]
    return {
        "regime": regime,
        "horizon_start": "2026-03-11T11:00:00Z",
        "hourly_resource_wh_m2": [solar_value] * 168,
        "power_factor_ratio": "19/20",
        "tariffs": tariff_rows(regime),
        "processes": processes,
        "dependencies": dependencies,
        "max_time_seconds": 30,
    }


class SolarShiftHistoricalTests(unittest.TestCase):
    def test_tariff_windows_use_exact_kolkata_minute_boundaries(self):
        samples = (
            ("2026-03-12T00:30:00+00:00", "peak", 156),
            ("2026-03-12T04:30:00+00:00", "off_peak", 111),
            ("2026-03-12T09:30:00+00:00", "normal", 126),
            ("2026-03-12T12:30:00+00:00", "peak", 156),
            ("2026-03-12T16:30:00+00:00", "normal", 126),
            ("2026-03-12T18:30:00+00:00", "off_peak", 111),
        )
        prepared = _prepare_tariffs(tariff_payload("HGD"), "HGD")
        for timestamp, expected_band, expected_rate in samples:
            with self.subTest(timestamp=timestamp):
                self.assertEqual(
                    _minute_tariff(datetime.fromisoformat(timestamp), "HGD", prepared),
                    (expected_band, expected_rate),
                )

    def test_lgd_peak_numerator_is_season_specific(self):
        prepared = _prepare_tariffs(tariff_payload("LGD"), "LGD")
        self.assertEqual(
            _minute_tariff(datetime.fromisoformat("2026-01-12T00:30:00+00:00"), "LGD", prepared),
            ("peak", 146),
        )

    def test_objective_consumes_only_verified_persisted_kvah_tariffs(self):
        invalid = tariff_rows("HGD")
        invalid[0]["energy_basis"] = "kWh"
        with self.assertRaisesRegex(ScenarioInputError, "INR, and kVAh"):
            _prepare_tariffs(tariff_payload("HGD", invalid), "HGD")

        invalid = tariff_rows("HGD")
        invalid[1]["energy_price"] = "0.01"
        with self.assertRaisesRegex(ScenarioInputError, "does not match"):
            _prepare_tariffs(tariff_payload("HGD", invalid), "HGD")

    def test_solve_emits_valid_baseline_and_cost_optimized_schedule(self):
        result = solve_scenario(scenario_input())

        self.assertIn(result["status"], {"OPTIMAL", "FEASIBLE"})
        self.assertEqual(len(result["baseline"]["entries"]), 8)
        self.assertEqual(len(result["optimized"]["entries"]), 8)
        self.assertEqual(result["energy_scale"], ENERGY_SCALE)
        self.assertEqual(result["cost_scale"], COST_DENOMINATOR)
        self.assertLessEqual(
            int(result["optimized"]["metrics"]["cost_numerator"]),
            int(result["baseline"]["metrics"]["cost_numerator"]),
        )
        self.assertEqual(
            result["optimized"]["metrics"]["total_energy_units"],
            "1515900000",
        )
        self.assertLess(
            int(result["maximum_cost_units_checked"]) * (7 * 24 * 60 + 1),
            (1 << 63) - 1,
        )

    def test_modeled_solar_allocates_at_exact_energy_scale(self):
        result = solve_scenario(scenario_input(solar_value="1000.00"))
        self.assertGreater(int(result["optimized"]["metrics"]["total_solar_units"]), 0)
        self.assertEqual(
            int(result["optimized"]["metrics"]["total_energy_units"]),
            int(result["optimized"]["metrics"]["total_solar_units"])
            + int(result["optimized"]["metrics"]["total_grid_units"]),
        )

    def test_rejects_incomplete_or_unrepresentable_resource_values(self):
        incomplete = scenario_input()
        incomplete["hourly_resource_wh_m2"] = incomplete["hourly_resource_wh_m2"][:-1]
        with self.assertRaisesRegex(ScenarioInputError, "exactly 168"):
            solve_scenario(incomplete)

        invalid = scenario_input()
        invalid["hourly_resource_wh_m2"][0] = "-999.00"
        with self.assertRaisesRegex(ScenarioInputError, "non-negative decimal string"):
            solve_scenario(invalid)

        over_precise = scenario_input()
        over_precise["hourly_resource_wh_m2"][0] = "0.00123"
        with self.assertRaisesRegex(ScenarioInputError, "non-negative decimal string"):
            solve_scenario(over_precise)


if __name__ == "__main__":
    unittest.main()
