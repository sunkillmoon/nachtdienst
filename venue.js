const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const CARTO_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
// Cache-bust data fetches so a returning visitor always gets the latest scrape.
const CACHE_BUST = Date.now();

const nameEl = document.getElementById("venueName");
const cityEl = document.getElementById("venueCity");
const linksEl = document.getElementById("linksRow");
const mapEl = document.getElementById("venueMap");
const mainEl = document.getElementById("main");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getParam(name) {
  return new URLSearchParams(location.search).get(name);
}

function formatGigDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function abbr(name) {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const a = words.length >= 2 ? words.slice(0, 4).map((w) => w[0]).join("") : (words[0] || "??").slice(0, 4);
  return a.slice(0, 4).toUpperCase();
}

function renderFavorite(venue) {
  const fav = window.NachtkaartAuth.isFavoriteVenue(venue.name);
  linksEl.innerHTML = `<button class="link-btn${fav ? " active" : ""}" type="button" id="favBtn">${fav ? "FAVORITED" : "FAVORITE VENUE"}</button>`;
  document.getElementById("favBtn").addEventListener("click", async () => {
    if (!window.NachtkaartAuth.isLoggedIn()) {
      window.NachtkaartAuth.openLogin();
      return;
    }
    await window.NachtkaartAuth.toggleFavoriteVenue(venue.name);
    renderFavorite(venue);
  });
}

function renderMap(venue) {
  if (venue.lat == null || venue.lng == null) return; // no coords: map stays hidden
  mapEl.classList.remove("hidden");
  const map = new maplibregl.Map({
    container: "venueMap",
    style: CARTO_DARK,
    center: [venue.lng, venue.lat],
    zoom: 14,
    dragRotate: false,
    attributionControl: { compact: false },
  });
  map.touchZoomRotate.disableRotation();
  const el = document.createElement("div");
  el.className = "marker";
  el.textContent = abbr(venue.name);
  new maplibregl.Marker({ element: el }).setLngLat([venue.lng, venue.lat]).addTo(map);
}

// On the venue page the venue is the subject, so a gig just shows date + title
// (title links out to the RA event page).
function gigHtml(gig) {
  const title = gig.url
    ? `<a class="gig-title" href="${esc(gig.url)}" target="_blank" rel="noopener">${esc(gig.title)}</a>`
    : `<span class="gig-title">${esc(gig.title)}</span>`;
  return `<div class="gig"><span class="gig-date">${formatGigDate(gig.date)}</span><span>${title}</span></div>`;
}

function renderSection(label, gigs) {
  if (!gigs.length) {
    return `<div class="section-label">${label}</div><div class="empty">NONE ON RECORD.</div>`;
  }
  return `<div class="section-label">${label} (${gigs.length})</div>` + gigs.map(gigHtml).join("");
}

async function init() {
  const id = getParam("id");
  if (!id) {
    nameEl.textContent = "NO VENUE";
    mainEl.innerHTML = `<div class="empty">NO VENUE ID IN URL.</div>`;
    return;
  }

  let venue;
  try {
    const res = await fetch(`data/venues/${encodeURIComponent(id)}.json?t=${CACHE_BUST}`);
    if (!res.ok) throw new Error(String(res.status));
    venue = await res.json();
  } catch (err) {
    nameEl.textContent = "UNKNOWN VENUE";
    mainEl.innerHTML = `<div class="empty">NO DATA FOR THIS VENUE YET. ONLY VENUES SEEN IN NACHTKAART GET A PAGE.</div>`;
    return;
  }

  document.title = `NACHTKAART — ${venue.name}`;
  nameEl.textContent = venue.name;
  cityEl.textContent = venue.area && venue.area !== "All" ? venue.area : "";
  renderFavorite(venue);
  renderMap(venue);
  mainEl.innerHTML =
    renderSection("UPCOMING", venue.upcoming || []) +
    renderSection("PAST", venue.past || []);

  // Re-render FAVORITE once the real session/favorite-state resolves and on later changes.
  window.NachtkaartAuth.onAuthChange(() => renderFavorite(venue));
}

init();
