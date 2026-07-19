const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
// Cache-bust data fetches so a returning visitor (especially an installed PWA)
// always gets the latest scrape rather than a cached response.
const CACHE_BUST = Date.now();

const nameEl = document.getElementById("artistName");
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

// Resolve a stored social value into a URL. RA stores either a full URL or a
// bare handle; if it's already a URL use it, otherwise prefix the platform host.
// When we have nothing stored, fall back to a name-based search on that platform.
function socialLink(value, hostPrefix, searchUrl) {
  if (value) {
    if (/^https?:\/\//i.test(value)) return value;
    if (hostPrefix) return hostPrefix + value.replace(/^\/+/, "");
  }
  return searchUrl;
}

function renderLinks(artist) {
  const q = encodeURIComponent(artist.name);
  const s = artist.socials || {};
  const links = [
    ["SOUNDCLOUD", socialLink(s.soundcloud, "https://soundcloud.com/", `https://soundcloud.com/search?q=${q}`)],
    ["BANDCAMP", socialLink(s.bandcamp, null, `https://bandcamp.com/search?q=${q}`)],
    ["SPOTIFY", `https://open.spotify.com/search/${q}`],
    ["DISCOGS", socialLink(s.discogs, null, `https://www.discogs.com/search/?q=${q}&type=artist`)],
  ];
  if (s.website) links.push(["WEBSITE", socialLink(s.website, "https://", s.website)]);

  let html = links
    .map(([label, url]) => `<a class="link-btn" href="${esc(url)}" target="_blank" rel="noopener">${label}</a>`)
    .join("");

  const following = window.NachtkaartAuth.isFollowing(artist.id);
  html += `<button class="link-btn${following ? " active" : ""}" type="button" id="followBtn">${following ? "FOLLOWING" : "FOLLOW"}</button>`;
  linksEl.innerHTML = html;

  document.getElementById("followBtn").addEventListener("click", async () => {
    if (!window.NachtkaartAuth.isLoggedIn()) {
      window.NachtkaartAuth.openLogin();
      return;
    }
    await window.NachtkaartAuth.toggleFollow(artist.id);
    renderLinks(artist);
  });
}

// Row (not a wrapping <a>) so the title can link to RA and the venue to its own
// page as separate, valid links.
function gigHtml(gig) {
  const title = gig.url
    ? `<a class="gig-title" href="${esc(gig.url)}" target="_blank" rel="noopener">${esc(gig.title)}</a>`
    : `<span class="gig-title">${esc(gig.title)}</span>`;
  const venue = gig.venue_id
    ? `<a href="venue.html?id=${encodeURIComponent(gig.venue_id)}">${esc(gig.venue)}</a>`
    : esc(gig.venue);
  return `
    <div class="gig">
      <span class="gig-date">${formatGigDate(gig.date)}</span>
      <span>
        ${title}
        <span class="gig-venue">${venue}${gig.area ? " · " + esc(gig.area) : ""}</span>
      </span>
    </div>`;
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
    nameEl.textContent = "NO ARTIST";
    mainEl.innerHTML = `<div class="empty">NO ARTIST ID IN URL.</div>`;
    return;
  }

  let artist;
  try {
    const res = await fetch(`data/artists/${encodeURIComponent(id)}.json?t=${CACHE_BUST}`);
    if (!res.ok) throw new Error(String(res.status));
    artist = await res.json();
  } catch (err) {
    nameEl.textContent = "UNKNOWN ARTIST";
    linksEl.innerHTML = "";
    mainEl.innerHTML = `<div class="empty">NO DATA FOR THIS ARTIST YET. ONLY RA-LINKED ARTISTS SEEN IN NACHTKAART GET A PAGE.</div>`;
    return;
  }

  document.title = `NACHTKAART — ${artist.name}`;
  nameEl.textContent = artist.name;
  renderLinks(artist);
  mainEl.innerHTML =
    renderSection("UPCOMING", artist.upcoming || []) +
    renderSection("PAST", artist.past || []);

  // Re-render FOLLOW/FOLLOWING once the real session/follow-state resolves
  // (async, so the first paint above assumes logged-out) and on later changes.
  window.NachtkaartAuth.onAuthChange(() => renderLinks(artist));
}

init();
