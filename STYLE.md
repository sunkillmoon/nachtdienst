# NIGHTSHIFT — STYLE

The visual language of the NL underground: flyer, timetable, terminal. This direction is chosen deliberately — it is the scene's own vernacular. Follow it exactly. Where a choice isn't covered here, pick the more austere option.

## Tokens

```css
--bg:       #0A0A0A;  /* page background, near-black          */
--surface:  #111111;  /* panels, table rows                   */
--line:     #2A2A2A;  /* every border: 1px solid              */
--text:     #EDEDED;  /* primary text                         */
--text-dim: #8A8A8A;  /* secondary text, labels               */
--accent:   #B4FF00;  /* acid green — THE ONLY accent color   */
--danger:   #FF3B30;  /* sold out / cancelled, nothing else   */
```

## Type

- Display / headers: "Space Grotesk", bold, UPPERCASE, letter-spacing -0.02em
- Data & UI (times, prices, distances, table content, buttons, labels): "Space Mono" or "JetBrains Mono"
- Labels / eyebrows: mono, uppercase, 11–12px, letter-spacing 0.08em, color --text-dim
- Body copy: almost none exists on this site; when it does, keep it short and mono

## Hard rules

- `border-radius: 0` everywhere. No exceptions.
- No box-shadows, no gradients, no glassmorphism, no emoji in the UI.
- Borders are visible and honest: `1px solid var(--line)`. Dashed/dotted allowed as dividers.
- Dark only. There is no light mode.
- Links are accent-colored or underlined. Buttons look like bordered labels, never pills.
- Density is a feature: tight rows, timetable feel. Never card grids with generous padding.

## Anti-patterns — never do these

Rounded cards, purple/blue gradients, Inter or Roboto, hero sections with taglines, drop shadows, skeleton shimmer, decorative icons, generous whitespace "for breathing room". If it would look at home on a SaaS landing page, it is wrong here.

## Signature elements

- Ticker: one-line marquee of tonight's events in mono, items separated by " • ", venue names in --accent
- Map: CARTO Dark Matter basemap; markers are ~10px squares or crosshairs in --accent (active = filled); "© OpenStreetMap" attribution always visible
- Poster images: high-contrast / dithered 1-bit treatment welcome
- Timestamps everywhere, system-log style: `UPDATED 20:37:12`

## Motion

- The ticker scrolls. The detail panel slides up. That is the complete list.
- No fade-in-on-scroll, no parallax, no hover lift.
- Respect `prefers-reduced-motion`: stop the ticker, cut the slide.

## Quality floor

Responsive down to 360px width. Visible keyboard focus (1px --accent outline). Tap targets ≥ 44px. Text contrast ≥ 4.5:1. These are invisible when done right — do them right.
