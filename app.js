const AMSTERDAM_CENTER = { lat: 52.3676, lng: 4.9041 };
const AMSTERDAM_TZ = "Europe/Amsterdam";
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

const state = {
  allEvents: [],
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
const panelEl = document.getElementById("panel");
const panelBody = document.getElementById("panelBody");
const scrimEl = document.getElementById("scrim");
const clockEl = document.getElementById("clock");
const dateLabelEl = document.getElementById("dateLabel");
const prevDayBtn = document.getElementById("prevDay");
const nextDayBtn = document.getElementById("nextDay");
const geoNoticeEl = document.getElementById("geoNotice");

// ---------- pure helpers ----------

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
  const [, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function posterInitials(title) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function eventsForDate(date) {
  return state.allEvents.filter((e) => e.date === date);
}

function eventsTonight() {
  return eventsForDate(state.todayDate);
}

function sortByDistance(events, coords) {
  return events
    .map((event) => {
      const hasCoords = event.venue.lat != null && event.venue.lng != null;
      const distanceKm = hasCoords
        ? haversineKm(coords.lat, coords.lng, event.venue.lat, event.venue.lng)
        : Infinity;
      return { event, distanceKm };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
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

function tagHtml(tag) {
  return `<span class="tag">${tag}</span>`;
}

function tagsRowHtml(event) {
  const genreTags = event.tags.map(tagHtml).join("");
  const soldOutBadge = event.sold_out ? `<span class="tag danger">SOLD OUT</span>` : "";
  return genreTags + soldOutBadge;
}

// ---------- render ----------

function renderStepper() {
  dateLabelEl.textContent = formatDateLabel(state.selectedDate);
  prevDayBtn.disabled = state.selectedDate <= state.minDate;
  nextDayBtn.disabled = state.selectedDate >= state.maxDate;
}

function renderTicker() {
  const events = eventsTonight();
  if (events.length === 0) {
    tickerEl.innerHTML = `<span class="item">NOTHING SCRAPED FOR TONIGHT YET.</span>`;
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

  const sorted = sortByDistance(events, getCoords());
  listEl.innerHTML = sorted
    .map(
      ({ event }) => `
    <button class="row" type="button" data-id="${event.id}">
      <div class="row-top">
        <span class="row-time">${event.start.slice(11, 16)}</span>
        <div class="row-title">
          <span class="row-event">${event.title}</span>
          <span class="row-venue">${event.venue.name}</span>
        </div>
      </div>
      <div class="row-lineup">${event.lineup.join(", ") || "TBA"}</div>
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

  const startHM = event.start.slice(11, 16);
  const endHM = event.end ? event.end.slice(11, 16) : null;
  const timeStr = endHM ? `${startHM} — ${endHM}` : startHM;

  const lineupHtml = event.lineup.length
    ? event.lineup.map((name) => `<li>${name}</li>`).join("")
    : `<li class="tba">TBA</li>`;

  const posterInner = event.flyer_url ? `<img src="${event.flyer_url}" alt="${event.title} flyer">` : "";

  panelBody.innerHTML = `
    <div class="poster${event.flyer_url ? " has-image" : ""}" data-label="${posterInitials(event.title)}">${posterInner}</div>
    <h2>${event.title}</h2>
    <div class="venue-line">${event.venue.name} · ${distanceStr} away</div>

    <div class="facts">
      <div><span class="k">Time</span><span class="v">${timeStr}</span></div>
      <div><span class="k">Price</span><span class="v">${event.price ?? "—"}</span></div>
      <div><span class="k">Distance</span><span class="v">${distanceStr}</span></div>
    </div>

    <div class="section-label">Lineup</div>
    <ul class="lineup-list">${lineupHtml}</ul>

    <div class="section-label">Links</div>
    <div class="links-row">
      <a class="link-btn" href="${event.ra_url}" target="_blank" rel="noopener">RA EVENT PAGE</a>
    </div>

    <div class="rsvp-row">
      <button class="rsvp-btn" type="button" data-rsvp="went">WENT</button>
      <button class="rsvp-btn" type="button" data-rsvp="want">WANT TO GO</button>
    </div>
  `;

  panelBody.querySelectorAll("[data-rsvp]").forEach((btn) => {
    btn.addEventListener("click", () => btn.classList.toggle("active"));
  });

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

    const el = document.createElement("div");
    el.className = "marker";
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

function stepDate(delta) {
  const newDate = clamp(addDaysToDateStr(state.selectedDate, delta), state.minDate, state.maxDate);
  if (newDate === state.selectedDate) return;
  state.selectedDate = newDate;
  renderStepper();
  renderList();
  updateMarkersForDate(state.selectedDate);
}

async function init() {
  let allEvents = [];
  try {
    const res = await fetch("data/events.json");
    allEvents = await res.json();
  } catch (err) {
    console.error("Failed to load data/events.json", err);
    listEl.innerHTML = `<div class="row-empty">COULD NOT LOAD DATA/EVENTS.JSON — SERVE THIS DIRECTORY OVER HTTP (E.G. "PYTHON -M HTTP.SERVER") RATHER THAN OPENING THE FILE DIRECTLY.</div>`;
    tickerEl.innerHTML = `<span class="item">NO DATA LOADED.</span>`;
    return;
  }

  state.allEvents = allEvents;
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
document.getElementById("closeBtn").addEventListener("click", closePanel);
scrimEl.addEventListener("click", closePanel);

init();
