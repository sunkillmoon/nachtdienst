"""Generate the profile past-party search index from the archive.

Writes a compact, year-sharded index under `data/search/` used by the profile
page to (a) resolve WENT / past picks without loading the full fat archive, and
(b) search past events to log a night. Sharding by year + sorting by id keeps
nightly git diffs to real deltas (only the current year's shard churns), the same
discipline as `data/archive/<year>.json`.

Outputs:
- `data/search/<year>.json` — that year's events: {id, date, title, venue,
  venue_id, area, ra_url, terms} where `terms` is a lowercase search blob.
- `data/search/years.json` — manifest list of available years.
- `data/search/venues.json` / `artists.json` / `promoters.json` — deduped
  [{id, name}] lists for the manual-entry autocomplete.
"""
import json

from . import archive, config

SEARCH_DIR = config.REPO_ROOT / "data" / "search"


def _terms(event: dict) -> str:
    venue = event.get("venue") or {}
    parts = [event.get("title") or "", venue.get("name") or "", venue.get("area") or ""]
    parts += [a.get("name", "") for a in event.get("artists") or []]
    parts += [p.get("name", "") for p in event.get("promoters") or []]
    return " ".join(p for p in parts if p).lower()


def _entry(event: dict) -> dict:
    venue = event.get("venue") or {}
    return {
        "id": event["id"],
        "date": event["date"],
        "title": event.get("title"),
        "venue": venue.get("name"),
        "venue_id": venue.get("id"),
        "area": venue.get("area"),
        "ra_url": event.get("ra_url"),
        "terms": _terms(event),
    }


def _write_if_changed(path, payload) -> bool:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def _name_list(d: dict) -> list:
    return [{"id": i, "name": n} for i, n in sorted(d.items(), key=lambda kv: (kv[1] or "").lower())]


def build() -> int:
    """Regenerate the search index. Returns the number of files written."""
    SEARCH_DIR.mkdir(parents=True, exist_ok=True)
    events = archive.load_all()

    by_year: dict[str, list] = {}
    venues: dict[str, str] = {}
    artists: dict[str, str] = {}
    promoters: dict[str, str] = {}
    for event in events:
        by_year.setdefault(event["date"][:4], []).append(_entry(event))
        v = event.get("venue") or {}
        if v.get("id"):
            venues[v["id"]] = v.get("name")
        for a in event.get("artists") or []:
            artists[a["id"]] = a["name"]
        for p in event.get("promoters") or []:
            promoters[p["id"]] = p["name"]

    written = 0
    for year, entries in by_year.items():
        entries.sort(key=lambda x: x["id"])
        if _write_if_changed(SEARCH_DIR / f"{year}.json", entries):
            written += 1
    if _write_if_changed(SEARCH_DIR / "years.json", sorted(by_year)):
        written += 1
    for fname, d in (("venues", venues), ("artists", artists), ("promoters", promoters)):
        if _write_if_changed(SEARCH_DIR / f"{fname}.json", _name_list(d)):
            written += 1

    print(f"Search index: {len(events)} events across {len(by_year)} years, {written} files written/updated")
    return written


if __name__ == "__main__":
    build()
