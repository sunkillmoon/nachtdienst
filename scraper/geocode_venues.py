"""One-off helper: propose lat/lng overrides for venues with no real coordinates.

RA gives some venues a placeholder "somewhere in the Netherlands" location
(exactly lat=52, lng=5, nulled out by scraper/transform.py). This geocodes
those venues via Nominatim (OpenStreetMap's free geocoding service) and writes
PROPOSALS to a separate file for review -- it never touches data/venues.json
directly. Once you've reviewed scraper/geocode_proposals.json, re-run with
--apply to merge them in (still additive-only: skips any venue that already
has a hand-set lat/lng, so it's safe to re-run after hand-correcting one).

Deliberately excludes genuinely location-TBA (0,0) venues -- those are mostly
literally named "TBA - ..." and geocoding a placeholder name isn't meaningful.

Respects Nominatim's usage policy (max 1 request/second, an identifying
User-Agent, no autocomplete-style querying): same politeness discipline as
the RA scraper.

    .venv\\Scripts\\python.exe -m scraper.geocode_venues          # propose
    .venv\\Scripts\\python.exe -m scraper.geocode_venues --apply  # merge reviewed proposals
"""
import argparse
import json
import time
from pathlib import Path

import requests

from . import config

VENUES_PATH = config.REPO_ROOT / "data" / "venues.json"
EVENTS_PATH = config.DEFAULT_OUTPUT
PROPOSALS_PATH = config.REPO_ROOT / "scraper" / "geocode_proposals.json"
CACHE_DIR = config.REPO_ROOT / "scraper" / ".cache_geocode"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
SLEEP_SECONDS = 1.1  # Nominatim's usage policy caps at 1 request/second


def _load_json(path: Path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def _venues_needing_coords() -> dict[str, str | None]:
    """venue name -> area (city, if known), for venues with no coordinates
    that aren't location-TBA and don't already have a hand-set override."""
    events = _load_json(EVENTS_PATH, [])
    overrides = _load_json(VENUES_PATH, {})
    result: dict[str, str | None] = {}
    for event in events:
        venue = event["venue"]
        if venue["lat"] is None and not venue.get("location_tba"):
            if not (overrides.get(venue["name"]) or {}).get("lat"):
                result.setdefault(venue["name"], venue.get("area"))
    return result


def _cache_path(name: str) -> Path:
    digest = "".join(c if c.isalnum() else "_" for c in name)[:80]
    return CACHE_DIR / f"{digest}.json"


def _geocode(query: str, session: requests.Session, cache_key: str) -> dict | None:
    cache_file = _cache_path(cache_key)
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    resp = session.get(
        NOMINATIM_URL, params={"q": query, "format": "jsonv2", "limit": 1}, timeout=15
    )
    resp.raise_for_status()
    results = resp.json()
    result = results[0] if results else None

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def propose():
    venues = _venues_needing_coords()
    print(f"Geocoding {len(venues)} venues with no known location...")

    session = requests.Session()
    session.headers.update({"User-Agent": config.USER_AGENT})

    proposals = _load_json(PROPOSALS_PATH, {})
    names = sorted(venues)
    for i, name in enumerate(names, 1):
        if name in proposals:
            print(f"  [{i}/{len(names)}] {name}: already proposed, skipping")
            continue

        area = venues[name]
        query = f"{name}, {area}, Netherlands" if area else f"{name}, Netherlands"
        try:
            result = _geocode(query, session, cache_key=name)
        except requests.RequestException as exc:
            print(f"  [{i}/{len(names)}] {name}: ERROR {exc}")
            continue

        if result is None:
            print(f"  [{i}/{len(names)}] {name}: no match for {query!r}")
        else:
            proposals[name] = {
                "lat": float(result["lat"]),
                "lng": float(result["lon"]),
                "display_name": result.get("display_name"),
                "query": query,
            }
            print(f"  [{i}/{len(names)}] {name}: {result.get('display_name')}")

        if i < len(names):
            time.sleep(SLEEP_SECONDS)

    PROPOSALS_PATH.write_text(json.dumps(proposals, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {len(proposals)} proposals to {PROPOSALS_PATH}")
    print("Review them by hand, then re-run with --apply to merge into data/venues.json.")


def apply():
    proposals = _load_json(PROPOSALS_PATH, {})
    if not proposals:
        print(f"No proposals found at {PROPOSALS_PATH} -- run without --apply first.")
        return

    venues = _load_json(VENUES_PATH, {})
    applied, skipped = [], []
    for name, proposal in proposals.items():
        if name not in venues:
            skipped.append(name)
            continue
        entry = venues[name]
        if entry.get("lat") is not None and entry.get("lng") is not None:
            continue  # never clobber an existing hand-set override
        entry["lat"] = proposal["lat"]
        entry["lng"] = proposal["lng"]
        applied.append(name)

    VENUES_PATH.write_text(
        json.dumps({k: venues[k] for k in sorted(venues)}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Applied {len(applied)} proposals to {VENUES_PATH}.")
    if skipped:
        print(f"Skipped (not in venues.json yet -- run generate_venues.py first): {', '.join(skipped)}")


def main():
    parser = argparse.ArgumentParser(description="Propose (or apply) venue lat/lng overrides via Nominatim")
    parser.add_argument("--apply", action="store_true", help="Merge already-reviewed proposals into venues.json")
    args = parser.parse_args()
    apply() if args.apply else propose()


if __name__ == "__main__":
    main()
