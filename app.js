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
  cityCentroids: [], // [{ city, lat, lng }] derived from the data, for the header label
  cities: [],        // distinct real venue.area values, for the city filter
  cityFilter: "ALL", // "ALL" or a specific venue.area; persisted
  freeOnly: false,   // when true, only price == "FREE" events; persisted
  map: null,
  markers: new Map(), // venueName/clusterKey -> { marker, el, venue, events }
  userMarker: null,   // maplibre Marker for the visitor's own position
};

// Persisted UI preferences (nachtkaart: prefix, matching auth.js).
const LS_CITY = "nachtkaart:cityFilter";
const LS_FREE = "nachtkaart:freeOnly";

function safeGetItem(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}

const listEl = document.getElementById("eventList");
const tickerEl = document.getElementById("tickerTrack");
const tickerWrapEl = document.querySelector(".ticker");
const clockEl = document.getElementById("clock");
const cityLabelEl = document.getElementById("cityLabel");
const dateLabelEl = document.getElementById("dateLabel");
const datePickerEl = document.getElementById("datePicker");
const cityFilterEl = document.getElementById("cityFilter");
const freeToggleEl = document.getElementById("freeToggle");
const prevDayBtn = document.getElementById("prevDay");
const nextDayBtn = document.getElementById("nextDay");
const geoNoticeEl = document.getElementById("geoNotice");

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

// Header city label is data-driven, not hardcoded: group venues by their RA
// area (city), drop the non-city national aggregate "All", and take a per-axis
// median of each city's venue coords -- median resists the odd mis-placed venue
// pulling a centroid into the sea. New cities appearing in the data become
// candidates automatically.
function buildCityCentroids(events) {
  const byCity = new Map();
  for (const e of events) {
    const area = e.venue.area;
    if (!area || area === "All") continue;
    if (e.venue.lat == null || e.venue.lng == null) continue;
    if (!byCity.has(area)) byCity.set(area, []);
    byCity.get(area).push([e.venue.lat, e.venue.lng]);
  }
  const median = (nums) => {
    const s = [...nums].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const centroids = [];
  for (const [city, pts] of byCity) {
    centroids.push({ city, lat: median(pts.map((p) => p[0])), lng: median(pts.map((p) => p[1])) });
  }
  return centroids;
}

function nearestCity(coords, centroids) {
  let best = null, bestKm = Infinity;
  for (const c of centroids) {
    const km = haversineKm(coords.lat, coords.lng, c.lat, c.lng);
    if (km < bestKm) { bestKm = km; best = c; }
  }
  return best ? best.city : null;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Which "night" a moment/event belongs to: a party starting 23:00 and one
// starting 02:00 the "next" calendar day are the same night out, so grouping
// by plain calendar date is wrong right when it matters most -- just after
// midnight. An event/moment belongs to the night of (it - 8h).date(). Matches
// scraper/nightlogic.py exactly (documented as core domain logic in CLAUDE.md).
const NIGHT_CUTOFF_HOURS = 8;

function nightOf(dateInput) {
  const t = new Date(dateInput).getTime() - NIGHT_CUTOFF_HOURS * 60 * 60 * 1000;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: AMSTERDAM_TZ }).format(new Date(t));
}

