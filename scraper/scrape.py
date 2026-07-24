"""CLI entrypoint: fetch RA events for the next N days and write data/events.json."""
import argparse
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from . import archive, artists, config, promoter_pages, search_index, venue_pages
from .ra_client import fetch_events, RAClientError
from .transform import transform


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape RA events into data/events.json")
    parser.add_argument(
        "--areas", type=int, nargs="+", default=config.SCRAPE_AREA_IDS,
        help="RA area ids to fetch (default: config.SCRAPE_AREA_IDS). "
             "See config.AREAS for verified NL ids.",
    )
    parser.add_argument(
        "--days", type=int, default=config.DEFAULT_DAYS_AHEAD,
        help="Days ahead to fetch (up to 90; RA paginates that window fine)",
    )
    parser.add_argument("--out", default=str(config.DEFAULT_OUTPUT), help="Output JSON path")
    parser.add_argument(
        "--cache", action="store_true",
        help="Read from the on-disk response cache instead of hitting RA fresh",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if args.days > 90:
        raise SystemExit("--days cannot exceed 90 (beyond this RA's window gets unreliable)")

    today = date.today()
    date_from = today.isoformat()
    date_to = (today + timedelta(days=args.days)).isoformat()

    print(
        f"Fetching areas {args.areas} from {date_from} to {date_to} "
        f"{'(cache)' if args.cache else '(live)'}..."
    )

    # Fetch each area, dedup by event id (an event can list under multiple areas).
    rows_by_id: dict[str, dict] = {}
    try:
        for area_id in args.areas:
            area_rows = fetch_events(area_id, date_from, date_to, use_cache=args.cache)
            for row in area_rows:
                rows_by_id[row["event"]["id"]] = row
            print(f"  area {area_id}: {len(area_rows)} rows")
    except RAClientError as exc:
        raise SystemExit(f"RA API error: {exc}")

    rows = list(rows_by_id.values())
    now = datetime.now(timezone.utc)
    events = transform(rows, scraped_at=now)
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

    # Surface venues without real coordinates (the geocode backlog) so new ones
    # are noticed the day they appear -- run `python -m scraper.geocode_venues`.
    no_coords = sorted({
        e["venue"]["name"] for e in events
        if e["venue"]["lat"] is None and not e["venue"].get("location_tba")
    })
    if no_coords:
        print(f"WARNING: {len(no_coords)} venue(s) without coordinates (not on the map): {', '.join(no_coords)}")

    # Permanent archive + per-artist files.
    added = archive.merge(events, now=now)
    print(f"Archive: added {sum(added.values())} new events across years {sorted(added)}")
    artists.build()
    venue_pages.build()
    promoter_pages.build()
    search_index.build()


if __name__ == "__main__":
    main()
