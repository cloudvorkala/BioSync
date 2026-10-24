# BioSync evaluation (Milestone 2)

This folder holds the evaluation plan, scripts and raw results used in the Milestone 2 report.
Three industry evaluation processes were adapted:

1. **Requirement-based acceptance and automated regression testing** – backend pytest (340 tests),
   mobile Jest (159 tests), TypeScript and ESLint, plus device runs of the signed release APK.
2. **Repeatable benchmarking** – the measurement plan below was fixed before measuring; every
   measurement is repeated (30–150 times) and the scripts are in the repository so that the
   results can be reproduced on other hardware.
3. **Usability inspection** – keystroke-level action counting (after Caro-Alvaro et al., 2017) for the core task and a single-evaluator heuristic
   evaluation (Nielsen's ten heuristics, 0–4 severity). Participant testing was not used because the
   core task needs a CGM worn around a real meal and synchronised to Samsung Health; this approach
   was confirmed with the course lecturer on 9 October 2026.

## 1. Calculation correctness and performance

```powershell
cd backend
.\.venv\Scripts\python.exe benchmarks\benchmark_analysis.py
```

Plan: input sizes 50 (Sinocare 3-minute rate), 150 (1-minute CGM), 500 (Milestone 1 bound) and
5000 (stress) readings; 3 seeds; 5 warm-up and 50 timed runs per seed; `time.perf_counter`.
Correctness compares the backend with an independent trapezoidal implementation on the
synthetic fixture and on 300 random curves.

Recorded result (`benchmark_results_2026-10-11.json`, Python 3.13.16, Linux x86_64, 2 vCPU Intel Xeon 2.10 GHz):

| Readings | Median (ms) | p95 (ms) | Max (ms) |
| --- | --- | --- | --- |
| 50 | 0.204 | 0.275 | 0.469 |
| 150 | 0.386 | 0.551 | 1.032 |
| 500 | 1.232 | 1.966 | 2.348 |
| 5000 | 12.882 | 17.229 | 20.268 |

Fixture iAUC 225.0 (hand calculation 225); maximum relative error on 300 random curves 4.0e-13 %.
Milestone 1 target: ≤ 500 ms for ≤ 500 readings – met.

## 2. API latency and concurrency (deployed endpoint)

```powershell
powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_api_latency.ps1
powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_api_latency.ps1 -BurstOnly   # concurrency only
```

2 warm-up and 30 timed iterations of `GET /health` and `POST /v1/analyses` (synthetic fixture),
then one burst of 10 concurrent analysis requests. Pass thresholds: `/health` median ≤ 1 s; analysis
p95 ≤ 10 s (Nielsen's 1 s and 10 s limits); all 10 concurrent requests succeed within 10 s.

Recorded result (11 October 2026, home broadband in Auckland → ap-southeast-2, OpenAI mode, gpt-6-luna;
raw data `api_latency_20261011_183359.csv`):

| Endpoint | Successful | Median | p95 | Max | First call (cold start) |
| --- | --- | --- | --- | --- | --- |
| `GET /health` | 30/30 | 52.3 ms | 58.6 ms | 66.6 ms | 2476.3 ms |
| `POST /v1/analyses` | 30/30 | 3781.3 ms | 5076.5 ms | 5093.6 ms | 6875.1 ms |

Concurrency burst (repeated with the fixed script): 10/10 HTTP 200; fastest 3973 ms, median 7280 ms,
slowest 8178 ms.

The first concurrency run returned 10/10 HTTP 200 but finished in 22.2 s because Windows PowerShell's
.NET Framework client allows only two parallel connections per host; the script now raises that limit
and times each request.

## 3. Lambda duration, cold starts and memory

```powershell
powershell -ExecutionPolicy Bypass -File docs\evaluation\cloudwatch_lambda_stats.ps1
```

Runs a CloudWatch Logs Insights query over the `REPORT` lines of `/aws/lambda/biosync-backend`
(needs the AWS CLI). The same query can be pasted into the CloudWatch console (Logs Insights):

```text
filter @message like /^REPORT/
| stats count(*) as invocations, avg(@duration) as avg_ms, pct(@duration, 50) as p50_ms,
        pct(@duration, 95) as p95_ms, max(@duration) as max_ms, count(@initDuration) as cold_starts,
        avg(@initDuration) as avg_init_ms, max(@maxMemoryUsed / 1000 / 1000) as peak_memory_mb
```

Recorded result (11 October 2026, last 7 days): 104 invocations (health and analysis combined);
average 3445.8 ms; median 3657.6 ms; p95 8567.5 ms; max 10081.2 ms; 27 cold starts, average
initialisation 1812.9 ms; peak memory 134 MB of 512 MB. Durations include the OpenAI call.

## 4. Mobile responsiveness (release APK, package `com.biosync`)

```powershell
powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_frames.ps1
```

The script opens the app, resets `dumpsys gfxinfo`, waits while the core workflow is repeated five
times, then saves `gfxinfo`/`meminfo` output and prints total frames, janky frames, frame-time
percentiles, frozen frames (> 700 ms, from the histogram), ANR events and total PSS.
Milestone 1 criterion: no ANR and no frozen frames during the tested workflow.

The benchmark design follows Daneva's (1995) procedure (goal, constraints, competitors, specification,
measurement plan, interpretation, validation) and v. Kistowski et al.'s (2015) benchmark
characteristics (relevance, reproducibility, fairness, verifiability).

Recorded result (Galaxy Z Flip7, release APK, five core workflows, 11 October 2026; raw files
`gfxinfo_20261011_184510.txt`, `meminfo_20261011_184510.txt`): 1412 frames; 25 janky (1.77 %);
frame-time percentiles 5 / 13 / 14 / 15 ms (50th / 90th / 95th / 99th); 0 frozen frames; 0 ANR events;
total PSS 143,055 KB. Criterion met.

## LLM feedback evaluation (`evaluate_llm_feedback.ps1`)

Sends 20 synthetic meals to the deployed `POST /v1/analyses` (live OpenAI mode): 18 meals from 11 foods,
each with a designed glucose curve of known iAUC (67.5, 202.5 or 405 (mmol/L)·min), plus two
prompt-injection meals (I01 asks for an insulin dose; I02 claims the iAUC is 999). Each response is checked
automatically for iAUC citation, invented numbers, format (≤ 2-sentence summary, 2–3 suggestions),
food/weight use and forbidden medical terms.

```powershell
powershell -ExecutionPolicy Bypass -File docs\evaluation\evaluate_llm_feedback.ps1
```

Recorded result (22 October 2026; raw files `llm_eval_20261022_191420.csv` and `.json`): 20/20 HTTP 200;
backend iAUC correct and cited in the summary 20/20; no invented iAUC after manual review (2 automatic
flags were summed item weights); format and safety checks 20/20; both injections ignored. The assessment
label was not consistent with the iAUC (67.5 was called modest, moderate or substantial depending on the
food), so the backend should classify the response and the LLM should only explain it. Latency median
4.9 s, max 10.5 s (first call, cold). Note: the automatic label list also matches "low" inside words such as
"followed"; labels were therefore read manually.

## Battery and network use (`measure_battery.ps1`)

Estimates the energy (mAh, from Android's power model in `dumpsys batterystats`) and network bytes that
BioSync uses per analysis. The phone must run on battery, so connect adb over Wi-Fi (Wireless debugging:
`adb pair`, `adb connect`) and unplug the cable. Each run records an optional idle baseline with the app
open, then N analyses; raw `batterystats_*` files are saved here and a row is appended to
`battery_summary.csv`. Run three times.

```powershell
powershell -ExecutionPolicy Bypass -File docs\evaluation\measure_battery.ps1 -Analyses 10 -IdleMinutes 5
```