function currentNightAmsterdam() {
  return nightOf(new Date());
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

// The one place list, ticker, and map markers all read from -- so the city
// filter applied here filters all three consistently. The list stays
// chronological (see sortEvents); this filters, it never regroups.
function eventsForDate(date) {
  return state.allEvents.filter(
    (e) => e.date === date &&
      (state.cityFilter === "ALL" || e.venue.area === state.cityFilter) &&
      (!state.freeOnly || e.price === "FREE")
  );
}

function isEventLive(event) {
  if (state.selectedDate !== state.todayDate) return false;
  const now = Date.now();
  const start = new Date(event.start).getTime();
  const end = event.end ? new Date(event.end).getTime() : start;
  return start <= now && now <= end;
}

function isEventEnded(event) {
  if (state.selectedDate !== state.todayDate) return false;
  const now = Date.now();
  const end = event.end ? new Date(event.end).getTime() : new Date(event.start).getTime();
  return now > end;
}

// "STARTS IN ~2H" for tonight's not-yet-started events within the next 6 hours.
// Null otherwise (other nights, already started, or further out than 6h).
const STARTS_SOON_MS = 6 * 60 * 60 * 1000;

function startsSoonText(event) {
  if (state.selectedDate !== state.todayDate) return null;
  const diff = new Date(event.start).getTime() - Date.now();
  if (diff <= 0 || diff > STARTS_SOON_MS) return null;
  const mins = Math.round(diff / 60000);
  return mins >= 60 ? `STARTS IN ~${Math.round(mins / 60)}H` : `STARTS IN ~${mins} MIN`;
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

// One flowing comma-separated list rather than one row per name -- a 12-artist
// lineup should be a few wrapped lines, not a 12-row tower. RA-linked names come
// out as accent <a>; plain support acts stay in body text.
function lineupPanelHtml(event) {
  if (event.lineup_text) {
    return event.lineup_text
      .split("\n")
      .map((line) => linkifyLineup(line, event.artists))
      .join(", ");
  }
  if (event.artists.length) {
    return event.artists
      .map((a) => `<a href="artist.html?id=${encodeURIComponent(a.id)}">${esc(a.name)}</a>`)
      .join(", ");
  }
  return `<span class="tba">TBA</span>`;
}

function tagHtml(tag) {
  return `<span class="tag">${tag}</span>`;
}

// The current-night timing state of an event is one of live / ended / starts-soon
// (or none) -- mutually exclusive, checked in that order.
function timingBadge(event) {
  if (isEventLive(event)) return `<span class="tag now">ON NOW</span>`;
  if (isEventEnded(event)) return `<span class="tag ended">ENDED</span>`;
  const soon = startsSoonText(event);
  return soon ? `<span class="tag">${soon}</span>` : "";
}

function tagsRowHtml(event) {
  const genreTags = event.tags.map(tagHtml).join("");
  const soldOutBadge = event.sold_out ? `<span class="tag danger">SOLD OUT</span>` : "";
  // City only when unfiltered -- once you've filtered to a city it's just noise.
  const cityBadge =
    state.cityFilter === "ALL" && event.venue.area && event.venue.area !== "All"
      ? `<span class="tag city">${esc(event.venue.area.toUpperCase())}</span>`
      : "";
  const tbaBadge = event.venue.location_tba ? `<span class="tag">LOCATION TBA</span>` : "";
  return genreTags + cityBadge + soldOutBadge + timingBadge(event) + tbaBadge;
}

function mapsDirectionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

// Venue/promoter names link to their own pages when RA gives us an id. (Text is
// kept unescaped to match the rest of this renderer, which trusts RA's strings.)
function venueLinkHtml(venue) {
  return venue.id != null
    ? `<a href="venue.html?id=${encodeURIComponent(venue.id)}">${venue.name}</a>`
    : venue.name;
}

function promotersLinkHtml(promoters) {
  if (!promoters || !promoters.length) return "";
  return promoters
    .map((p) => `<a href="promoter.html?id=${encodeURIComponent(p.id)}">${p.name}</a>`)
    .join(", ");
}

// The distance value + travel-mode estimator live in panel.js (NkPanel), shared
// with the detail panel; the list rows just read the current-mode value.

// ---------- render ----------

function renderStepper() {
  dateLabelEl.textContent = formatDateLabel(state.selectedDate);
  prevDayBtn.disabled = state.selectedDate <= state.minDate;
  nextDayBtn.disabled = state.selectedDate >= state.maxDate;
  datePickerEl.min = state.minDate;
  datePickerEl.max = state.maxDate;
  datePickerEl.value = state.selectedDate;
}

const TICKER_PIXELS_PER_SECOND = 60;
let tickerAnimation = null;

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Web Animations API instead of a CSS @keyframes/%-transform loop -- percentage
// transforms on an intrinsically-sized flex box are a known source of iOS
// Safari animation bugs (the ticker just wouldn't move at all). Measuring the
// actual pixel width also gives a constant px/sec speed regardless of how much
// text is in a given night's ticker, rather than a fixed duration that made
// longer content race by and short content crawl.
async function startTickerAnimation() {
  if (tickerAnimation) {
    tickerAnimation.cancel();
    tickerAnimation = null;
  }
  if (reducedMotion()) return;

  await document.fonts.ready; // measure post-webfont-swap, not fallback-font metrics

  const singleWidth = tickerEl.scrollWidth / 2; // content is always duplicated below
  if (!singleWidth || singleWidth <= tickerWrapEl.clientWidth) return; // fits, nothing to scroll

  const duration = (singleWidth / TICKER_PIXELS_PER_SECOND) * 1000;
  tickerAnimation = tickerEl.animate(
    [{ transform: "translateX(0)" }, { transform: `translateX(-${singleWidth}px)` }],
    { duration, iterations: Infinity, easing: "linear" }
  );
}

function renderTicker() {
  const events = eventsForDate(state.selectedDate);
  tickerWrapEl.setAttribute("aria-label", `${formatDateLabel(state.selectedDate)}'s headline events`);
  const html =
    events.length === 0
      ? `<span class="item">NOTHING SCRAPED FOR THIS NIGHT YET.</span>`
      : events
          .map((e) => `<span class="item">${e.title} <span class="v">${e.venue.name}</span></span><span class="sep">•</span>`)
          .join("");
  // duplicated once for a seamless loop (see startTickerAnimation)
  tickerEl.innerHTML = html + html;
  startTickerAnimation();
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
      ({ event, distanceKm }) => {
        const promoters = promotersLinkHtml(event.promoters);
        return `
    <div class="row${isEventEnded(event) ? " ended" : ""}" role="button" tabindex="0" data-id="${event.id}">
      <div class="row-top">
        <span class="row-time">${formatTimeRange(event)}</span>
        <div class="row-title">
          <span class="row-event">${event.title}</span>
          <span class="row-venue">${venueLinkHtml(event.venue)}<span class="row-dist">${window.NkPanel.distancePrimary(distanceKm)}</span></span>
          ${promoters ? `<span class="row-promoter">BY ${promoters}</span>` : ""}
        </div>
      </div>
      <div class="row-lineup">${lineupPreviewText(event)}</div>
      <div class="row-tags">${tagsRowHtml(event)}</div>
    </div>
  `;
      }
    )
    .join("");

  // The row opens the detail panel, but inner venue/promoter links must win —
  // it's a div (not a button) so those anchors are valid nested interactives.
  listEl.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      openEvent(row.dataset.id);
    });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEvent(row.dataset.id);
      }
    });
  });

  syncActiveStates();
}

