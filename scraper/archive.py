"""Permanent event archive: every event ever seen, merged by event id.

`data/events.json` is the rolling 30-day live window and gets overwritten each
run. The archive keeps everything, split into one JSON file per calendar year
(`data/archive/<year>.json`), keyed by event id. Records are upserted — changed
fields are updated, nothing is ever deleted.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from . import config

ARCHIVE_DIR = config.REPO_ROOT / "data" / "archive"


def _year_of(event: dict) -> str:
    return event["date"][:4]


def _load_year(year: str) -> dict:
    path = ARCHIVE_DIR / f"{year}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _write_year(year: str, records: dict) -> None:
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    path = ARCHIVE_DIR / f"{year}.json"
    ordered = {eid: records[eid] for eid in sorted(records)}
    tmp = path.with_name("." + path.name + ".tmp")
    tmp.write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def merge(events: list[dict], now: datetime | None = None) -> dict:
    """Upsert events into the per-year archive. Returns {year: added_count}."""
    now_iso = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")

    by_year: dict[str, list[dict]] = {}
    for event in events:
        by_year.setdefault(_year_of(event), []).append(event)

    stats = {}
    for year, year_events in by_year.items():
        records = _load_year(year)
        added = 0
        changed = False
        for event in year_events:
            eid = event["id"]
            existing = records.get(eid)
            if existing is None:
                added += 1
            first_seen = existing.get("first_seen", now_iso) if existing else now_iso
            record = {**event, "first_seen": first_seen, "last_seen": now_iso}
            # Ignore last_seen when deciding if anything meaningful changed, so a
            # re-scrape with identical data doesn't rewrite the file every night.
            if existing is None or {k: v for k, v in existing.items() if k != "last_seen"} != \
                    {k: v for k, v in record.items() if k != "last_seen"}:
                changed = True
            records[eid] = record
        if changed:
            _write_year(year, records)
        stats[year] = added
    return stats


def load_all() -> list[dict]:
    """Every archived event record across all year files."""
    if not ARCHIVE_DIR.exists():
        return []
    events = []
    for path in sorted(ARCHIVE_DIR.glob("*.json")):
        records = json.loads(path.read_text(encoding="utf-8"))
        events.extend(records.values())
    return events
