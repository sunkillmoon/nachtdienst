"""Core domain rule: which "night" an event or moment belongs to.

Electronic music runs past midnight, so grouping by plain calendar date is
wrong right when it matters most: at 00:01 a party that started at 23:00
would flip to "yesterday" even though it's still very much on. Instead, an
event belongs to the night of (start_time - 8h).date() -- and "right now"
belongs to the night of (now - 8h).date(). Until 08:00 local, "tonight"
still means the evening that began yesterday.

This is the single canonical implementation of that rule. The frontend
(app.js) mirrors it in JS as nightOf()/currentNightAmsterdam() for the same
reason -- Python bakes each event's night into events.json at scrape time,
JS needs to compute "what night is it right now" live, at page-load/render
time, which can't be precomputed. Keep both in sync if this ever changes.
"""
from datetime import datetime, timedelta

NIGHT_CUTOFF_HOURS = 8


def night_of(dt: datetime) -> str:
    """dt must be timezone-aware, already in the target local timezone."""
    return (dt - timedelta(hours=NIGHT_CUTOFF_HOURS)).date().isoformat()


def current_night(tz) -> str:
    return night_of(datetime.now(tz))
