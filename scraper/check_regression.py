"""Regression guard: an artist's gig count must never DECREASE across scrapes.

The archive is upsert-only and the entity generators merge archive + live, so a
rebuild should only ever add gigs. This catches the failure mode where a bad
change (or a lost archive) silently shrinks an artist's history.

    .venv\\Scripts\\python.exe -m scraper.check_regression --snapshot   # before a scrape
    .venv\\Scripts\\python.exe -m scraper.scrape
    .venv\\Scripts\\python.exe -m scraper.check_regression             # after: compare, exit 1 on any decrease
"""
import argparse
import glob
import json
import sys
from pathlib import Path

from . import config

ARTISTS_DIR = config.REPO_ROOT / "data" / "artists"
SNAPSHOT_PATH = config.REPO_ROOT / "scraper" / ".regression_snapshot.json"


def _counts() -> dict[str, int]:
    counts = {}
    for f in glob.glob(str(ARTISTS_DIR / "*.json")):
        d = json.loads(Path(f).read_text(encoding="utf-8"))
        # count all gigs regardless of the file's upcoming/past split
        counts[d["id"]] = len(d.get("gigs") or []) + len(d.get("upcoming") or []) + len(d.get("past") or [])
    return counts


def main():
    ap = argparse.ArgumentParser(description="Guard against shrinking artist gig counts across scrapes")
    ap.add_argument("--snapshot", action="store_true", help="Save current counts as the baseline")
    args = ap.parse_args()

    current = _counts()

    if args.snapshot:
        SNAPSHOT_PATH.write_text(json.dumps(current), encoding="utf-8")
        print(f"Snapshot saved: {len(current)} artists -> {SNAPSHOT_PATH.name}")
        return

    if not SNAPSHOT_PATH.exists():
        print("No snapshot found -- run with --snapshot before a scrape first.")
        sys.exit(2)

    baseline = json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8"))
    decreased = [(aid, baseline[aid], current.get(aid, 0))
                 for aid in baseline if current.get(aid, 0) < baseline[aid]]

    if decreased:
        print(f"REGRESSION: {len(decreased)} artist(s) lost gigs:")
        for aid, was, now in decreased[:20]:
            print(f"  {aid}: {was} -> {now}")
        sys.exit(1)
    print(f"OK: no artist's gig count decreased ({len(baseline)} checked).")


if __name__ == "__main__":
    main()
