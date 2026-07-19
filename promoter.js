const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
// Cache-bust data fetches so a returning visitor always gets the latest scrape.
const CACHE_BUST = Date.now();

const nameEl = document.getElementById("promoterName");
const linksEl = document.getElementById("linksRow");
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

// FOLLOW is a placeholder this batch: no backend table yet. Logged-out visitors
// get nudged to log in; logged-in visitors see a disabled "FOLLOWING SOON".
function renderFollow() {
  const loggedIn = window.NachtkaartAuth.isLoggedIn();
  linksEl.innerHTML = loggedIn
    ? `<button class="link-btn" type="button" id="followBtn" disabled>FOLLOWING SOON</button>`
    : `<button class="link-btn" type="button" id="followBtn">FOLLOW</button>`;
  const btn = document.getElementById("followBtn");
  if (!loggedIn) {
    btn.addEventListener("click", () => window.NachtkaartAuth.openLogin());
  }
}

function topArtistsHtml(list) {
  if (!list || !list.length) return "";
  const chips = list
    .map(
      (a) =>
        `<a class="chip" href="artist.html?id=${encodeURIComponent(a.id)}">${esc(a.name)}<span class="n">${a.count}</span></a>`
    )
    .join("");
  return `<div class="section-label">OFTEN BOOKS</div><div class="chips">${chips}</div>`;
}

// A promoter's gig links out to the RA event (title) and to the venue page.
function gigHtml(gig) {
  const title = gig.url
    ? `<a class="gig-title" href="${esc(gig.url)}" target="_blank" rel="noopener">${esc(gig.title)}</a>`
    : `<span class="gig-title">${esc(gig.title)}</span>`;
  const venue = gig.venue_id
    ? `<a href="venue.html?id=${encodeURIComponent(gig.venue_id)}">${esc(gig.venue)}</a>`
    : esc(gig.venue);
  const sub = `<span class="gig-sub">${venue}${gig.area ? " · " + esc(gig.area) : ""}</span>`;
  return `<div class="gig"><span class="gig-date">${formatGigDate(gig.date)}</span><span>${title}${sub}</span></div>`;
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
    nameEl.textContent = "NO PROMOTER";
    mainEl.innerHTML = `<div class="empty">NO PROMOTER ID IN URL.</div>`;
    return;
  }

  let promoter;
  try {
    const res = await fetch(`data/promoters/${encodeURIComponent(id)}.json?t=${CACHE_BUST}`);
    if (!res.ok) throw new Error(String(res.status));
    promoter = await res.json();
  } catch (err) {
    nameEl.textContent = "UNKNOWN PROMOTER";
    mainEl.innerHTML = `<div class="empty">NO DATA FOR THIS PROMOTER YET. ONLY PROMOTERS SEEN IN NACHTKAART GET A PAGE.</div>`;
    return;
  }

  document.title = `NACHTKAART — ${promoter.name}`;
  nameEl.textContent = promoter.name;
  renderFollow();
  mainEl.innerHTML =
    topArtistsHtml(promoter.top_artists) +
    renderSection("UPCOMING", promoter.upcoming || []) +
    renderSection("PAST", promoter.past || []);

  window.NachtkaartAuth.onAuthChange(renderFollow);
}

init();
