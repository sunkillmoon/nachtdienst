const AMSTERDAM_CENTER = { lat: 52.3676, lng: 4.9041 };
const AMSTERDAM_TZ = "Europe/Amsterdam";
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const WEEKDAYS = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
// Cache-bust data fetches so a returning visitor (especially an installed PWA)
// always gets the latest scrape rather than a cached response.
const CACHE_BUST = Date.now();

const state = {
  allEvents: [],
  venuesMeta: {},
  todayDate: null,
  minDate: null,
  maxDate: null,
  selectedDate: null,
  userCoords: null,
  selectedEventId: null,
  map: null,
  markers: new Map(), // venueName -> { marker, el, venue, events }
};

const listEl = document.getElementById("eventList");
const tickerEl = document.getElementById("tickerTrack");
const tickerWrapEl = document.querySelector(".ticker");
const panelEl = document.getElementById("panel");
const panelBody = document.getElementById("panelBody");
const panelHandleEl = document.querySelector(".panel-handle");
const scrimEl = document.getElementById("scrim");
const clockEl = document.getElementById("clock");
const dateLabelEl = document.getElementById("dateLabel");
const datePickerEl = document.getElementById("datePicker");
const prevDayBtn = document.getElementById("prevDay");
const nextDayBtn = document.getElementById("nextDay");
const geoNoticeEl = document.getElementById("geoNotice");
const lightboxEl = document.getElementById("lightbox");
const lightboxImgEl = document.getElementById("lightboxImg");

// ---------- pure helpers ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Escape a lineup line, then turn any RA-linked artist names appearing in it into
// links to their artist page. Escaping happens first so RA's third-party text can
// never inject markup; matches are chosen longest-first and non-overlapping.
function linkifyLineup(line, artists) {
  const escaped = esc(line);
  if (!artists || !artists.length) return escaped;

  const matches = [];
  for (const a of artists) {
    const needle = esc(a.name);
    if (!needle) continue;
    let from = 0, idx;
    while ((idx = escaped.indexOf(needle, from)) !== -1) {
      matches.push({ start: idx, end: idx + needle.length, id: a.id, text: needle });
      from = idx + needle.length;
    }
  }
  // Earliest first; among ties prefer the longer match (e.g. "Second Gate" over "Gate").
  matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  let out = "", cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue; // overlaps an already-linked span
    out += escaped.slice(cursor, m.start);
    out += `<a href="artist.html?id=${encodeURIComponent(m.id)}">${m.text}</a>`;
    cursor = m.end;
  }
  out += escaped.slice(cursor);
  return out;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getCoords() {
  return state.userCoords ?? AMSTERDAM_CENTER;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function todayAmsterdam() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: AMSTERDAM_TZ }).format(new Date());
}

function addDaysToDateStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function formatScrapedAt(events) {
  if (events.length === 0) return "UPDATED --:--:--";
  const latest = events.reduce((max, e) => (e.scraped_at > max ? e.scraped_at : max), events[0].scraped_at);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: AMSTERDAM_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `UPDATED ${fmt.format(new Date(latest))}`;
}

