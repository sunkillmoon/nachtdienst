"""Pure transform: raw RA GraphQL event-listing rows -> nachtkaart events.json schema."""
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import config

TZ = ZoneInfo(config.TIMEZONE)

_ARTIST_TAG_RE = re.compile(r'<artist id="\d+">(.*?)</artist>')

# RA's own "unknown location" sentinels, not real coordinates.
_UNKNOWN_NL_LOCATION = (52, 5)  # "somewhere in the Netherlands"
_NULL_ISLAND = (0, 0)  # global null-island fallback -- genuinely location-TBA

VENUES_PATH = config.REPO_ROOT / "data" / "venues.json"


def _load_venue_overrides() -> dict:
    if not VENUES_PATH.exists():
        return {}
    return json.loads(VENUES_PATH.read_text(encoding="utf-8"))


def _resolve_location(
    venue_name: str, lat: float | None, lng: float | None, overrides: dict
) -> tuple[float | None, float | None, bool]:
    """Returns (lat, lng, location_tba). A hand-set lat/lng in data/venues.json
    always wins (over RA's data and over the sentinel-nulling below); RA's known
    placeholder coordinates are otherwise treated as no location at all."""
    location_tba = False
    if lat is not None and lng is not None:
        if (lat, lng) == _UNKNOWN_NL_LOCATION:
            lat, lng = None, None
        elif (lat, lng) == _NULL_ISLAND:
            lat, lng = None, None
            location_tba = True

    override = overrides.get(venue_name) or {}
    if override.get("lat") is not None and override.get("lng") is not None:
        lat, lng = override["lat"], override["lng"]
        location_tba = False

    return lat, lng, location_tba


def _parse_local(dt_str: str) -> datetime:
    """RA's startTime/endTime are naive local (Europe/Amsterdam) wall-clock strings."""
    return datetime.fromisoformat(dt_str).replace(tzinfo=TZ)


def _parse_price(cost: str | None) -> str | None:
    """RA's `cost` field is inconsistent: "10", "", "21,20", "€0,00" all occur."""
    if not cost or not cost.strip():
        return None
    stripped = cost.strip().lstrip("€").strip()
    normalized = stripped.replace(",", ".")
    try:
        if float(normalized) == 0:
            return "FREE"
    except ValueError:
        pass
    return f"€{stripped}"


def _flyer_url(images: list[dict]) -> str | None:
    for image in images:
        if image.get("type") == "FLYERFRONT":
            return image.get("filename")
    return None


def _clean_lineup_text(raw: str | None) -> str:
    """RA's raw `lineup` string embeds `<artist id="N">Name</artist>` tags around
    RA-registered names, mixed with plain text for unregistered support acts/hosts.
    This strips the tags down to plain names for display, keeping line breaks."""
    if not raw:
        return ""
    stripped = _ARTIST_TAG_RE.sub(r"\1", raw).replace("\xa0", " ")
    lines = [line.strip() for line in stripped.split("\n")]
    return "\n".join(line for line in lines if line)


def transform(rows: list[dict], scraped_at: datetime | None = None) -> list[dict]:
    """rows: the raw `eventListings.data` list from ra_client.fetch_events."""
    scraped_at = scraped_at or datetime.now(timezone.utc)
    scraped_at_iso = scraped_at.isoformat(timespec="seconds")
    venue_overrides = _load_venue_overrides()

    events = []
    for row in rows:
        event = row["event"]
        venue = event.get("venue") or {}

        if not venue.get("name"):
            print(
                f"WARNING: event {event.get('id')} ({event.get('title')!r}) "
                f"has no venue — skipping"
            )
            continue

        location = venue.get("location") or {}
        area = venue.get("area") or {}
        start = _parse_local(event["startTime"])
        end = _parse_local(event["endTime"]) if event.get("endTime") else None
        lat, lng, location_tba = _resolve_location(
            venue["name"], location.get("latitude"), location.get("longitude"), venue_overrides
        )

        events.append({
            "id": f"ra:{event['id']}",
            "source": "ra",
            "title": event.get("title") or "Untitled",
            "venue": {
                "name": venue["name"],
                "area": area.get("name"),
                "lat": lat,
                "lng": lng,
                "location_tba": location_tba,
            },
            "date": row["listingDate"][:10],
            "start": start.isoformat(timespec="minutes"),
            "end": end.isoformat(timespec="minutes") if end else None,
            # RA-registered artists only (kept separate for a future artist-pages
            # step); `lineup_text` below is the fuller promoter-written billing.
            "artists": [{"id": a["id"], "name": a["name"]} for a in event.get("artists") or []],
            "lineup_text": _clean_lineup_text(event.get("lineup")),
            "tags": [g["name"].upper() for g in event.get("genres") or []],
            "price": _parse_price(event.get("cost")),
            # RA does not expose ticket-availability/sold-out status to anonymous
            # API callers (the `tickets` field always returns empty) — always False
            # for v1 until a source for this is found.
            "sold_out": False,
            "flyer_url": _flyer_url(event.get("images") or []),
            "ra_url": f"https://ra.co{event['contentUrl']}" if event.get("contentUrl") else None,
            "scraped_at": scraped_at_iso,
        })

    return events
