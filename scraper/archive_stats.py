"""Quick archive sanity check: event counts per year and total on-disk size.

Run before and after a backfill to see the delta.

    .venv\\Scripts\\python.exe -m scraper.archive_stats
"""
import json

from . import config

ARCHIVE_DIR = config.REPO_ROOT / "data" / "archive"


def main():
    if not ARCHIVE_DIR.exists():
        print("No archive yet.")
        return
    total_events = 0
    total_bytes = 0
    print(f"{'year':<8}{'events':>10}{'KB':>12}")
    print("-" * 30)
    for path in sorted(ARCHIVE_DIR.glob("*.json")):
        records = json.loads(path.read_text(encoding="utf-8"))
        size = path.stat().st_size
        total_events += len(records)
        total_bytes += size
        print(f"{path.stem:<8}{len(records):>10}{size / 1024:>12.0f}")
    print("-" * 30)
    print(f"{'TOTAL':<8}{total_events:>10}{total_bytes / 1024:>12.0f}  ({total_bytes / 1_048_576:.1f} MB)")


if __name__ == "__main__":
    main()
