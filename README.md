# Nachtkaart

A map-first radar for electronic music events — club nights, raves, festivals — starting with the Netherlands. Open it on your phone and see what's on tonight around you: who's playing, where, until when, how far away.

**Live at: https://nachtkaart.nl/**

Full product brief, style guide, and roadmap live in [CLAUDE.md](CLAUDE.md) and [STYLE.md](STYLE.md).

## Architecture

- `scraper/` — Python, pulls nationwide NL events (RA area 176) from Resident Advisor's unofficial GraphQL API into `data/events.json`
- `data/events.json` — rolling 30-day live window; `data/archive/<year>.json` — permanent archive of every event ever seen (keyed by id, never deleted)
- `data/artists/<id>.json`, `data/venues/<id>.json`, `data/promoters/<id>.json` — per-entity page files (upcoming + past + extras), generated each scrape from events + archive; read by `artist.html` / `venue.html` / `promoter.html`. Promoters and `venue.id` come from RA's GraphQL (`Event.promoters`, verified served anonymously)
- `data/venues.json` — hand-maintained venue name → marker abbreviation/logo map (distinct from the generated `data/venues/` page files); the scraper never writes to this file
- `index.html` + `app.js` — map/list/detail frontend; `artist.html`/`venue.html`/`promoter.html` + their JS — client-rendered entity pages. Static, no framework, no build step
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

### Seeding venue + promoter history (one-off, manual)

`backfill_places.py` walks every known NL venue and promoter via
`events(type: PREVIOUS)` and seeds the archive with their recent history
(default 2 years). NL-local by nature, resumable, NOT run in CI.

```
.venv\Scripts\python.exe -m scraper.archive_stats                # counts/size BEFORE
.venv\Scripts\python.exe -m scraper.backfill_places --limit 5    # test a small slice first
.venv\Scripts\python.exe -m scraper.backfill_places              # the full run (~1h, overnight)
.venv\Scripts\python.exe -m scraper.archive_stats                # counts/size AFTER — see the delta
```

Resume after Ctrl-C or a crash: just re-run the same command. Completed
venues/promoters are recorded in `scraper/.backfill_places_progress.json` and
skipped; already-fetched responses are cached on disk. `--months N` changes the
lookback; `--skip-venues` / `--skip-promoters` narrow the walk. Afterwards, run
the nightly scrape (or `python -m scraper.search_index`) so the profile search
index covers the fatter archive.

## Nightly refresh

The Actions workflow runs on a schedule (two cron entries covering both CET/CEST, since GitHub Actions cron is always UTC) and can also be triggered manually from the Actions tab (`workflow_dispatch`) to force an immediate refresh.
