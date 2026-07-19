"""Generate per-promoter static files (`data/promoters/<id>.json`) for promoter pages.

Mirrors scraper/artists.py: sources the live window (`data/events.json`) plus the
permanent archive, buckets each promoter's events into upcoming/past relative to
the current night, and tallies the artists they book most.

Promoters are only present on events scraped after promoters became first-class,
so a promoter's history accumulates forward from that point (archive rows scraped
earlier carry no promoter data). A dedicated promoter backfill would fill the past.
"""
import json
from collections import Counter
from zoneinfo import ZoneInfo

from . import archive, config
from .nightlogic import current_night

TZ = ZoneInfo(config.TIMEZONE)
PROMOTERS_DIR = config.REPO_ROOT / "data" / "promoters"
EVENTS_PATH = config.DEFAULT_OUTPUT
TOP_ARTISTS = 10


def _gig(event: dict) -> dict:
    return {
        "id": event["id"],
        "title": event["title"],
        "date": event["date"],
        "start": event.get("start"),
        "venue": event["venue"]["name"],
        "venue_id": event["venue"].get("id"),
        "area": event["venue"].get("area"),
        "url": event.get("ra_url"),
    }


def _load_events() -> list[dict]:
    if EVENTS_PATH.exists():
        return json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    return []


def _write_if_changed(path, payload) -> bool:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def build() -> int:
    """Regenerate all per-promoter files. Returns the number of files written."""
    PROMOTERS_DIR.mkdir(parents=True, exist_ok=True)
    today = current_night(TZ)

    # promoter id -> {name, gigs: {event_id: gig}, artists: Counter, artist_names}
    promoters: dict[str, dict] = {}
    for event in _load_events() + archive.load_all():
        for promoter in event.get("promoters") or []:
            pid = promoter["id"]
            entry = promoters.setdefault(
                pid, {"name": promoter["name"], "gigs": {}, "artists": Counter(), "artist_names": {}}
            )
            entry["name"] = promoter["name"]  # prefer most recent spelling
            if event["id"] not in entry["gigs"]:
                entry["gigs"][event["id"]] = _gig(event)
                for artist in event.get("artists") or []:
                    entry["artists"][artist["id"]] += 1
                    entry["artist_names"][artist["id"]] = artist["name"]

    written = 0
    for pid, entry in promoters.items():
        gigs = list(entry["gigs"].values())
        upcoming = sorted((g for g in gigs if g["date"] >= today), key=lambda g: g["date"])
        past = sorted((g for g in gigs if g["date"] < today), key=lambda g: g["date"], reverse=True)
        top_artists = [
            {"id": aid, "name": entry["artist_names"][aid], "count": n}
            for aid, n in entry["artists"].most_common(TOP_ARTISTS)
        ]
        payload = {
            "id": pid,
            "name": entry["name"],
            "upcoming": upcoming,
            "past": past,
            "top_artists": top_artists,
        }
        if _write_if_changed(PROMOTERS_DIR / f"{pid}.json", payload):
            written += 1

    print(f"Promoter files: {len(promoters)} promoters, {written} written/updated")
    return written


if __name__ == "__main__":
    build()
