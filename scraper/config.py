"""Scraper configuration constants."""
from pathlib import Path

RA_GRAPHQL_ENDPOINT = "https://ra.co/graphql"

# RA area ids, resolved via `areas(searchTerm: ...)` against the live API (2026-07-16).
# 176 = "All / Netherlands" is a true national aggregate (one query stream covers
# every Dutch city, including small ones with no own RA area page).
AREAS = {
    "netherlands": 176,
    "amsterdam": 29,
    "rotterdam": 174,
    "utrecht": 175,
    "eindhoven": 177,
    "the-hague": 178,
    "nijmegen": 672,
}

# Which areas the scraper fetches. National feed by default; edit to narrow scope.
SCRAPE_AREA_IDS = [AREAS["netherlands"]]

DEFAULT_DAYS_AHEAD = 30  # RA's unofficial API caps a single request's date range at 30 days.

PAGE_SIZE = 20
# Safety cap; a run that hits this logs a warning instead of looping forever.
# The national feed (area 176) runs ~26 pages over a 30-day window, so 40 leaves headroom.
MAX_PAGES = 40

SLEEP_SECONDS = 1.5  # between paginated requests only, not before the first

USER_AGENT = "Nachtdienst/0.1 (+contact: anatolyivankov@gmail.com; personal hobby project)"

TIMEZONE = "Europe/Amsterdam"

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "events.json"
