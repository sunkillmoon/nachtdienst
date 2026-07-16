"""RA GraphQL client for a single artist: socials + full past-event history.

Confirmed empirically (2026-07-16): `artist(id).events(type: PREVIOUS)` returns an
artist's past gigs to anonymous callers, paginated by accumulating `excludeIds`.
`artist(id)` also exposes real soundcloud/bandcamp/discogs/website values.
"""
import hashlib
import json
import time
from pathlib import Path

import requests

from . import config

ARTIST_CACHE_DIR = Path(__file__).resolve().parent / ".cache_artists"
PREVIOUS_PAGE_SIZE = 50
MAX_ARTIST_PAGES = 12  # up to ~600 past events per artist — plenty for the backfill

ARTIST_QUERY = """
query GET_ARTIST($id: ID!, $limit: Int!, $excludeIds: [ID!]) {
  artist(id: $id) {
    id
    name
    soundcloud
    bandcamp
    discogs
    website
    events(limit: $limit, type: PREVIOUS, excludeIds: $excludeIds) {
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
      lineup
      venue {
        id
        name
        area { id name }
        location { latitude longitude }
      }
    }
  }
}
"""


class RAArtistError(RuntimeError):
    pass


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Referer": "https://ra.co/dj",
        "User-Agent": config.USER_AGENT,
    })
    return s


def _cache_path(artist_id: str) -> Path:
    digest = hashlib.sha1(artist_id.encode("utf-8")).hexdigest()[:12]
    return ARTIST_CACHE_DIR / f"artist_{digest}.json"


def _post(session: requests.Session, variables: dict) -> dict:
    resp = session.post(
        config.RA_GRAPHQL_ENDPOINT,
        json={"query": ARTIST_QUERY, "variables": variables},
        timeout=20,
    )
    if resp.status_code != 200:
        raise RAArtistError(f"HTTP {resp.status_code}: {resp.text[:300]}")
    body = resp.json()
    if "errors" in body:
        raise RAArtistError(f"GraphQL errors: {body['errors']}")
    return body["data"]["artist"]


def fetch_artist(artist_id: str, session: requests.Session | None = None,
                 use_cache: bool = True) -> dict | None:
    """Return {id, name, socials, past_events} for one artist, or None if RA has no
    such artist. `past_events` are raw RA Event dicts (feed them through transform).
    Results are cached on disk so a re-run of the backfill resumes cheaply."""
    ARTIST_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = _cache_path(artist_id)
    if use_cache and cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    session = session or _session()
    exclude_ids: list[str] = []
    past_events: list[dict] = []
    name = None
    socials = {}

    for page in range(MAX_ARTIST_PAGES):
        if page > 0:
            time.sleep(config.SLEEP_SECONDS)
        artist = _post(session, {"id": artist_id, "limit": PREVIOUS_PAGE_SIZE, "excludeIds": exclude_ids})
        if artist is None:
            return None
        name = artist["name"]
        socials = {
            "soundcloud": artist.get("soundcloud"),
            "bandcamp": artist.get("bandcamp"),
            "discogs": artist.get("discogs"),
            "website": artist.get("website"),
        }
        events = artist.get("events") or []
        if not events:
            break
        past_events.extend(events)
        exclude_ids.extend(e["id"] for e in events)
        if len(events) < PREVIOUS_PAGE_SIZE:
            break

    result = {"id": artist_id, "name": name, "socials": socials, "past_events": past_events}
    cache_file.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result
