"""Reproducible evaluation of the BioSync meal-analysis policy (biosync-iauc-v1).

Run from the backend/ directory:  python benchmarks/benchmark_analysis.py

Part A - correctness: compares backend iAUC with an independent trapezoidal
         reference implementation on the known fixture and on random curves.
Part B - performance: times meal_analysis.analyze_meal (policy checks +
         iAUC, no network or LLM) for several input sizes.
Part C - optional: times POST /v1/analyses through the Flask test client in
         mock LLM mode (validation + policy + iAUC + mock feedback).
The measurement plan (sizes, warm-up, repetitions, seeds) is fixed below
before any measurement is taken.
"""

from __future__ import annotations

import json
import os
import platform
import random
import statistics
import sys
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from biosync.services import meal_analysis as m  # noqa: E402

# ---- measurement plan (defined before measuring) -------------------------
SIZES = [50, 150, 500, 5000]  # 3-min CGM, 1-min CGM, M1 bound, stress
WARMUP = 5
RUNS = 50
SEEDS = [1, 2, 3]
RANDOM_CURVES = 300
MEAL_AT = datetime(2026, 10, 9, 0, 0, tzinfo=UTC)


def curve(minute: float, rng: random.Random, base: float, peak: float) -> float:
    """Plausible post-meal shape: rise to a peak near 45 min, then decline."""
    if minute < 0:
        rise = 0.0
    elif minute <= 45:
        rise = (peak - base) * (minute / 45)
    else:
        rise = max(-0.6, (peak - base) * (1 - (minute - 45) / 70))
    return round(base + rise + rng.uniform(-0.15, 0.15), 1)


def readings(n: int, rng: random.Random, base=5.5, peak=8.5):
    """n readings evenly spread over the app query window [-15, +135) min."""
    step = 150 * 60 / n
    phase = rng.uniform(0.1, 0.9) * step
    out = []
    for i in range(n):
        t = MEAL_AT - timedelta(minutes=15) + timedelta(seconds=phase + i * step)
        minute = (t - MEAL_AT).total_seconds() / 60
        out.append(m.GlucoseRecord(measured_at=t, value_mmol_l=curve(minute, rng, base, peak),
                                   source_record_id=f"r{i}"))
    return out


def reference_iauc(recs, meal_at):
    """Independent positive-incremental trapezoid (Brouns et al., 2005 style)."""
    pts = sorted((r.measured_at, float(r.value_mmol_l)) for r in recs)
    base = statistics.mean(v for t, v in pts if meal_at - timedelta(minutes=15) <= t < meal_at)
    end = meal_at + timedelta(minutes=120)
    seq = [(0.0, base)]
    after = [(t, v) for t, v in pts if t > meal_at]
    for t, v in after:
        if t < end:
            seq.append(((t - meal_at).total_seconds() / 60, v))
        else:
            t0, v0 = seq[-1]
            if t == end:
                seq.append((120.0, v))
            else:
                x = (t - meal_at).total_seconds() / 60
                seq.append((120.0, v0 + (v - v0) * (120 - t0) / (x - t0)))
            break
    area = 0.0
    for (t0, y0), (t1, y1) in zip(seq, seq[1:]):
        d0, d1, dt = y0 - base, y1 - base, t1 - t0
        if d0 >= 0 and d1 >= 0:
            area += (d0 + d1) / 2 * dt
        elif d0 > 0 > d1:
            area += d0 * d0 / (d0 - d1) * dt / 2
        elif d1 > 0 > d0:
            area += d1 * d1 / (d1 - d0) * dt / 2
    return area


def pct(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, round(p / 100 * (len(s) - 1)))]


def main():
    report = {"environment": {"python": platform.python_version(), "platform": platform.platform(),
                              "processor": platform.processor() or platform.machine()}}

    # Part A - correctness
    fixture = json.loads((Path(__file__).resolve().parents[2] / "mobile/src/dev/analysisFixture.json").read_text())
    fx = [m.GlucoseRecord(measured_at=datetime.fromisoformat(r["measured_at"].replace("Z", "+00:00")),
                          value_mmol_l=r["value_mmol_l"], source_record_id=r["source_record_id"])
          for r in fixture["readings"]]
    fx_meal = datetime.fromisoformat(fixture["meal_at"].replace("Z", "+00:00"))
    got = m.analyze_meal(fx, fx_meal).iauc_mmol_l_min
    errors = []
    rng = random.Random(2026)
    for _ in range(RANDOM_CURVES):
        recs = readings(rng.choice([40, 50, 75, 150]), rng, base=rng.uniform(4.5, 6.5), peak=rng.uniform(5.0, 11.0))
        b = m.analyze_meal(recs, MEAL_AT).iauc_mmol_l_min
        r = reference_iauc(recs, MEAL_AT)
        errors.append(abs(b - r) / r * 100 if r > 0 else abs(b - r))
    report["correctness"] = {"fixture_backend": got, "fixture_hand_calculation": 225.0,
                             "random_curves": RANDOM_CURVES, "max_relative_error_pct": max(errors)}

    # Part B - analyze_meal performance
    perf = []
    for n in SIZES:
        times = []
        for seed in SEEDS:
            recs = readings(n, random.Random(seed))
            for _ in range(WARMUP):
                m.analyze_meal(recs, MEAL_AT)
            for _ in range(RUNS):
                t = time.perf_counter()
                m.analyze_meal(recs, MEAL_AT)
                times.append((time.perf_counter() - t) * 1000)
        perf.append({"readings": n, "runs": len(times), "median_ms": statistics.median(times),
                     "mean_ms": statistics.mean(times), "sd_ms": statistics.stdev(times),
                     "p95_ms": pct(times, 95), "max_ms": max(times)})
    report["analyze_meal"] = perf

    # Part C - optional full Flask request path in mock mode
    try:
        os.environ["BIOSYNC_LLM_MODE"] = "mock"
        from biosync.app import create_app
        client = create_app().test_client()
        body = dict(fixture)
        times = []
        for i in range(WARMUP + RUNS):
            t = time.perf_counter()
            resp = client.post("/v1/analyses", json=body)
            if i >= WARMUP:
                times.append((time.perf_counter() - t) * 1000)
            assert resp.status_code == 200
        report["flask_mock_request"] = {"runs": len(times), "median_ms": statistics.median(times),
                                        "p95_ms": pct(times, 95), "max_ms": max(times)}
    except ImportError as exc:
        report["flask_mock_request"] = f"skipped: {exc.name} not installed"

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
