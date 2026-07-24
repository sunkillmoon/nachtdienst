// Shared event detail panel, used by index (map/list), artist, venue, promoter
// and profile. Self-contained: injects its own markup + CSS (scoped to #nkPanel
// so it can't collide with each page's auth panel or other .panel/.link-btn
// rules) and owns the distance mode (shared with the map list via NkPanel).
(function () {
  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  // ---------- distance (persisted; shared with the map list) ----------
  const LS_DISTANCE = "nachtkaart:distanceMode";
  const DISTANCE_MODES = ["km", "walk", "bike", "car"]; // cycle order
  const SPEED_KMH = { walk: 5, bike: 15, car: 30 };
  const DETOUR = 1.3;
  const distanceListeners = [];

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  let distanceMode = DISTANCE_MODES.includes(safeGet(LS_DISTANCE)) ? safeGet(LS_DISTANCE) : "km";

  function fmtMins(mins) {
    if (mins >= 60) { const h = Math.floor(mins / 60), m = mins % 60; return m ? `${h}H ${m}M` : `${h}H`; }
    return `${mins} MIN`;
  }
  function distancePrimary(km, mode = distanceMode) {
    if (km == null || !isFinite(km)) return "—";
    if (mode === "km") return `${km.toFixed(1)} KM`;
    const mins = Math.round((km * DETOUR) / SPEED_KMH[mode] * 60);
    return `~${fmtMins(mins)} ${mode.toUpperCase()}`;
  }
  function distanceSub(km, mode = distanceMode) {
    if (km == null || !isFinite(km) || mode === "km") return "";
    return `${km.toFixed(1)} KM`;
  }
  function cycleDistanceMode() {
    distanceMode = DISTANCE_MODES[(DISTANCE_MODES.indexOf(distanceMode) + 1) % DISTANCE_MODES.length];
    try { localStorage.setItem(LS_DISTANCE, distanceMode); } catch {}
    for (const cb of distanceListeners) cb();
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  function timeRange(event) {
    if (!event.start) return event.date ? formatDate(event.date) : "—";
    const s = event.start.slice(11, 16);
    return event.end ? `${s}–${event.end.slice(11, 16)}` : s;
  }
  function formatDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }
  // An event has ended once its end (or start) is past; for a date-only archive
  // gig, once its night is before the current night (-8h rule). Ended events can
  // only ever be WENT, never WANT TO GO.
  function eventEnded(event) {
    const now = Date.now();
    if (event.end) return new Date(event.end).getTime() < now;
    if (event.start) return new Date(event.start).getTime() < now;
    if (event.date) return event.date < new Date(now - 8 * 3600 * 1000).toISOString().slice(0, 10);
    return false;
  }
  function posterInitials(title) {
    const w = String(title || "").trim().split(/\s+/).filter(Boolean);
    if (!w.length) return "??";
    return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[1][0]).toUpperCase();
  }
  function venueLinkHtml(v) {
    if (!v || !v.name) return "";
    return v.id != null ? `<a href="venue.html?id=${encodeURIComponent(v.id)}">${esc(v.name)}</a>` : esc(v.name);
  }
  function promotersLinkHtml(promoters) {
    if (!promoters || !promoters.length) return "";
    return promoters.map((p) => `<a href="promoter.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a>`).join(", ");
  }
  function linkifyLineup(line, artists) {
    const escaped = esc(line);
    if (!artists || !artists.length) return escaped;
    const matches = [];
    for (const a of artists) {
      const needle = esc(a.name);
      if (!needle) continue;
      let from = 0, idx;
      while ((idx = escaped.indexOf(needle, from)) !== -1) { matches.push({ start: idx, end: idx + needle.length, id: a.id, text: needle }); from = idx + needle.length; }
    }
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    let out = "", cursor = 0;
    for (const m of matches) {
      if (m.start < cursor) continue;
      out += escaped.slice(cursor, m.start) + `<a href="artist.html?id=${encodeURIComponent(m.id)}">${m.text}</a>`;
      cursor = m.end;
    }
    return out + escaped.slice(cursor);
  }
  function lineupHtml(event) {
    if (event.lineup_text) return event.lineup_text.split("\n").map((l) => linkifyLineup(l, event.artists)).join(", ");
    if (event.artists && event.artists.length) return event.artists.map((a) => `<a href="artist.html?id=${encodeURIComponent(a.id)}">${esc(a.name)}</a>`).join(", ");
    return "";
  }
  function mapsDirectionsUrl(lat, lng) { return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`; }

  // ---------- DOM (injected once) ----------
  let scrimEl, panelEl, bodyEl, closeBtn, handleEl, lightboxEl, lightboxImg;
  let ctx = {}, currentEvent = null;

  function inject() {
    if (document.getElementById("nkPanel")) return;
    const style = document.createElement("style");
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
    const wrap = document.createElement("div");
    wrap.innerHTML =
      `<div class="nk-scrim" id="nkScrim"></div>` +
      `<section class="nk-panel" id="nkPanel" aria-hidden="true">` +
      `<div class="nk-handle" id="nkHandle"></div>` +
      `<div class="nk-close-bar"><button class="nk-close" id="nkClose" type="button" aria-label="Close">CLOSE</button></div>` +
      `<div class="nk-body" id="nkBody"></div></section>` +
      `<div class="nk-lightbox" id="nkLightbox"><img id="nkLightboxImg" src="" alt=""></div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);

    scrimEl = document.getElementById("nkScrim");
    panelEl = document.getElementById("nkPanel");
    bodyEl = document.getElementById("nkBody");
    closeBtn = document.getElementById("nkClose");
    handleEl = document.getElementById("nkHandle");
    lightboxEl = document.getElementById("nkLightbox");
    lightboxImg = document.getElementById("nkLightboxImg");

    scrimEl.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    lightboxEl.addEventListener("click", () => lightboxEl.classList.remove("open"));
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (lightboxEl.classList.contains("open")) lightboxEl.classList.remove("open");
      else if (panelEl.classList.contains("open")) close();
    });
    wireSwipe();
    if (window.NachtkaartAuth) window.NachtkaartAuth.onAuthChange(() => { if (panelEl.classList.contains("open") && currentEvent) renderBody(); });
  }

  function wireSwipe() {
    let startY = null;
    handleEl.addEventListener("touchstart", (e) => { startY = e.touches[0].clientY; panelEl.style.transition = "none"; });
    handleEl.addEventListener("touchmove", (e) => { if (startY == null) return; panelEl.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - startY)}px)`; });
    handleEl.addEventListener("touchend", (e) => {
      if (startY == null) return;
      const delta = Math.max(0, e.changedTouches[0].clientY - startY);
      panelEl.style.transition = ""; panelEl.style.transform = ""; startY = null;
      if (delta > 60) close();
    });
  }

  function renderBody() {
    const event = currentEvent, v = event.venue || {};
    const hasCoords = ctx.coords && v.lat != null && v.lng != null && !v.location_tba;
    const km = hasCoords ? haversineKm(ctx.coords.lat, ctx.coords.lng, v.lat, v.lng) : null;

    const distTile = hasCoords
      ? `<button class="nk-tile" type="button" data-dcycle><span class="k">Distance</span>` +
        `<span class="v">${distancePrimary(km)}</span>` +
        (distanceSub(km) ? `<span class="dsub">${distanceSub(km)}</span>` : "") + `</button>`
      : "";
    const venueSuffix = v.location_tba ? "LOCATION TBA" : hasCoords ? distancePrimary(km) : "";
    const promoters = promotersLinkHtml(event.promoters);
    const lineup = lineupHtml(event);
    const auth = window.NachtkaartAuth;
    const loggedInFav = auth ? auth.isFavoriteVenue(v.name) : false;
    const pickStatus = auth ? auth.getPickStatus(event.id) : null;
    const posterInner = event.flyer_url ? `<img src="${esc(event.flyer_url)}" alt="">` : "";

    bodyEl.innerHTML =
      `<div class="nk-poster${event.flyer_url ? " has-image" : ""}" data-label="${posterInitials(event.title)}">${posterInner}</div>` +
      `<h2>${esc(event.title || "")}</h2>` +
      `<div class="nk-venue">${venueLinkHtml(v)}${venueSuffix ? " · " + venueSuffix : ""}</div>` +
      (promoters ? `<div class="nk-promoter">BY ${promoters}</div>` : "") +
      `<div class="nk-facts${distTile ? "" : " two"}">` +
        `<div><span class="k">Time</span><span class="v">${timeRange(event)}</span></div>` +
        `<div><span class="k">Price</span><span class="v">${event.price ?? "—"}</span></div>` +
        distTile +
      `</div>` +
      (lineup ? `<div class="nk-label">Lineup</div><div class="nk-lineup">${lineup}</div>` : "") +
      `<div class="nk-label">Links</div><div class="nk-links">` +
        (event.ra_url ? `<a class="nk-btn" href="${esc(event.ra_url)}" target="_blank" rel="noopener">RA EVENT PAGE</a>` : "") +
        (hasCoords ? `<a class="nk-btn" href="${mapsDirectionsUrl(v.lat, v.lng)}" target="_blank" rel="noopener">DIRECTIONS</a>` : "") +
        (v.name ? `<button class="nk-btn${loggedInFav ? " active" : ""}" type="button" id="nkFav">${loggedInFav ? "FAVORITED" : "FAVORITE VENUE"}</button>` : "") +
      `</div>` +
      (event.id ? `<div class="nk-rsvp">` +
        `<button class="nk-btn nk-rsvp-btn${pickStatus === "went" ? " active" : ""}" type="button" data-rsvp="went">WENT</button>` +
        (eventEnded(event) ? "" :
          `<button class="nk-btn nk-rsvp-btn${pickStatus === "want_to_go" ? " active" : ""}" type="button" data-rsvp="want_to_go">WANT TO GO</button>`) +
      `</div>` : "");

    const tile = bodyEl.querySelector("[data-dcycle]");
    if (tile) tile.addEventListener("click", () => { cycleDistanceMode(); renderBody(); });

    if (event.flyer_url) bodyEl.querySelector(".nk-poster").addEventListener("click", () => { lightboxImg.src = event.flyer_url; lightboxEl.classList.add("open"); });

    const fav = bodyEl.querySelector("#nkFav");
    if (fav) fav.addEventListener("click", async () => {
      if (!auth.isLoggedIn()) return auth.openLogin();
      await auth.toggleFavoriteVenue(v.name);
      renderBody();
    });
    bodyEl.querySelectorAll("[data-rsvp]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!auth.isLoggedIn()) return auth.openLogin();
      const status = btn.dataset.rsvp;
      const next = auth.getPickStatus(event.id) === status ? null : status;
      await auth.setPick(event.id, next);
      renderBody();
    }));
  }

  function open(event, context) {
    inject();
    currentEvent = event;
    ctx = context || {};
    renderBody();
    panelEl.classList.add("open");
    panelEl.setAttribute("aria-hidden", "false");
    scrimEl.classList.add("open");
    if (ctx.onFlyTo && (event.venue || {}).lat != null) ctx.onFlyTo(event.venue);
    if (ctx.onOpen) ctx.onOpen(event);
  }

  function close() {
    if (!panelEl) return;
    panelEl.classList.remove("open");
    panelEl.setAttribute("aria-hidden", "true");
    scrimEl.classList.remove("open");
    const cb = ctx.onClose;
    currentEvent = null; ctx = {};
    if (cb) cb();
  }

  const PANEL_CSS = `
  .nk-scrim{ position:fixed; inset:0; background:rgba(0,0,0,0.6); opacity:0; pointer-events:none; transition:opacity .2s ease; z-index:30; }
  .nk-scrim.open{ opacity:1; pointer-events:auto; }
  .nk-panel{ position:fixed; left:0; right:0; bottom:0; max-width:960px; margin:0 auto; max-height:88vh; overflow-y:auto;
    background:var(--bg); border-top:1px solid var(--line); transform:translateY(100%); transition:transform .25s ease; z-index:31; }
  .nk-panel.open{ transform:translateY(0); }
  @media (prefers-reduced-motion: reduce){ .nk-scrim, .nk-panel{ transition:none; } }
  .nk-handle{ width:36px; height:4px; background:var(--line); margin:10px auto; }
  .nk-close-bar{ position:sticky; top:0; z-index:2; display:flex; justify-content:flex-end; padding:8px 16px; background:var(--bg); border-bottom:1px solid var(--line); }
  .nk-close{ font-family:var(--font-mono); font-size:11px; letter-spacing:.08em; text-transform:uppercase; background:var(--surface); color:var(--text-dim); border:1px solid var(--line); padding:6px 14px; min-height:auto; cursor:pointer; }
  .nk-close:hover{ border-color:var(--accent); color:var(--accent); }
  .nk-body{ padding:0 16px 24px; }
  .nk-poster{ width:100%; height:160px; margin-bottom:14px; border:1px solid var(--line); position:relative;
    background: repeating-linear-gradient(45deg,#000 0 2px,#1c1c1c 2px 4px), repeating-linear-gradient(-45deg,transparent 0 6px,#000 6px 8px); }
  .nk-poster::after{ content:attr(data-label); position:absolute; left:8px; bottom:8px; font-family:var(--font-display); font-weight:700; text-transform:uppercase; font-size:18px; color:var(--accent); background:var(--bg); padding:2px 6px; }
  .nk-poster img{ width:100%; height:100%; object-fit:contain; background:#000; display:block; }
  .nk-poster.has-image::after{ display:none; }
  .nk-poster.has-image{ cursor:pointer; background:#000; }
  .nk-panel h2{ font-family:var(--font-display); text-transform:uppercase; letter-spacing:-.02em; font-size:22px; margin-bottom:2px; }
  .nk-venue{ color:var(--accent); font-size:13px; margin-bottom:6px; }
  .nk-promoter{ font-size:12px; color:var(--text-dim); margin-bottom:14px; }
  .nk-venue + .nk-facts{ margin-top:8px; }
  .nk-facts{ display:grid; grid-template-columns:1fr 1fr 1fr; border:1px solid var(--line); margin-bottom:14px; }
  .nk-facts.two{ grid-template-columns:1fr 1fr; }
  .nk-facts > div, .nk-tile{ padding:8px 10px; border-right:1px solid var(--line); text-align:left; }
  .nk-facts > *:last-child{ border-right:none; }
  .nk-facts .k, .nk-tile .k{ display:block; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-dim); margin-bottom:2px; }
  .nk-facts .v, .nk-tile .v{ display:block; font-size:14px; font-weight:700; }
  .nk-tile{ background:var(--surface); border-top:none; border-bottom:none; font-family:var(--font-mono); cursor:pointer; }
  .nk-tile .dsub{ display:block; font-size:11px; color:var(--text-dim); margin-top:2px; }
  .nk-tile:hover{ color:var(--accent); }
  .nk-tile:hover .k, .nk-tile:hover .dsub{ color:var(--accent); }
  .nk-label{ font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--text-dim); margin:16px 0 6px; }
  .nk-lineup{ font-size:13px; line-height:1.7; border-top:1px solid var(--line); padding-top:8px; }
  .nk-links{ display:flex; gap:8px; flex-wrap:wrap; }
  .nk-btn{ font-family:var(--font-mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; padding:8px 12px; border:1px solid var(--line);
    background:var(--surface); color:var(--text); text-decoration:none; display:inline-flex; align-items:center; justify-content:center; min-height:44px; cursor:pointer; }
  .nk-btn:hover{ border-color:var(--accent); color:var(--accent); }
  .nk-btn.active{ background:var(--accent); color:var(--bg); border-color:var(--accent); font-weight:700; }
  .nk-rsvp{ display:flex; gap:8px; margin-top:16px; }
  .nk-rsvp-btn{ flex:1; }
  .nk-lightbox{ position:fixed; inset:0; background:#000; display:flex; align-items:center; justify-content:center; opacity:0; pointer-events:none; transition:opacity .2s ease; z-index:40; cursor:pointer; }
  .nk-lightbox.open{ opacity:1; pointer-events:auto; }
  .nk-lightbox img{ max-width:100%; max-height:100%; object-fit:contain; }
  @media (prefers-reduced-motion: reduce){ .nk-lightbox{ transition:none; } }
  `;

  // Entity/profile pages hold only compact "gig" records. Resolve the full event
  // by id (live window, then the archive year for the gig's date) so the panel is
  // rich; fall back to the gig's own fields if it's older than the archive holds.
  let _liveCache = null;
  const _archiveCache = {};
  async function _fetchJson(url) { try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch { return null; } }
  async function resolveGig(gig) {
    if (_liveCache === null) _liveCache = (await _fetchJson(`data/events.json?t=${Date.now()}`)) || [];
    const live = Array.isArray(_liveCache) ? _liveCache.find((e) => e.id === gig.id) : null;
    if (live) return live;
    const year = String(gig.date || "").slice(0, 4);
    if (year) {
      if (!(year in _archiveCache)) _archiveCache[year] = await _fetchJson(`data/archive/${year}.json`);
      const recs = _archiveCache[year];
      if (recs && recs[gig.id]) return recs[gig.id];
    }
    return {
      id: gig.id, title: gig.title, date: gig.date, ra_url: gig.url || gig.ra_url || null,
      venue: { name: gig.venue, id: gig.venue_id, area: gig.area },
    };
  }
  async function openGig(gig, context) { open(await resolveGig(gig), context || {}); }

  window.NkPanel = {
    open,
    openGig,
    close,
    distancePrimary: (km) => distancePrimary(km),
    distanceMode: () => distanceMode,
    onDistanceChange: (cb) => distanceListeners.push(cb),
  };
})();
