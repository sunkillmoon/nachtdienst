"""One-off maintenance script: keep data/venues.json in sync with venues seen
in data/events.json.

NOT part of the nightly scrape (scrape.py never imports or calls this) —
data/venues.json is hand-maintained (abbreviation overrides, logo paths) and
this script only ever *adds* missing venues, never overwrites an existing
entry. Run manually after a scrape introduces new venues:

    .venv\\Scripts\\python.exe -m scraper.generate_venues
"""
import json
import re
from collections import defaultdict

from . import config

VENUES_PATH = config.REPO_ROOT / "data" / "venues.json"
EVENTS_PATH = config.DEFAULT_OUTPUT


def auto_abbr(name: str) -> str:
    words = [w for w in re.split(r"[^A-Za-z0-9]+", name) if w]
    if len(words) >= 2:
        abbr = "".join(w[0] for w in words[:4]).upper()
    elif words:
        abbr = words[0][:4].upper()
    else:
        abbr = "??"
    return abbr[:4]


def main():
    venues = {}
    if VENUES_PATH.exists():
        venues = json.loads(VENUES_PATH.read_text(encoding="utf-8"))

    events = json.loads(EVENTS_PATH.read_text(encoding="utf-8"))
    venue_names = sorted({e["venue"]["name"] for e in events})

    added = []
    for name in venue_names:
        if name not in venues:
            venues[name] = {"abbr": auto_abbr(name), "logo": None}
            added.append(name)

    sorted_venues = {name: venues[name] for name in sorted(venues)}
    VENUES_PATH.write_text(
        json.dumps(sorted_venues, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote {len(sorted_venues)} venues to {VENUES_PATH} ({len(added)} newly added)")

    by_abbr = defaultdict(list)
    for name, meta in sorted_venues.items():
        by_abbr[meta["abbr"]].append(name)
    collisions = {abbr: names for abbr, names in by_abbr.items() if len(names) > 1}
    if collisions:
        print("WARNING: duplicate abbreviations — resolve by hand in data/venues.json:")
        for abbr, names in collisions.items():
            print(f"  {abbr}: {', '.join(names)}")


if __name__ == "__main__":
    main()
