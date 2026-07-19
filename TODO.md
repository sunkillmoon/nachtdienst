# TODO / parked ideas

Things deliberately deferred, kept here so they aren't silently forgotten.

## Notification emails — deferred (spam concern)

Roadmap step 6 originally included notification emails. Deferred because
per-event notification email is spammy by nature and easy to get wrong.

If it returns, the shape should be:
- **Opt-in only** — off by default, an explicit toggle in the profile.
- **A biweekly digest**, not per-event pings: one email every two weeks
  summarising upcoming nights from your follows / favorite venues / want-to-go.
- **One-click unsubscribe** in every send.
- Sent server-side (a Supabase Edge Function or scheduled job) — never from the
  static client, and never with a secret key committed to this repo.

## iCal feed for "want to go" (roadmap step 7)

Still planned: a personal iCal feed so "want to go" picks land in a calendar.
