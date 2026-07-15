"""Pure transform: raw RA GraphQL event-listing rows -> nachtdienst events.json schema."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import config

TZ = ZoneInfo(config.TIMEZONE)


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


def transform(rows: list[dict], scraped_at: datetime | None = None) -> list[dict]:
    """rows: the raw `eventListings.data` list from ra_client.fetch_events."""
    scraped_at = scraped_at or datetime.now(timezone.utc)
    scraped_at_iso = scraped_at.isoformat(timespec="seconds")

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
        start = _parse_local(event["startTime"])
        end = _parse_local(event["endTime"]) if event.get("endTime") else None

        events.append({
            "id": f"ra:{event['id']}",
            "source": "ra",
            "title": event.get("title") or "Untitled",
            "venue": {
                "name": venue["name"],
                "lat": location.get("latitude"),
                "lng": location.get("longitude"),
            },
            "date": row["listingDate"][:10],
            "start": start.isoformat(timespec="minutes"),
            "end": end.isoformat(timespec="minutes") if end else None,
            "lineup": [a["name"] for a in event.get("artists") or []],
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
