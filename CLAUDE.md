# NACHTDIENST

A map-first radar for electronic music events — club nights, raves, festivals — starting with the Netherlands. Open it on your phone and see what's on tonight around you: who's playing, where, until when, how far away. Built for the moment, not the plan.

## Who is building this

Anatolii — solo, personal project, not commercial. Strong Python/data background, some HTML/CSS/JS and basic React. First time using Claude Code: explain what you're doing and why as you go — this project is also how he learns. Prefer small, verifiable steps over big leaps.

## Product principles

- Mobile-first. Design for a phone screen; desktop is the adaptation, not the other way around.
- No ads, no algorithm, no feed. A utility, not a social network.
- Dense and utilitarian, like a timetable — never like a startup landing page.
- Default view: tonight, sorted by distance.
- Everything links out (RA, TicketSwap, venue sites, SoundCloud/Bandcamp/Spotify). We send traffic, we never trap it.

## Architecture (v1)

- Python scraper → `data/events.json`, run nightly by GitHub Actions
- Static frontend on GitHub Pages: plain HTML/CSS/JS, no framework, no build step for v0
- Map: MapLibre GL JS with the CARTO Dark Matter basemap ("© OpenStreetMap" attribution is a license requirement — it always stays visible)
- Data sources: Resident Advisor's unofficial GraphQL API first; djguide.nl later. Instagram: never.
  - RA's `Event` type also exposes a free-text `content` field (a promoter-written description, separate from the lineup). Confirmed to exist during the lineup-completeness check (2026-07-16) but not scraped or used anywhere yet — noted here so it isn't silently forgotten or silently added beyond what's been asked for.
- Later phases only: Supabase (accounts, favorites, follows, email notifications), artist pages, personal iCal feed

## UI structure

- Ticker: one-line scrolling marquee of the selected night's headline events
- Filter: date only
- Map: dark, square/crosshair markers; tap a marker → detail panel
- List columns: Time | Event (Organizer) / Venue | Lineup | Tags
- Detail panel (slides up on mobile): poster, date/time, price, distance, links out, lineup with per-artist links, went / want-to-go

## Roadmap

1. Repo + brief — done
2. Scraper: RA GraphQL → `data/events.json` — CURRENT
3. Frontend v0: ticker + map + list + detail panel, reading `events.json`
4. GitHub Actions nightly run + GitHub Pages deploy
5. Artist pages + genre tags
6. Supabase accounts: favorites, follows, went/want-to-go, notification emails
7. iCal feed for "want to go"

## Working rules for Claude Code

- Read STYLE.md before writing or changing any UI. It is law.
- One task at a time. Stop when it's verifiable and tell me how to verify it.
- Keep dependencies minimal; justify any new one in a sentence.
- Scrape politely: identify with a User-Agent, sleep between requests, cache responses during development. Never commit secrets.
- Ask before: deleting files, changing the architecture, or adding any external service.
