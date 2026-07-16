# Nachtdienst

A map-first radar for electronic music events — club nights, raves, festivals — starting with the Netherlands. Open it on your phone and see what's on tonight around you: who's playing, where, until when, how far away.

**Live at: https://sunkillmoon.github.io/nachtdienst/**

Full product brief, style guide, and roadmap live in [CLAUDE.md](CLAUDE.md) and [STYLE.md](STYLE.md).

## Architecture

- `scraper/` — Python, pulls nationwide NL events (RA area 176) from Resident Advisor's unofficial GraphQL API into `data/events.json`
- `data/events.json` — rolling 30-day live window; `data/archive/<year>.json` — permanent archive of every event ever seen (keyed by id, never deleted)
- `data/artists/<id>.json` — per-artist files (upcoming + past gigs + socials), generated each scrape from events + archive; read by `artist.html`
- `data/venues.json` — hand-maintained venue name → marker abbreviation/logo map; the scraper never writes to this file
- `index.html` + `app.js` — map/list/detail frontend; `artist.html` + `artist.js` — client-rendered artist pages. Static, no framework, no build step
- `.github/workflows/scrape.yml` — runs the scraper every morning (~06:00 Amsterdam time) and commits changed `data/` if anything changed
- GitHub Pages serves the repo root on the `main` branch
- Cache-busting: `update_asset_versions.py` stamps a content-hash `?v=` on `app.js`/`artist.js`/`manifest.json`'s tags (auto-run by `.github/workflows/version-assets.yml` on every push that touches them); data fetches append a per-load `?t=<timestamp>` so a returning visitor — especially an installed home-screen PWA — always gets the latest deploy and the latest scrape

## Running locally

```
.venv\Scripts\python.exe -m scraper.scrape            # fetch events -> events.json + archive + artist files
.venv\Scripts\python.exe -m scraper.generate_venues   # sync data/venues.json with any new venues
python -m http.server 8000                            # serve the frontend
```

Then open `http://localhost:8000/index.html`. The frontend needs an actual HTTP server — `fetch()` can't read JSON over `file://`.

### Seeding artist history (one-off, manual)

RA exposes each artist's full past history to anonymous callers. `backfill_artists.py` seeds the archive with it and records real social links. It is long-running (hundreds of artists, polite delays), resumable, and NOT run in CI — history otherwise just accumulates forward from the archive's start.

```
.venv\Scripts\python.exe -m scraper.backfill_artists --limit 5   # test on a small slice first
.venv\Scripts\python.exe -m scraper.backfill_artists             # the full run
```

## Nightly refresh

The Actions workflow runs on a schedule (two cron entries covering both CET/CEST, since GitHub Actions cron is always UTC) and can also be triggered manually from the Actions tab (`workflow_dispatch`) to force an immediate refresh.
