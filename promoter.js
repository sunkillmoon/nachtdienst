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
// Real follow toggle (kind: promoter), mirroring the artist page.
function renderFollow(promoter) {
  const following = window.NachtkaartAuth.isFollowing(promoter.id, "promoter");
  linksEl.innerHTML = `<button class="link-btn${following ? " active" : ""}" type="button" id="followBtn">${following ? "FOLLOWING" : "FOLLOW"}</button>`;
  document.getElementById("followBtn").addEventListener("click", async () => {
    if (!window.NachtkaartAuth.isLoggedIn()) {
      window.NachtkaartAuth.openLogin();
      return;
    }
    await window.NachtkaartAuth.toggleFollow(promoter.id, "promoter");
    renderFollow(promoter);
  });
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

// A promoter's gig row opens the shared detail panel; the venue links out.
let gigs = [];
function gigHtml(gig) {
  const gi = gigs.push(gig) - 1;
  const venue = gig.venue_id
    ? `<a href="venue.html?id=${encodeURIComponent(gig.venue_id)}">${esc(gig.venue)}</a>`
    : esc(gig.venue);
  const sub = `<span class="gig-sub">${venue}${gig.area ? " · " + esc(gig.area) : ""}</span>`;
  return `<div class="gig" role="button" tabindex="0" data-gi="${gi}"><span class="gig-date">${formatGigDate(gig.date)}</span><span><span class="gig-title">${esc(gig.title)}</span>${sub}</span></div>`;
}

function wireGigRows(el) {
  el.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const row = e.target.closest("[data-gi]");
    if (row) window.NkPanel.openGig(gigs[Number(row.dataset.gi)]);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target.closest("[data-gi]");
    if (row) { e.preventDefault(); window.NkPanel.openGig(gigs[Number(row.dataset.gi)]); }
  });
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
  renderFollow(promoter);
  gigs = [];
  mainEl.innerHTML =
    topArtistsHtml(promoter.top_artists) +
    renderSection("UPCOMING", promoter.upcoming || []) +
    renderSection("PAST", promoter.past || []);
  wireGigRows(mainEl);

  window.NachtkaartAuth.onAuthChange(() => renderFollow(promoter));
}

init();