function formatDateLabel(dateStr) {
  if (dateStr === state.todayDate) return "TODAY";
  if (dateStr === addDaysToDateStr(state.todayDate, 1)) return "TOMORROW";
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}`;
}

function formatTimeRange(event) {
  const startHM = event.start.slice(11, 16);
  if (!event.end) return startHM;
  return `${startHM}–${event.end.slice(11, 16)}`;
}

function posterInitials(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function autoAbbr(name) {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let abbr;
  if (words.length >= 2) {
    abbr = words.slice(0, 4).map((w) => w[0]).join("").toUpperCase();
  } else if (words.length === 1) {
    abbr = words[0].slice(0, 4).toUpperCase();
  } else {
    abbr = "??";
  }
  return abbr.slice(0, 4);
}

function getVenueMeta(name) {
  return state.venuesMeta[name] ?? { abbr: autoAbbr(name), logo: null };
}

function eventsForDate(date) {
  return state.allEvents.filter((e) => e.date === date);
}

function isEventLive(event) {
  if (state.selectedDate !== state.todayDate) return false;
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = event.end ? new Date(event.end).getTime() : start;
  return start <= now && now <= end;
}

function sortEvents(events, coords) {
  return events
    .map((event) => {
      const hasCoords = event.venue.lat != null && event.venue.lng != null;
      const distanceKm = hasCoords
        ? haversineKm(coords.lat, coords.lng, event.venue.lat, event.venue.lng)
        : Infinity;
      return { event, distanceKm };
    })
    .sort((a, b) => {
      if (a.event.start !== b.event.start) return a.event.start < b.event.start ? -1 : 1;
      return a.distanceKm - b.distanceKm;
    });
}

function venueGroupsForDate(date) {
  const groups = new Map();
  for (const event of eventsForDate(date)) {
    const key = event.venue.name;
    if (!groups.has(key)) {
      groups.set(key, { name: event.venue.name, lat: event.venue.lat, lng: event.venue.lng, events: [] });
    }
    groups.get(key).events.push(event);
  }
  return groups;
}

function lineupPreviewText(event) {
  if (event.lineup_text) return event.lineup_text.replace(/\n/g, ", ");
  if (event.artists.length) return event.artists.map((a) => a.name).join(", ");
  return "TBA";
}

function lineupPanelHtml(event) {
  if (event.lineup_text) {
    return event.lineup_text
      .split("\n")
      .map((line) => `<li>${linkifyLineup(line, event.artists)}</li>`)
      .join("");
  }
  if (event.artists.length) {
    return event.artists
      .map((a) => `<li><a href="artist.html?id=${encodeURIComponent(a.id)}">${esc(a.name)}</a></li>`)
      .join("");
  }
  return `<li class="tba">TBA</li>`;
}

function tagHtml(tag) {
  return `<span class="tag">${tag}</span>`;
}

function tagsRowHtml(event) {
  const genreTags = event.tags.map(tagHtml).join("");
  const soldOutBadge = event.sold_out ? `<span class="tag danger">SOLD OUT</span>` : "";
  const nowBadge = isEventLive(event) ? `<span class="tag now">ON NOW</span>` : "";
  return genreTags + soldOutBadge + nowBadge;
}

function mapsDirectionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// ---------- render ----------

function renderStepper() {
  dateLabelEl.textContent = formatDateLabel(state.selectedDate);
  prevDayBtn.disabled = state.selectedDate <= state.minDate;
  nextDayBtn.disabled = state.selectedDate >= state.maxDate;
  datePickerEl.min = state.minDate;
  datePickerEl.max = state.maxDate;
  datePickerEl.value = state.selectedDate;
}

function renderTicker() {
  const events = eventsForDate(state.selectedDate);
  tickerWrapEl.setAttribute("aria-label", `${formatDateLabel(state.selectedDate)}'s headline events`);
  if (events.length === 0) {
    tickerEl.innerHTML = `<span class="item">NOTHING SCRAPED FOR THIS NIGHT YET.</span>`;
    return;
  }
  const items = events
    .map((e) => `<span class="item">${e.title} <span class="v">${e.venue.name}</span></span><span class="sep">•</span>`)
    .join("");
  // duplicated once for a seamless 50%-translate loop
  tickerEl.innerHTML = items + items;
}

function renderList() {
  const events = eventsForDate(state.selectedDate);
  if (events.length === 0) {
    listEl.innerHTML = `<div class="row-empty">NOTHING SCRAPED FOR THIS NIGHT YET.</div>`;
    return;
  }

  const sorted = sortEvents(events, getCoords());
  listEl.innerHTML = sorted
    .map(
      ({ event }) => `
    <button class="row" type="button" data-id="${event.id}">
      <div class="row-top">
        <span class="row-time">${formatTimeRange(event)}</span>
        <div class="row-title">
          <span class="row-event">${event.title}</span>
          <span class="row-venue">${event.venue.name}</span>
        </div>
      </div>
      <div class="row-lineup">${lineupPreviewText(event)}</div>
      <div class="row-tags">${tagsRowHtml(event)}</div>
    </button>
  `
    )
    .join("");

  listEl.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", () => openPanel(row.dataset.id));
  });

  syncActiveStates();
}

