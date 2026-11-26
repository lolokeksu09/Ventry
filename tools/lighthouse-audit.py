#!/usr/bin/env python3
"""Lighthouse lab evidence: complete page coverage and same-runner baseline.

No public telemetry, no production requests. Scores are diagnostic on first run;
execution failures and any automated accessibility findings fail CI.
"""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import subprocess
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "http://127.0.0.1:18765"
GROUPS = {
    "mobile-core": ("/", "/projects/raschet/", "/raschet/", "/docs/", "/support/", "/contact/"),
    "mobile-resources": ("/about/", "/approach/", "/projects/", "/releases/", "/legal/", "/privacy/", "/status/", "/explore/"),
    "desktop-core": ("/", "/projects/raschet/", "/raschet/"),
}
CORE = {"/", "/projects/raschet/", "/raschet/", "/docs/", "/contact/"}
METRICS = ("first-contentful-paint", "largest-contentful-paint", "cumulative-layout-shift", "total-blocking-time", "speed-index")

@contextmanager
def preview(root):
    process = subprocess.Popen(["python3", str(root/"tests/serve-preview.py")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError("Preview exited before readiness")
            try:
                with urlopen(ORIGIN+"/healthz", timeout=1) as response:
                    if response.status == 200 and response.read().strip() == b"ok":
                        break
            except OSError:
                time.sleep(.25)
        else:
            raise RuntimeError("Preview did not become ready")
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()

def scan(route, desktop, output, full):
    name = route.strip("/").replace("/", "-") or "home"
    report = output/(name+".json")
    categories = "performance,accessibility,best-practices,seo" if full else "accessibility,seo"
    command = ["lighthouse", ORIGIN+route, "--quiet", "--output=json",
               "--output-path="+str(report), "--only-categories="+categories,
               "--chrome-flags=--headless --no-sandbox --disable-dev-shm-usage"]
    if desktop:
        command.append("--preset=desktop")
    subprocess.run(command, check=True, timeout=180)
    data = json.loads(report.read_text(encoding="utf-8"))
    if data.get("runtimeError"):
        raise RuntimeError(f"Lighthouse runtime error on {route}: {data['runtimeError']}")
    if not data.get("categories") or "accessibility" not in data["categories"]:
        raise RuntimeError(f"Missing accessibility report: {route}")
    if data.get("requestedUrl") != ORIGIN+route:
        raise RuntimeError("Unexpected report URL")
    audits = data["audits"]
    failures = []
    for ref in data["categories"]["accessibility"]["auditRefs"]:
        item = audits[ref["id"]]
        score = item.get("score")
        if score is not None and score < 1:
            failures.append({"id":ref["id"], "title":item.get("title"),
                             "nodes": [node.get("node",{}).get("selector") for node in item.get("details",{}).get("items",[]) if isinstance(node,dict)]})
    summary = {"route":route, "lighthouse_version":data["lighthouseVersion"],
               "scores":{k:v.get("score") for k,v in data["categories"].items()},
               "metrics":{k:audits[k].get("numericValue") for k in METRICS if k in audits},
               "accessibility_findings":failures}
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    return summary

def run(root, routes, desktop, output):
    output.mkdir(parents=True,exist_ok=True)
    with preview(root):
        return [scan(route,desktop,output,route in CORE) for route in routes]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group",choices=GROUPS,required=True)
    parser.add_argument("--baseline",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True,exist_ok=True)
    desktop = args.group.startswith("desktop")
    routes = GROUPS[args.group]
    baseline_routes = [r for r in routes if r in {"/","/projects/raschet/","/raschet/"}]
    baseline = run(args.baseline.resolve(),baseline_routes,desktop,output/"baseline") if baseline_routes else []
    candidate = run(ROOT,routes,desktop,output/"candidate")
    previous = {r["route"]:r for r in baseline}
    regressions = []
    for entry in candidate:
        if entry["route"] in previous:
            before = {v["id"] for v in previous[entry["route"]]["accessibility_findings"]}
            added = [v for v in entry["accessibility_findings"] if v["id"] not in before]
            if added:
                regressions.append({"route":entry["route"],"new_findings":added})
    report = {"scope":"Lighthouse local Chromium laboratory; no field INP or real-user Core Web Vitals",
              "group":args.group,"baseline":baseline,"candidate":candidate,
              "accessibility_regressions":regressions,
              "review_required":any(r["accessibility_findings"] for r in candidate),
              "manual_checks_required":["screen reader","keyboard interaction beyond automated smoke","200% text enlargement","real device verification"]}
    (output/"summary.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    if regressions:
        raise SystemExit("FAIL: new automated accessibility findings on baseline-matched routes")
    if report["review_required"]:
        raise SystemExit("FAIL: automated accessibility findings remain; inspect summary.json")
    print("PASS: automated accessibility checks; manual checks still required",flush=True)

if __name__ == "__main__":
    main()
