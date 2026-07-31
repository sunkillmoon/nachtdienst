# TODO / parked ideas

Things deliberately deferred, kept here so they aren't silently forgotten.

## Biweekly digest email — parked, opt-in & evidence-gated

Notification emails were cut from step 6 (per-event email is spammy by nature).
The only email Nachtkaart sends is the transactional magic-link (custom SMTP).

A recurring digest is **parked, not planned** — build it ONLY on real evidence of
demand (repeated, unprompted requests from actual users), never speculatively. If
it ever ships, the shape is fixed:
- **Opt-in only** — off by default, an explicit toggle in the profile.
- **A biweekly digest**, never per-event pings: one email every two weeks
  summarising upcoming nights from your follows / favorite venues / want-to-go.
- **One-click unsubscribe** in every send.
- Sent server-side (a Supabase Edge Function or scheduled job) — never from the
  static client, and never with a secret key committed to this repo.

## Attendance / "interested" count — no viable anonymous route (checked 2026-08-01)

Wanted: surface RA's "X interested" on the panel/list and tier the map by it
(busy = ring, hot = ring + pulse). Both anonymous routes are closed:

- **GraphQL** `Event.interestedCount` / `attending` is a placeholder — across all
  ~1,125 live NL events it's 1–3 (max 3), identical from the listings query and
  the single `event(id)` query. Not the website's real number. `viewCount` errors
  ("cannot return null for non-nullable field").
- **RA event pages** return **HTTP 403 (Cloudflare)** to scripted requests (even
  with full browser headers) and to WebFetch, so the embedded `__NEXT_DATA__`
  route is closed server-side.

Only theoretical route: a **headless browser** scraping the *current night's ~40
events only* (never all 1,125). Out of scope for now — heavy dependency, ToS-risky,
and against "scrape politely / minimal deps". Revisit only if a real source
appears. (This is why the STYLE motion list is 4 items, not 5 — no attendance pulse.)

## iCal feed for "want to go" (roadmap step 7)

Still planned: a personal iCal feed so "want to go" picks land in a calendar.