function openPanel(eventId) {
  const event = state.allEvents.find((e) => e.id === eventId);
  if (!event) return;

  state.selectedEventId = eventId;

  const coords = getCoords();
  const hasCoords = event.venue.lat != null && event.venue.lng != null;
  const distanceKm = hasCoords ? haversineKm(coords.lat, coords.lng, event.venue.lat, event.venue.lng) : null;
  const distanceStr = distanceKm != null ? `${distanceKm.toFixed(1)} km` : "—";
  const distanceHtml = hasCoords
    ? `<a href="${mapsDirectionsUrl(event.venue.lat, event.venue.lng)}" target="_blank" rel="noopener">${distanceStr}</a>`
    : distanceStr;

  const posterInner = event.flyer_url ? `<img src="${event.flyer_url}" alt="${event.title} flyer">` : "";
  const pickStatus = window.NachtdienstAuth.getPickStatus(event.id);
  const isFavVenue = window.NachtdienstAuth.isFavoriteVenue(event.venue.name);

  panelBody.innerHTML = `
    <div class="poster${event.flyer_url ? " has-image" : ""}" data-label="${posterInitials(event.title)}">${posterInner}</div>
    <h2>${event.title}</h2>
    <div class="venue-line">${event.venue.name} · ${distanceHtml} away</div>

    <div class="facts">
      <div><span class="k">Time</span><span class="v">${formatTimeRange(event)}</span></div>
      <div><span class="k">Price</span><span class="v">${event.price ?? "—"}</span></div>
      <div><span class="k">Distance</span><span class="v">${distanceHtml}</span></div>
    </div>

    <div class="section-label">Lineup</div>
    <ul class="lineup-list">${lineupPanelHtml(event)}</ul>

    <div class="section-label">Links</div>
    <div class="links-row">
      <a class="link-btn" href="${event.ra_url}" target="_blank" rel="noopener">RA EVENT PAGE</a>
      <button class="link-btn${isFavVenue ? " active" : ""}" type="button" id="favVenueBtn">${isFavVenue ? "FAVORITED" : "FAVORITE VENUE"}</button>
    </div>

    <div class="rsvp-row">
      <button class="rsvp-btn${pickStatus === "went" ? " active" : ""}" type="button" data-rsvp="went">WENT</button>
      <button class="rsvp-btn${pickStatus === "want_to_go" ? " active" : ""}" type="button" data-rsvp="want_to_go">WANT TO GO</button>
    </div>
  `;

  panelBody.querySelectorAll("[data-rsvp]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const status = btn.dataset.rsvp;
      const current = window.NachtdienstAuth.getPickStatus(event.id);
      const next = current === status ? null : status;
      await window.NachtdienstAuth.setPick(event.id, next);
      panelBody.querySelectorAll("[data-rsvp]").forEach((b) => {
        b.classList.toggle("active", b.dataset.rsvp === next);
      });
    });
  });

  document.getElementById("favVenueBtn").addEventListener("click", async () => {
    if (!window.NachtdienstAuth.isLoggedIn()) {
      window.NachtdienstAuth.openLogin();
      return;
    }
    await window.NachtdienstAuth.toggleFavoriteVenue(event.venue.name);
    const nowFav = window.NachtdienstAuth.isFavoriteVenue(event.venue.name);
    const favBtn = document.getElementById("favVenueBtn");
    favBtn.textContent = nowFav ? "FAVORITED" : "FAVORITE VENUE";
    favBtn.classList.toggle("active", nowFav);
  });

  if (event.flyer_url) {
    panelBody.querySelector(".poster").addEventListener("click", () => openLightbox(event.flyer_url));
  }

  panelEl.classList.add("open");
  panelEl.setAttribute("aria-hidden", "false");
  scrimEl.classList.add("open");

  syncActiveStates();
  flyToVenue({ lat: event.venue.lat, lng: event.venue.lng });
}

function closePanel() {
  panelEl.classList.remove("open");
  panelEl.setAttribute("aria-hidden", "true");
  scrimEl.classList.remove("open");
  state.selectedEventId = null;
  syncActiveStates();
}

function openLightbox(url) {
  lightboxImgEl.src = url;
  lightboxEl.classList.add("open");
}

function closeLightbox() {
  lightboxEl.classList.remove("open");
}

function syncActiveStates() {
  listEl.querySelectorAll(".row.active").forEach((row) => row.classList.remove("active"));
  for (const { el } of state.markers.values()) el.classList.remove("active");

  if (!state.selectedEventId) return;

  const row = listEl.querySelector(`.row[data-id="${state.selectedEventId}"]`);
  if (row) row.classList.add("active");

  for (const { el, events } of state.markers.values()) {
    if (events.some((e) => e.id === state.selectedEventId)) el.classList.add("active");
  }
}

// ---------- map ----------

function initMap() {
  state.map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    center: [AMSTERDAM_CENTER.lng, AMSTERDAM_CENTER.lat],
    zoom: 12,
    dragRotate: false,
    attributionControl: { compact: false },
  });
  state.map.touchZoomRotate.disableRotation();
  state.map.on("load", () => {
    updateMarkersForDate(state.selectedDate);
  });
}

function updateMarkersForDate(date) {
  for (const { marker } of state.markers.values()) marker.remove();
  state.markers.clear();

  const groups = venueGroupsForDate(date);
  for (const venue of groups.values()) {
    if (venue.lat == null || venue.lng == null) continue;

    const meta = getVenueMeta(venue.name);
    const el = document.createElement("div");
    el.className = "marker";
    el.title = venue.name;
    if (venue.events.some(isEventLive)) el.classList.add("live");
    if (meta.logo) {
      el.innerHTML = `<img src="${meta.logo}" alt="${venue.name}">`;
    } else {
      el.textContent = meta.abbr;
    }

    el.addEventListener("click", () => {
      const earliest = [...venue.events].sort((a, b) => (a.start < b.start ? -1 : 1))[0];
      openPanel(earliest.id);
    });

    const marker = new maplibregl.Marker({ element: el }).setLngLat([venue.lng, venue.lat]).addTo(state.map);
    state.markers.set(venue.name, { marker, el, venue, events: venue.events });
  }

  syncActiveStates();
}

