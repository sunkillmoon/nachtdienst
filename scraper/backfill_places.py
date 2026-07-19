"""One-off backfill: seed the archive with NL venues' and promoters' past events.

RA exposes past events per venue and per promoter to anonymous callers (see
scraper/ra_place.py). This walks every venue and promoter currently known from
our data, pulls their recent history (default 2 years) into the permanent
archive, and rebuilds the per-entity page files. Venue/promoter PREVIOUS is
NL-local by nature, so this is a cleaner NL backfill than the artist one.

MANUAL, long-running, NOT part of CI. Resumable: completed entities are recorded
in a progress file and skipped on re-run; per-entity responses are also cached on
disk. Just re-run the same command after an interruption.

    .venv\\Scripts\\python.exe -m scraper.backfill_places              # everything, 24 months
    .venv\\Scripts\\python.exe -m scraper.backfill_places --limit 5    # small test slice per kind
    .venv\\Scripts\\python.exe -m scraper.backfill_places --months 36  # deeper lookback
"""
import argparse
import json
from datetime import date, datetime, timezone

from . import archive, artists, config, promoter_pages, venue_pages
from .ra_place import fetch_place, RAPlaceError, _session
from .transform import MIN_EVENT_DATE, transform

PROGRESS_PATH = config.REPO_ROOT / "scraper" / ".backfill_places_progress.json"


def known_place_ids() -> dict[str, list[str]]:
    """Every venue id and promoter id across the live window and the archive."""
    venues: dict[str, str] = {}
    promoters: dict[str, str] = {}
    events = []
    if config.DEFAULT_OUTPUT.exists():
        events += json.loads(config.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    events += archive.load_all()
    for event in events:
        v = event.get("venue") or {}
        if v.get("id"):
            venues[v["id"]] = v.get("name")
        for p in event.get("promoters") or []:
            promoters[p["id"]] = p["name"]
    return {"venue": sorted(venues), "promoter": sorted(promoters)}


def _cutoff_iso(months: int) -> str:
    today = date.today()
    total = today.year * 12 + (today.month - 1) - months
    cy, cm = divmod(total, 12)
    return date(cy, cm + 1, 1).isoformat()


def _load_progress() -> set[str]:
    if PROGRESS_PATH.exists():
        return set(json.loads(PROGRESS_PATH.read_text(encoding="utf-8")))
    return set()


def _save_progress(done: set[str]) -> None:
    PROGRESS_PATH.write_text(json.dumps(sorted(done)), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Backfill venue/promoter history into the archive")
    parser.add_argument("--months", type=int, default=24, help="Lookback window in months (default 24)")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N of each kind (testing)")
    parser.add_argument("--no-cache", action="store_true", help="Ignore the per-entity response cache and progress file")
    parser.add_argument("--skip-venues", action="store_true", help="Don't walk venues")
    parser.add_argument("--skip-promoters", action="store_true", help="Don't walk promoters")
    args = parser.parse_args()

    ids = known_place_ids()
    kinds = [k for k in ("venue", "promoter")
             if not (k == "venue" and args.skip_venues) and not (k == "promoter" and args.skip_promoters)]

    cutoff = max(_cutoff_iso(args.months), MIN_EVENT_DATE)
    done = set() if args.no_cache else _load_progress()
    session = _session()
    now = datetime.now(timezone.utc)
    total_merged = 0

    for kind in kinds:
        kind_ids = ids[kind]
        if args.limit:
            kind_ids = kind_ids[: args.limit]
        print(f"\n== {kind}s: {len(kind_ids)} known (cutoff {cutoff}) ==")

        for i, place_id in enumerate(kind_ids, 1):
            key = f"{kind}:{place_id}"
            if key in done:
                continue
            try:
                data = fetch_place(kind, place_id, args.months, session=session, use_cache=not args.no_cache)
            except RAPlaceError as exc:
                print(f"  [{i}/{len(kind_ids)}] {key}: ERROR {exc}")
                continue
            if data is None:
                print(f"  [{i}/{len(kind_ids)}] {key}: no such {kind}")
                done.add(key)
                _save_progress(done)
                continue

            kept = [ev for ev in data["past_events"] if (ev.get("date") or "")[:10] >= cutoff]
            rows = [{"listingDate": ev["date"], "event": ev} for ev in kept]
            events = transform(rows, scraped_at=now)  # also drops sub-2005 / start-less junk
            if events:
                archive.merge(events, now=now)
                total_merged += len(events)

            print(f"  [{i}/{len(kind_ids)}] {data['name'] or key}: {len(events)} events merged")
            done.add(key)
            _save_progress(done)

    print(f"\nDone: {total_merged} events merged into the archive. Rebuilding page files...")
    artists.build()
    venue_pages.build()
    promoter_pages.build()
    print("Backfill complete. (Run the nightly scrape or `python -m scraper.search_index` "
          "to refresh the profile search index over the fatter archive.)")


if __name__ == "__main__":
    main()
