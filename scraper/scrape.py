"""CLI entrypoint: fetch RA events for the next N days and write data/events.json."""
import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import config
from .ra_client import fetch_events, RAClientError
from .transform import transform


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape RA events into data/events.json")
    parser.add_argument(
        "--area", default=config.DEFAULT_AREA, choices=sorted(config.AREA_IDS),
        help="Named area to scrape (see scraper/config.py AREA_IDS)",
    )
    parser.add_argument(
        "--days", type=int, default=config.DEFAULT_DAYS_AHEAD,
        help="Days ahead to fetch (RA caps a single request's range at 30)",
    )
    parser.add_argument("--out", default=str(config.DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument(
        "--cache", action="store_true",
        help="Read from the on-disk response cache instead of hitting RA fresh",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.days > 30:
        raise SystemExit("--days cannot exceed 30 (RA's unofficial API request-range cap)")

    area_id = config.AREA_IDS[args.area]
    today = date.today()
    date_from = today.isoformat()
    date_to = (today + timedelta(days=args.days)).isoformat()

    print(
        f"Fetching {args.area} (area {area_id}) events from {date_from} to {date_to} "
        f"{'(cache)' if args.cache else '(live)'}..."
    )

    try:
        rows = fetch_events(area_id, date_from, date_to, use_cache=args.cache)
    except RAClientError as exc:
        raise SystemExit(f"RA API error: {exc}")

    events = transform(rows, scraped_at=datetime.now(timezone.utc))
    events.sort(key=lambda e: e["start"])

    out_path = Path(args.out)
    tmp_path = out_path.with_name("." + out_path.name + ".tmp")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path.write_text(json.dumps(events, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp_path, out_path)

    skipped = len(rows) - len(events)
    print(f"Wrote {len(events)} events ({skipped} skipped, no venue) to {out_path}")
    if events:
        print(f"Date range covered: {events[0]['date']} .. {events[-1]['date']}")


if __name__ == "__main__":
    main()
