"""Thin client for Resident Advisor's unofficial GraphQL API.

Query shape confirmed empirically against the live https://ra.co/graphql
endpoint (2026-07-16) via introspection and trial requests, since RA
publishes no schema docs and this can drift over time.
"""
import hashlib
import json
import time
from pathlib import Path

import requests

from . import config

EVENT_LISTINGS_QUERY = """
query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      id
      listingDate
      event {
        id
        title
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
      }
    }
    totalResults
  }
}
"""


class RAClientError(RuntimeError):
    """Raised on an HTTP error or a GraphQL `errors` payload from RA."""


def _cache_path(page: int, area_id: int, date_from: str, date_to: str) -> Path:
    key = f"{area_id}_{date_from}_{date_to}_page{page}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    return config.CACHE_DIR / f"eventlistings_{digest}.json"


def _post(session: requests.Session, variables: dict) -> dict:
    resp = session.post(
        config.RA_GRAPHQL_ENDPOINT,
        json={"query": EVENT_LISTINGS_QUERY, "variables": variables},
        timeout=20,
    )
    if resp.status_code != 200:
        raise RAClientError(f"RA API returned HTTP {resp.status_code}: {resp.text[:500]}")
    body = resp.json()
    if "errors" in body:
        raise RAClientError(f"RA API returned GraphQL errors: {body['errors']}")
    return body["data"]["eventListings"]


def fetch_events(area_id: int, date_from: str, date_to: str, use_cache: bool = False) -> list[dict]:
    """Fetch all event-listing rows for an area within [date_from, date_to] (ISO dates).

    Paginates using RA's own totalResults/pageSize. Every page's raw response is
    always written to the on-disk cache; it is only read back when use_cache=True,
    so a plain run always hits the network fresh.
    """
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Referer": "https://ra.co/events/nl/amsterdam",
        "User-Agent": config.USER_AGENT,
    })

    all_rows: list[dict] = []
    page = 1

    while True:
        cache_file = _cache_path(page, area_id, date_from, date_to)

        if use_cache and cache_file.exists():
            listing = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            if page > 1:
                time.sleep(config.SLEEP_SECONDS)
            variables = {
                "filters": {
                    "areas": {"eq": area_id},
                    "listingDate": {"gte": date_from, "lte": date_to},
                },
                "pageSize": config.PAGE_SIZE,
                "page": page,
            }
            listing = _post(session, variables)
            cache_file.write_text(json.dumps(listing, ensure_ascii=False), encoding="utf-8")

        rows = listing["data"]
        all_rows.extend(rows)
        total_results = listing["totalResults"]

        if len(rows) < config.PAGE_SIZE or len(all_rows) >= total_results:
            break
        if page >= config.MAX_PAGES:
            print(
                f"WARNING: hit MAX_PAGES ({config.MAX_PAGES}) safety cap with "
                f"{len(all_rows)}/{total_results} results fetched — RA may have more "
                f"events than expected for this window."
            )
            break
        page += 1

    return all_rows