function openEvent(eventId) {
  const event = state.allEvents.find((e) => e.id === eventId);
  if (!event) return;
  window.NkPanel.open(event, {
    coords: getCoords(),
    onFlyTo: (v) => flyToVenue(v),
    onOpen: () => { state.selectedEventId = eventId; syncActiveStates(); },
    onClose: () => { state.selectedEventId = null; syncActiveStates(); },
  });
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
    renderMapMarkers();
    showUserLocationMarker(); // in case geolocation resolved before the map loaded
  });
  // Re-cluster whenever the view settles: zooming in splits piles into squares.
  state.map.on("moveend", renderMapMarkers);
}

function addVenueMarker(venue) {
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
    openEvent(earliest.id);
  });

  const marker = new maplibregl.Marker({ element: el }).setLngLat([venue.lng, venue.lat]).addTo(state.map);
  state.markers.set(venue.name, { marker, el, venue, events: venue.events });
}

function addClusterMarker(cluster, key) {
  const venues = cluster.map((c) => c.v);
  const lng = venues.reduce((s, v) => s + v.lng, 0) / venues.length;
  const lat = venues.reduce((s, v) => s + v.lat, 0) / venues.length;
  const events = venues.flatMap((v) => v.events);

  const el = document.createElement("div");
  el.className = "marker cluster";
  el.title = venues.map((v) => v.name).join(", ");
  el.textContent = String(venues.length);
  if (events.some(isEventLive)) el.classList.add("live");

  el.addEventListener("click", () => {
    state.map.easeTo({ center: [lng, lat], zoom: state.map.getZoom() + 2 });
  });

  const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(state.map);
  state.markers.set(key, { marker, el, events });
}

// Hand-rolled clustering (no library): project each venue to screen pixels at
// the current zoom, greedily group any within CLUSTER_PX of a seed into one
// count-square, and render lone venues as normal markers. Runs on every
// moveend, so panning/zooming re-clusters; the user-location marker is separate
// (state.userMarker) and untouched here.
const CLUSTER_PX = 28;

