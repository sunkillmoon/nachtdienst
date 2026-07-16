# Nachtdienst

A map-first radar for electronic music events — club nights, raves, festivals — starting with the Netherlands. Open it on your phone and see what's on tonight around you: who's playing, where, until when, how far away.

**Live at: https://sunkillmoon.github.io/nachtdienst/**

Full product brief, style guide, and roadmap live in [CLAUDE.md](CLAUDE.md) and [STYLE.md](STYLE.md).

## Architecture

- `scraper/` — Python, pulls Amsterdam events from Resident Advisor's unofficial GraphQL API into `data/events.json`
- `data/venues.json` — hand-maintained venue name → marker abbreviation/logo map; the scraper never writes to this file
- `index.html` + `app.js` — static frontend (no framework, no build step) that reads `data/events.json` directly
- `.github/workflows/scrape.yml` — runs the scraper every morning (~06:00 Amsterdam time) and commits `data/events.json` if it changed
- GitHub Pages serves the repo root on the `main` branch

## Running locally

```
.venv\Scripts\python.exe -m scraper.scrape       # fetch fresh events -> data/events.json
.venv\Scripts\python.exe -m scraper.generate_venues   # sync data/venues.json with any new venues
python -m http.server 8000                        # serve the frontend
```

Then open `http://localhost:8000/index.html`. The frontend needs an actual HTTP server — `fetch()` can't read `data/events.json` over `file://`.

## Nightly refresh

The Actions workflow runs on a schedule (two cron entries covering both CET/CEST, since GitHub Actions cron is always UTC) and can also be triggered manually from the Actions tab (`workflow_dispatch`) to force an immediate refresh.
