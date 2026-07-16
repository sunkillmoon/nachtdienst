"""One-off backfill: seed the archive with every known artist's past gigs.

RA exposes past events per artist to anonymous callers (see scraper/ra_artist.py),
so this walks every RA-linked artist currently in our data, pulls their history
into the permanent archive, records their real social URLs, and rebuilds the
per-artist files.

This is a MANUAL, long-running job (hundreds of artists, polite sleeps between
each) — it is NOT part of the nightly CI scrape. It is resumable: per-artist
responses are cached on disk, so re-running skips already-fetched artists.

    .venv\\Scripts\\python.exe -m scraper.backfill_artists            # everything
    .venv\\Scripts\\python.exe -m scraper.backfill_artists --limit 5  # small test slice
"""
import argparse
import json
import time
from datetime import datetime, timezone

from . import archive, artists, config
from .ra_artist import fetch_artist, RAArtistError, _session
from .transform import transform

SOCIALS_PATH = config.REPO_ROOT / "data" / "artist_socials.json"


def known_artist_ids() -> list[str]:
    """Every RA-linked artist id across the live window and the archive."""
    ids = {}
    events = []
    if config.DEFAULT_OUTPUT.exists():
        events += json.loads(config.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    events += archive.load_all()
    for event in events:
        for a in event.get("artists") or []:
            ids[a["id"]] = a["name"]
    return sorted(ids)


def main():
    parser = argparse.ArgumentParser(description="Backfill artist history into the archive")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N artists (testing)")
    parser.add_argument("--no-cache", action="store_true", help="Ignore the per-artist response cache")
    args = parser.parse_args()

    ids = known_artist_ids()
    if args.limit:
        ids = ids[: args.limit]
    print(f"Backfilling {len(ids)} artists...")

    socials = {}
    if SOCIALS_PATH.exists():
        socials = json.loads(SOCIALS_PATH.read_text(encoding="utf-8"))

    session = _session()
    now = datetime.now(timezone.utc)
    total_past = 0

    for i, artist_id in enumerate(ids, 1):
        try:
            data = fetch_artist(artist_id, session=session, use_cache=not args.no_cache)
        except RAArtistError as exc:
            print(f"  [{i}/{len(ids)}] {artist_id}: ERROR {exc}")
            continue
        if data is None:
            print(f"  [{i}/{len(ids)}] {artist_id}: no such artist")
            continue

        socials[artist_id] = data["socials"]

        past_rows = [{"listingDate": ev["date"], "event": ev} for ev in data["past_events"]]
        past_events = transform(past_rows, scraped_at=now)
        if past_events:
            archive.merge(past_events, now=now)
            total_past += len(past_events)

        print(f"  [{i}/{len(ids)}] {data['name']}: {len(past_events)} past events")

        # Persist socials incrementally so an interrupted run isn't lost.
        SOCIALS_PATH.write_text(json.dumps(socials, ensure_ascii=False, indent=2), encoding="utf-8")

        # Polite pause between artists (fetch_artist already sleeps between pages).
        if i < len(ids):
            time.sleep(config.SLEEP_SECONDS)

    print(f"Done: {total_past} past events merged into the archive.")
    artists.build()


if __name__ == "__main__":
    main()
