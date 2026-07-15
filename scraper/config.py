"""Scraper configuration constants."""
from pathlib import Path

RA_GRAPHQL_ENDPOINT = "https://ra.co/graphql"

# Resolved once via `areas(searchTerm: "amsterdam")` against the live API (2026-07-16).
AREA_IDS = {
    "amsterdam": 29,
}

DEFAULT_AREA = "amsterdam"
DEFAULT_DAYS_AHEAD = 30  # RA's unofficial API caps a single request's date range at 30 days.

PAGE_SIZE = 20
MAX_PAGES = 20  # safety cap; a run that hits this logs a warning instead of looping forever

SLEEP_SECONDS = 1.5  # between paginated requests only, not before the first

USER_AGENT = "Nachtdienst/0.1 (+contact: anatolyivankov@gmail.com; personal hobby project)"

TIMEZONE = "Europe/Amsterdam"

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "events.json"
