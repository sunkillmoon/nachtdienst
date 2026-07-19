"""Generate per-venue static files (`data/venues/<id>.json`) for venue pages.

Mirrors scraper/artists.py: sources the live window (`data/events.json`) plus the
permanent archive, buckets each venue's events into upcoming/past relative to the
current night, and writes one file per RA venue id.

Keyed by RA venue id (stable, URL-safe). Archive rows predate the `venue.id`
field, so their past gigs are bridged to a page by matching the venue NAME to a
venue seen with an id in the live window — that surfaces already-backfilled
history immediately. A venue that only ever appears in the archive (never in a
recent scrape, so no known id) gets no page until it recurs.

NOT to be confused with `data/venues.json`, the hand-maintained name -> marker
abbreviation/logo/coord-override map. Different path, different job.
"""
import json
from zoneinfo import ZoneInfo

from . import archive, config
from .nightlogic import current_night

TZ = ZoneInfo(config.TIMEZONE)
VENUES_DIR = config.REPO_ROOT / "data" / "venues"
EVENTS_PATH = config.DEFAULT_OUTPUT


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
    """Regenerate all per-venue files. Returns the number of files written."""
    VENUES_DIR.mkdir(parents=True, exist_ok=True)
    today = current_night(TZ)

    live = _load_events()

    # Pass 1: registry from events that carry a venue id (live window, and any
    # newer archive rows). id -> meta; name -> id for bridging id-less archive rows.
    meta: dict[str, dict] = {}
    name_to_id: dict[str, str] = {}
    for event in live + archive.load_all():
        v = event["venue"]
        vid = v.get("id")
        if not vid:
            continue
        name_to_id.setdefault(v["name"], vid)
        entry = meta.setdefault(vid, {"name": v["name"], "area": v.get("area"), "lat": v.get("lat"), "lng": v.get("lng")})
        entry["name"] = v["name"]  # prefer most recent spelling
        if entry.get("lat") is None and v.get("lat") is not None:
            entry["lat"], entry["lng"] = v.get("lat"), v.get("lng")
        if entry.get("area") is None:
            entry["area"] = v.get("area")

    # Pass 2: gather gigs per venue id. Archive rows without an id are attributed
    # by matching their venue name to a known id.
    gigs: dict[str, dict[str, dict]] = {}
    for event in live + archive.load_all():
        v = event["venue"]
        vid = v.get("id") or name_to_id.get(v["name"])
        if not vid or vid not in meta:
            continue
        gigs.setdefault(vid, {})[event["id"]] = _gig(event)

    written = 0
    for vid, entry in meta.items():
        vgigs = list(gigs.get(vid, {}).values())
        upcoming = sorted((g for g in vgigs if g["date"] >= today), key=lambda g: g["date"])
        past = sorted((g for g in vgigs if g["date"] < today), key=lambda g: g["date"], reverse=True)
        payload = {
            "id": vid,
            "name": entry["name"],
            "area": entry.get("area"),
            "lat": entry.get("lat"),
            "lng": entry.get("lng"),
            "upcoming": upcoming,
            "past": past,
        }
        if _write_if_changed(VENUES_DIR / f"{vid}.json", payload):
            written += 1

    print(f"Venue files: {len(meta)} venues, {written} written/updated")
    return written


if __name__ == "__main__":
    build()
