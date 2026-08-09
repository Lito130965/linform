"""Measure what one instance actually does under load.

Answers the first question anyone asks before adopting a render service: how
many PDFs per second, how slow is the slow end, and at what point does it start
refusing work. The numbers in the README come from this script, not from a
guess.

    python scripts/loadtest.py http://localhost:8100 invoice --concurrency 8

It is deliberately dependency-free (stdlib threads and urllib) so it can be run
straight from the image against a running instance.
"""

import argparse
import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def one_render(url: str, payload: bytes, token: str | None) -> tuple[int, float]:
    request = urllib.request.Request(url, data=payload, method="POST")
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        exc.read()
        status = exc.code
    except Exception:
        status = 0
    return status, time.perf_counter() - started


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round((p / 100) * (len(ordered) - 1))))
    return ordered[index]


def run(base: str, code: str, data: dict, concurrency: int, total: int, token: str | None):
    url = f"{base.rstrip('/')}/api/render/{code}"
    payload = json.dumps(data).encode()

    started = time.perf_counter()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        results = list(pool.map(lambda _: one_render(url, payload, token), range(total)))
    wall = time.perf_counter() - started

    by_status: dict[int, list[float]] = {}
    for status, seconds in results:
        by_status.setdefault(status, []).append(seconds)

    ok = by_status.get(200, [])
    refused = by_status.get(429, [])
    # Throughput and refusals are different measurements and must not be read
    # as one number. Once the ceiling starts shedding load, most requests come
    # back in milliseconds, the run ends almost immediately, and "documents
    # divided by wall clock" stops describing sustained throughput — it
    # describes a handful of renders divided by half a second. So the refused
    # share is reported beside it, and how fast a refusal came back, which is
    # the thing that actually matters about backpressure.
    return {
        "concurrency": concurrency,
        "requests": total,
        "wall_seconds": round(wall, 2),
        "ok": len(ok),
        "rejected_429": len(refused),
        "refused_pct": round(100 * len(refused) / total, 1) if total else 0,
        "refusal_ms_median": round(percentile(refused, 50) * 1000, 1) if refused else None,
        "timeout_504": len(by_status.get(504, [])),
        "other": {s: len(v) for s, v in by_status.items() if s not in (200, 429, 504)},
        "throughput_pdf_per_s": round(len(ok) / wall, 2) if wall else 0,
        # True only while nothing was refused; past the ceiling the run is too
        # short for the figure above to mean "per second" in the usual sense.
        "throughput_is_sustained": not refused,
        "latency_ms": {
            "mean": round(statistics.fmean(ok) * 1000, 1) if ok else None,
            "p50": round(percentile(ok, 50) * 1000, 1) if ok else None,
            "p95": round(percentile(ok, 95) * 1000, 1) if ok else None,
            "max": round(max(ok) * 1000, 1) if ok else None,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url")
    parser.add_argument("template_code")
    parser.add_argument("--data", default="{}", help="JSON payload, or @file")
    parser.add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4, 8, 16])
    parser.add_argument("--requests", type=int, default=40)
    parser.add_argument("--token", default=None)
    args = parser.parse_args()

    raw = args.data
    if raw.startswith("@"):
        with open(raw[1:], encoding="utf-8") as handle:
            raw = handle.read()
    data = json.loads(raw)

    print(
        f"{'conc':>5} {'ok':>5} {'refused':>9} {'refus.ms':>9} {'504':>5} "
        f"{'pdf/s':>7} {'p50':>8} {'p95':>8} {'max':>8}"
    )
    rows = []
    for concurrency in args.concurrency:
        row = run(args.base_url, args.template_code, data, concurrency, args.requests, args.token)
        rows.append(row)
        lat = row["latency_ms"]
        # A star marks the rows where the throughput figure is not a sustained
        # rate: the ceiling shed most of the load and the run was over in
        # milliseconds. Reading those two numbers as one column is the mistake
        # this column layout exists to prevent.
        rate = f"{row['throughput_pdf_per_s']}{'' if row['throughput_is_sustained'] else '*'}"
        print(
            f"{row['concurrency']:>5} {row['ok']:>5} "
            f"{str(row['refused_pct']) + '%':>9} {str(row['refusal_ms_median'] or '-'):>9} "
            f"{row['timeout_504']:>5} {rate:>7} "
            f"{lat['p50'] or 0:>8} {lat['p95'] or 0:>8} {lat['max'] or 0:>8}"
        )
        if row["other"]:
            print(f"      other statuses: {row['other']}", file=sys.stderr)
        # Let the pool drain so the next step starts from an idle instance.
        time.sleep(2)

    print("\n" + json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
