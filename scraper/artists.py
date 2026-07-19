"""Generate per-artist static files (`data/artists/<id>.json`) for artist pages.

Sources every RA-linked artist from the live window (`data/events.json`) plus the
permanent archive, buckets their gigs, and splits into upcoming/past relative to
today (Europe/Amsterdam). Real social URLs are merged in from
`data/artist_socials.json` when a backfill has populated it. Files are only
rewritten when their content changes, to keep nightly git diffs small.
"""
import json
from zoneinfo import ZoneInfo

from . import archive, config
from .nightlogic import current_night

TZ = ZoneInfo(config.TIMEZONE)
ARTISTS_DIR = config.REPO_ROOT / "data" / "artists"
EVENTS_PATH = config.DEFAULT_OUTPUT
SOCIALS_PATH = config.REPO_ROOT / "data" / "artist_socials.json"


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


def _today() -> str:
    # Same night rule as scraper/nightlogic.py / app.js -- "today" for
    # upcoming/past bucketing is the current *night*, not the plain calendar
    # date, so this matches events.json's own `date` field exactly.
    return current_night(TZ)


def _load_events() -> list[dict]:
    if EVENTS_PATH.exists():
        return json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    return []


def _load_socials() -> dict:
    if SOCIALS_PATH.exists():
        return json.loads(SOCIALS_PATH.read_text(encoding="utf-8"))
    return {}


def _write_if_changed(path, payload) -> bool:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def build() -> int:
    """Regenerate all per-artist files. Returns the number of files written."""
    ARTISTS_DIR.mkdir(parents=True, exist_ok=True)
    socials = _load_socials()
    today = _today()

    # artist id -> {name, gigs: {event_id: gig}} (dict dedups events by id)
    artists: dict[str, dict] = {}
    for event in _load_events() + archive.load_all():
        for artist in event.get("artists") or []:
            aid = artist["id"]
            entry = artists.setdefault(aid, {"name": artist["name"], "gigs": {}})
            entry["name"] = artist["name"]  # prefer the most recent spelling
            entry["gigs"][event["id"]] = _gig(event)

    written = 0
    for aid, entry in artists.items():
        gigs = list(entry["gigs"].values())
        upcoming = sorted((g for g in gigs if g["date"] >= today), key=lambda g: g["date"])
        past = sorted((g for g in gigs if g["date"] < today), key=lambda g: g["date"], reverse=True)
        payload = {
            "id": aid,
            "name": entry["name"],
            "socials": socials.get(aid, {}),
            "upcoming": upcoming,
            "past": past,
        }
        if _write_if_changed(ARTISTS_DIR / f"{aid}.json", payload):
            written += 1

    print(f"Artist files: {len(artists)} artists, {written} written/updated")
    return written


if __name__ == "__main__":
    build()
