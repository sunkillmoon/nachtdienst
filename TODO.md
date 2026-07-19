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

## iCal feed for "want to go" (roadmap step 7)

Still planned: a personal iCal feed so "want to go" picks land in a calendar.
