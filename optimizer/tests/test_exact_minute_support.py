import unittest
from contextlib import redirect_stdout
from io import StringIO

from optimizer.input_layer import validate_user_input
from optimizer.optimizer import create_baseline_schedule
from optimizer.public_api import get_input_schema, optimize_request
from optimizer.visualization import render_gantt


def _request(durations, dependencies=None):
    dependencies = dependencies or [[] for _ in durations]
    return {
        "factory": {
            "factory_name": "Exact Minute Test Factory",
            "planning_horizon_hours": 2,
            "production_deadline": 2,
            "processes": [
                {
                    "process_id": f"process-{index}",
                    "duration_hours": duration / 60,
                    "power_kw": 0.2,
                    "dependencies": dependencies[index],
                    "machine_id": "machine-1",
                }
                for index, duration in enumerate(durations)
            ],
            "machines": [{
                "machine_id": "machine-1",
                "machine_name": "Test Machine",
                "capacity": 1,
            }],
        },
        "energy": {
            "solar_profile": {str(hour): 0.2 for hour in range(24)},
            "tariff_profile": {str(hour): 0.1 for hour in range(24)},
        },
        "options": {
            "objective": "cost",
            "max_time_seconds": 5,
        },
    }


class ExactMinuteSupportTests(unittest.TestCase):
    def test_input_schema_documents_whole_minute_duration_without_half_hour_multiple(self):
        duration_schema = (
            get_input_schema()["properties"]["factory"]["properties"]
            ["processes"]["items"]["properties"]["duration_hours"]
        )

        self.assertNotIn("multipleOf", duration_schema)
        self.assertIn("whole-minute", duration_schema["description"])

    def test_public_api_preserves_exact_supported_durations(self):
        for duration in (25, 30, 35, 40, 45, 60):
            with self.subTest(duration_minutes=duration):
                result = optimize_request(_request([duration]))

                self.assertIn(result["status"], {"OPTIMAL", "FEASIBLE"})
                optimized = result["result"]["optimized"]
                row = optimized["processes"][0]
                self.assertEqual(row["duration_hours"], duration / 60)
                self.assertAlmostEqual(
                    row["end_time"] - row["start_time"],
                    duration / 60,
                    places=12,
                )
                self.assertAlmostEqual(
                    row["solar_kwh"] + row["grid_kwh"],
                    0.2 * duration / 60,
                    places=12,
                )
                self.assertTrue((row["start_time"] * 60).is_integer())
                self.assertTrue((row["end_time"] * 60).is_integer())

    def test_dependency_finish_and_successor_start_remain_exact(self):
        result = optimize_request(_request(
            [25, 35],
            dependencies=[[], ["process-0"]],
        ))

        self.assertIn(result["status"], {"OPTIMAL", "FEASIBLE"})
        rows = {
            row["process_id"]: row
            for row in result["result"]["optimized"]["processes"]
        }
        predecessor = rows["process-0"]
        successor = rows["process-1"]
        self.assertAlmostEqual(
            predecessor["end_time"] - predecessor["start_time"], 25 / 60, places=12
        )
        self.assertAlmostEqual(
            successor["end_time"] - successor["start_time"], 35 / 60, places=12
        )
        self.assertGreaterEqual(successor["start_time"], predecessor["end_time"])
        self.assertEqual(successor["start_time"], predecessor["end_time"])

    def test_public_response_json_round_trip_preserves_exact_schedule_times(self):
        import json

        result = optimize_request(_request([25]))
        decoded = json.loads(json.dumps(result))
        row = decoded["result"]["optimized"]["processes"][0]

        self.assertEqual(row["duration_hours"], 25 / 60)
        self.assertAlmostEqual(
            row["end_time"] - row["start_time"],
            25 / 60,
            places=12,
        )

    def test_gantt_labels_retain_exact_minute_times(self):
        schedule = create_baseline_schedule(validate_user_input(_request([25])))
        output = StringIO()

        with redirect_stdout(output):
            render_gantt(schedule)

        self.assertIn("0:00  0:25  0:25", output.getvalue())

    def test_rejects_zero_negative_and_fractional_minute_durations(self):
        for duration in (0, -1 / 60, 25.5 / 60, 1 / 7, 25 / 60 + 1e-10):
            with self.subTest(duration_hours=duration):
                result = optimize_request(_request([duration]))

                self.assertEqual(result["status"], "INVALID INPUT")
                self.assertTrue(result["errors"])



        for duration in (True, "25/60", float("nan"), float("inf")):
            with self.subTest(duration_hours=duration):
                request = _request([25])
                request["factory"]["processes"][0]["duration_hours"] = duration
                result = optimize_request(request)

                self.assertEqual(result["status"], "INVALID INPUT")
                self.assertTrue(result["errors"])


if __name__ == "__main__":
    unittest.main()
