"""Triage — fixture freeze check (test oracle, never product code).

Regenerates the tickets and answer keys with the pinned seed into a temporary directory, re-runs
the scripted model there, compares every sha256 with fixtures/MANIFEST.json, regenerates the
reference decisions when fixtures/ has them and compares those too, then re-runs golden_answers.
Prints OK or names the first file whose bytes moved. Used by `npm run fixtures:check`.

Usage: python3 tools/verify_fixtures.py [FIXTURES_DIR]
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPTED = [f"scripted_tier{t}_batch{b}.jsonl" for b in (1, 2) for t in ("A", "B")]
DECISIONS = ["decisions_batch1.csv", "decisions_batch2.csv"]


def sha(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable] + args, capture_output=True, text=True)


def main() -> int:
    fixtures = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "fixtures")
    manifest_path = os.path.join(fixtures, "MANIFEST.json")
    if not os.path.exists(manifest_path):
        print(f"no MANIFEST.json in {fixtures}; run tools/build_fixtures.py first")
        return 1
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    seed = manifest["seed"]
    expected = dict(manifest["sha256"])
    for name in SCRIPTED + DECISIONS:
        p = os.path.join(fixtures, name)
        if os.path.exists(p):
            expected[name] = sha(p)
    with tempfile.TemporaryDirectory() as tmp:
        r = run([os.path.join(HERE, "build_fixtures.py"), "--seed", str(seed), "--out", tmp])
        if r.returncode != 0:
            print(r.stderr)
            return 1
        r = run([os.path.join(HERE, "scripted_model.py"), "--seed", str(seed), "--fixtures", tmp])
        if r.returncode != 0:
            print(r.stderr)
            return 1
        if any(os.path.exists(os.path.join(fixtures, d)) for d in DECISIONS):
            r = run([os.path.join(HERE, "reference_pipeline.py"), "--fixtures", tmp, "--seed", str(seed), "--write-decisions"])
            if r.returncode != 0:
                print(r.stderr)
                return 1
        bad = 0
        for name, h in sorted(expected.items()):
            p = os.path.join(tmp, name)
            got = sha(p) if os.path.exists(p) else None
            if got != h:
                bad += 1
                print(f"MOVED {name}: manifest {h[:12]}… regenerated {str(got)[:12]}…")
            else:
                print(f"ok    {name} {h[:12]}…")
    r = run([os.path.join(HERE, "golden_answers.py")])
    if r.returncode != 0 or not r.stdout.rstrip().endswith("OK"):
        bad += 1
        print("golden_answers.py did not end with OK")
        print(r.stdout[-2000:])
    if bad:
        print(f"FAIL: {bad}")
        return 1
    print(f"OK seed={seed}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
