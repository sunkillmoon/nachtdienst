"""RA GraphQL client for a single venue or promoter: full past-event history.

Confirmed empirically (2026-07-19): `venue(id).events(type: PREVIOUS)` and
`promoter(id).events(type: PREVIOUS)` both return past gigs to anonymous callers
and both accept a `year` filter. Promoter has no `excludeIds` argument, so we
page uniformly by calendar year for both kinds. Full event field selection
matches ra_artist so scraper/transform.py consumes the rows unchanged.
"""
import hashlib
import json
import time
from datetime import date
from pathlib import Path

import requests

from . import config

PLACE_CACHE_DIR = Path(__file__).resolve().parent / ".cache_places"
YEAR_PAGE_LIMIT = 500  # per (entity, year); a full year over this is logged

_EVENT_FIELDS = """
  id
  title
  date
  startTime
  endTime
  contentUrl
  isTicketed
  cost
  genres { name }
  images { filename type }
  artists { id name }
  promoters { id name }
  lineup
  venue {
    id
    name
    area { id name }
    location { latitude longitude }
  }
"""


class RAPlaceError(RuntimeError):
    pass


def _query(kind: str) -> str:
    return (
        "query GET_PLACE($id: ID!, $limit: Int!, $year: Int) {\n"
        f"  {kind}(id: $id) {{\n"
        "    id\n    name\n"
        "    events(limit: $limit, type: PREVIOUS, year: $year) {"
        f"{_EVENT_FIELDS}}}\n"
        "  }\n}"
    )


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Referer": "https://ra.co/",
        "User-Agent": config.USER_AGENT,
    })
    return s


def _cache_path(kind: str, place_id: str) -> Path:
    digest = hashlib.sha1(f"{kind}:{place_id}".encode("utf-8")).hexdigest()[:12]
    return PLACE_CACHE_DIR / f"{kind}_{digest}.json"


def _post(session: requests.Session, kind: str, variables: dict) -> dict | None:
    resp = session.post(
        config.RA_GRAPHQL_ENDPOINT,
        json={"query": _query(kind), "variables": variables},
        timeout=25,
    )
    if resp.status_code != 200:
        raise RAPlaceError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    if "errors" in body:
        raise RAPlaceError(f"GraphQL errors: {body['errors']}")
    return body["data"].get(kind)


def _lookback_years(months: int) -> list[int]:
    today = date.today()
    # months back, then every calendar year it touches through this year
    start_year = today.year - (months // 12) - 1
    return list(range(start_year, today.year + 1))


def fetch_place(kind: str, place_id: str, months: int,
                session: requests.Session | None = None, use_cache: bool = True) -> dict | None:
    """Return {kind, id, name, past_events} for one venue/promoter, or None if RA
    has no such entity. `past_events` are raw RA Event dicts (feed through
    transform). Cached on disk so a re-run resumes without re-hitting RA."""
    PLACE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(kind, place_id)
    if use_cache and cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    session = session or _session()
    seen: dict[str, dict] = {}
    name = None

    for year in _lookback_years(months):
        # Sleep before every real request (not cache hits, which return above),
        # so the >=1.5s spacing holds across entity boundaries too, not just years.
        time.sleep(config.SLEEP_SECONDS)
        place = _post(session, kind, {"id": place_id, "limit": YEAR_PAGE_LIMIT, "year": year})
        if place is None:
            return None
        name = place.get("name") or name
        events = place.get("events") or []
        if len(events) >= YEAR_PAGE_LIMIT:
            print(f"  WARNING: {kind} {place_id} year {year} hit the {YEAR_PAGE_LIMIT} cap — may be truncated")
        for e in events:
            seen[e["id"]] = e

    result = {"kind": kind, "id": place_id, "name": name, "past_events": list(seen.values())}
    cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result