function flyToVenue(venue) {
  if (!state.map || venue.lat == null || venue.lng == null) return;
  state.map.flyTo({ center: [venue.lng, venue.lat], zoom: Math.max(state.map.getZoom(), 14) });
}

// ---------- geolocation ----------

function requestGeolocation() {
  if (!("geolocation" in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      geoNoticeEl.classList.add("hidden");
      renderList();
      if (state.map) {
        state.map.easeTo({ center: [state.userCoords.lng, state.userCoords.lat], duration: 600 });
      }
    },
    () => {
      // denied, unavailable, or timed out: geo-notice stays visible, fallback stays in effect
    },
    { maximumAge: 5 * 60 * 1000, timeout: 8000 }
  );
}

// ---------- orchestration ----------

function renderForSelectedDate() {
  renderStepper();
  renderTicker();
  renderList();
  updateMarkersForDate(state.selectedDate);
}

function stepDate(delta) {
  const newDate = clamp(addDaysToDateStr(state.selectedDate, delta), state.minDate, state.maxDate);
  if (newDate === state.selectedDate) return;
  state.selectedDate = newDate;
  renderForSelectedDate();
}

function onDatePickerChange() {
  if (!datePickerEl.value) return;
  const newDate = clamp(datePickerEl.value, state.minDate, state.maxDate);
  if (newDate === state.selectedDate) {
    renderStepper(); // snap the input back if the chosen value was out of range
    return;
  }
  state.selectedDate = newDate;
  renderForSelectedDate();
}

function wirePanelDrag() {
  let startY = null;

  panelHandleEl.addEventListener("touchstart", (e) => {
    startY = e.touches[0].clientY;
    panelEl.style.transition = "none";
  });

  panelHandleEl.addEventListener("touchmove", (e) => {
    if (startY == null) return;
    const delta = Math.max(0, e.touches[0].clientY - startY);
    panelEl.style.transform = `translateY(${delta}px)`;
  });

  panelHandleEl.addEventListener("touchend", (e) => {
    if (startY == null) return;
    const delta = Math.max(0, e.changedTouches[0].clientY - startY);
    panelEl.style.transition = "";
    panelEl.style.transform = "";
    startY = null;
    if (delta > 60) closePanel();
  });
}

async function init() {
  let allEvents = [];
  let venuesMeta = {};
  try {
    const [eventsRes, venuesRes] = await Promise.all([
      fetch(`data/events.json?t=${CACHE_BUST}`),
      fetch(`data/venues.json?t=${CACHE_BUST}`),
    ]);
    allEvents = await eventsRes.json();
    venuesMeta = venuesRes.ok ? await venuesRes.json() : {};
  } catch (err) {
    console.error("Failed to load data", err);
    listEl.innerHTML = `<div class="row-empty">COULD NOT LOAD DATA/EVENTS.JSON — SERVE THIS DIRECTORY OVER HTTP (E.G. "PYTHON -M HTTP.SERVER") RATHER THAN OPENING THE FILE DIRECTLY.</div>`;
    tickerEl.innerHTML = `<span class="item">NO DATA LOADED.</span>`;
    return;
  }

  state.allEvents = allEvents;
  state.venuesMeta = venuesMeta;
  state.todayDate = todayAmsterdam();

  const dates = [...new Set(allEvents.map((e) => e.date))].sort();
  state.minDate = dates[0] ?? state.todayDate;
  state.maxDate = dates[dates.length - 1] ?? state.todayDate;
  state.selectedDate = clamp(state.todayDate, state.minDate, state.maxDate);

  clockEl.textContent = formatScrapedAt(allEvents);

  renderStepper();
  renderTicker();
  renderList();
  initMap();
  requestGeolocation();
}

prevDayBtn.addEventListener("click", () => stepDate(-1));
nextDayBtn.addEventListener("click", () => stepDate(1));
dateLabelEl.addEventListener("click", () => {
  if (datePickerEl.showPicker) datePickerEl.showPicker();
  else datePickerEl.focus();
});
datePickerEl.addEventListener("change", onDatePickerChange);

scrimEl.addEventListener("click", closePanel);
lightboxEl.addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && panelEl.classList.contains("open")) closePanel();
});
wirePanelDrag();

// Re-render the open panel's pick/favorite state (and the list, since a pick
// there could change ordering in a future step) whenever login state changes.
window.NachtdienstAuth.onAuthChange(() => {
  if (panelEl.classList.contains("open") && state.selectedEventId) {
    openPanel(state.selectedEventId);
  }
});

init();