function renderMapMarkers() {
  if (!state.map) return;
  for (const { marker } of state.markers.values()) marker.remove();
  state.markers.clear();

  const venues = [...venueGroupsForDate(state.selectedDate).values()].filter(
    (v) => v.lat != null && v.lng != null
  );
  const pts = venues.map((v) => ({ v, p: state.map.project([v.lng, v.lat]) }));
  const used = new Array(pts.length).fill(false);

  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const cluster = [pts[i]];
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      if (Math.hypot(pts[i].p.x - pts[j].p.x, pts[i].p.y - pts[j].p.y) <= CLUSTER_PX) {
        used[j] = true;
        cluster.push(pts[j]);
      }
    }
    if (cluster.length === 1) addVenueMarker(cluster[0].v);
    else addClusterMarker(cluster, `cluster:${i}`);
  }

  syncActiveStates();
}

// The visitor's own position: an accent crosshair, distinct from venue squares,
// shown only once geolocation is granted. Kept out of state.markers so the
// clustering re-render never clears it.
function showUserLocationMarker() {
  if (!state.map || !state.userCoords) return;
  const lngLat = [state.userCoords.lng, state.userCoords.lat];
  if (state.userMarker) {
    state.userMarker.setLngLat(lngLat);
    return;
  }
  const el = document.createElement("div");
  el.className = "marker-me";
  el.title = "You are here";
  state.userMarker = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(state.map);
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
      const city = nearestCity(state.userCoords, state.cityCentroids);
      if (city) cityLabelEl.textContent = city.toUpperCase();
      renderList();
      if (state.map) {
        showUserLocationMarker();
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
  renderMapMarkers();
}

function stepDate(delta) {
  const newDate = clamp(addDaysToDateStr(state.selectedDate, delta), state.minDate, state.maxDate);
  if (newDate === state.selectedDate) return;
  state.selectedDate = newDate;
  renderForSelectedDate();
}

function setCityFilter(city) {
  state.cityFilter = city;
  try { localStorage.setItem(LS_CITY, city); } catch (_) {}
  renderTicker();
  renderList();
  renderMapMarkers();
}

function setFreeOnly(on) {
  state.freeOnly = on;
  try { localStorage.setItem(LS_FREE, on ? "1" : "0"); } catch (_) {}
  freeToggleEl.classList.toggle("active", on);
  freeToggleEl.setAttribute("aria-pressed", on ? "true" : "false");
  renderTicker();
  renderList();
  renderMapMarkers();
}

// Populate the city <select> with ALL + every real city present in the data.
function buildCityFilterOptions() {
  const opts = ['<option value="ALL">ALL CITIES</option>'];
  for (const city of state.cities) {
    const sel = city === state.cityFilter ? " selected" : "";
    opts.push(`<option value="${esc(city)}"${sel}>${esc(city.toUpperCase())}</option>`);
  }
  cityFilterEl.innerHTML = opts.join("");
  cityFilterEl.value = state.cityFilter;
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
  state.cityCentroids = buildCityCentroids(allEvents);
  state.cities = [...new Set(allEvents.map((e) => e.venue.area).filter((a) => a && a !== "All"))].sort();
  state.todayDate = currentNightAmsterdam();

  // Restore persisted filters; ignore a stored city that isn't in this data.
  const savedCity = safeGetItem(LS_CITY);
  state.cityFilter = savedCity && state.cities.includes(savedCity) ? savedCity : "ALL";
  state.freeOnly = safeGetItem(LS_FREE) === "1";
  buildCityFilterOptions();
  freeToggleEl.classList.toggle("active", state.freeOnly);
  freeToggleEl.setAttribute("aria-pressed", state.freeOnly ? "true" : "false");

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

// showPicker() must run synchronously inside a real user-gesture handler, and
// isn't available everywhere -- where it's missing, fall back to a genuinely
// visible/tappable native input rather than a JS-triggered call that can't work.
if (typeof HTMLInputElement !== "undefined" && "showPicker" in HTMLInputElement.prototype) {
  dateLabelEl.addEventListener("click", () => datePickerEl.showPicker());
} else {
  datePickerEl.classList.add("visible-fallback");
}
datePickerEl.addEventListener("change", onDatePickerChange);
cityFilterEl.addEventListener("change", () => setCityFilter(cityFilterEl.value));
freeToggleEl.addEventListener("click", () => setFreeOnly(!state.freeOnly));

matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => startTickerAnimation());

// When the distance mode changes (tapping the panel's DISTANCE tile), re-render
// the list rows so their distance value follows. The panel manages its own
// re-render + auth-driven refresh (see panel.js).
window.NkPanel.onDistanceChange(() => renderList());

init();
