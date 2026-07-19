const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const CACHE_BUST = Date.now();
// Archive is one file per year with no manifest; scan this range (404-tolerant),
// and only when the live window can't resolve every pick. Widen the floor if the
// archive ever backfills further back than this.
const ARCHIVE_MIN_YEAR = 2016;
const WENT_PAGE = 50;

const mainEl = document.getElementById("main");
const emailEl = document.getElementById("profileEmail");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------- event resolution (by id, across live window + archive) ----------

let eventIndex = new Map();   // id -> {title, date, venue, venue_id, area, ra_url}
let venueNameToId = new Map(); // venue name -> venue id (for favorite-venue links)

function indexEvents(events) {
  for (const e of events) {
    const v = e.venue || {};
    if (!eventIndex.has(e.id)) {
      eventIndex.set(e.id, {
        title: e.title, date: e.date, venue: v.name,
        venue_id: v.id, area: v.area, ra_url: e.ra_url,
      });
    }
    if (v.name && v.id != null && !venueNameToId.has(v.name)) venueNameToId.set(v.name, v.id);
  }
}

async function loadEventIndex(neededIds) {
  eventIndex = new Map();
  venueNameToId = new Map();
  const live = await fetchJson(`data/events.json?t=${CACHE_BUST}`);
  if (Array.isArray(live)) indexEvents(live);

  // Only pay for the archive if the live window didn't resolve everything.
  const missing = [...neededIds].some((id) => !eventIndex.has(id));
  if (missing) {
    const nowYear = new Date().getFullYear();
    const years = [];
    for (let y = nowYear; y >= ARCHIVE_MIN_YEAR; y--) years.push(y);
    const files = await Promise.all(years.map((y) => fetchJson(`data/archive/${y}.json?t=${CACHE_BUST}`)));
    for (const recs of files) {
      if (recs && typeof recs === "object") indexEvents(Object.values(recs));
    }
  }
}

// ---------- section renderers ----------

function pickSortKey(pick) {
  const ev = eventIndex.get(pick.event_id);
  if (ev && ev.date) return ev.date;
  return pick.created_at ? pick.created_at.slice(0, 10) : "0000-00-00";
}

// An event pick row. Unresolvable ids (data outlives the 30-day window and the
// archive floor) fall back to the stored id + the pick's own date, never break.
function eventRowHtml(pick) {
  const ev = eventIndex.get(pick.event_id);
  if (!ev) {
    const d = pick.created_at ? formatDate(pick.created_at.slice(0, 10)) : "—";
    return `<div class="gig unresolved"><span class="gig-date">${d}</span><span>` +
      `<span class="gig-title">${esc(pick.event_id)}</span>` +
      `<span class="gig-sub">EVENT NO LONGER IN RANGE</span></span></div>`;
  }
  const title = ev.ra_url
    ? `<a class="gig-title" href="${esc(ev.ra_url)}" target="_blank" rel="noopener">${esc(ev.title)}</a>`
    : `<span class="gig-title">${esc(ev.title)}</span>`;
  const venue = ev.venue_id != null
    ? `<a href="venue.html?id=${encodeURIComponent(ev.venue_id)}">${esc(ev.venue)}</a>`
    : esc(ev.venue || "");
  const sub = `<span class="gig-sub">${venue}${ev.area ? " · " + esc(ev.area) : ""}</span>`;
  return `<div class="gig"><span class="gig-date">${formatDate(ev.date)}</span><span>${title}${sub}</span></div>`;
}

async function renderFollowing() {
  const ids = window.NachtkaartAuth.getFollows();
  const label = `<div class="section-label">FOLLOWING (${ids.length})</div>`;
  if (!ids.length) return label + `<div class="empty">NOBODY YET — FOLLOW ARTISTS FROM THEIR PAGES.</div>`;
  const names = await Promise.all(
    ids.map(async (id) => {
      const a = await fetchJson(`data/artists/${encodeURIComponent(id)}.json?t=${CACHE_BUST}`);
      return (a && a.name) || id;
    })
  );
  const rows = ids
    .map(
      (id, i) => `<div class="prow">` +
        `<a class="prow-main prow-name" href="artist.html?id=${encodeURIComponent(id)}">${esc(names[i])}</a>` +
        `<button class="prow-action" type="button" data-unfollow="${esc(id)}">UNFOLLOW</button></div>`
    )
    .join("");
  return label + rows;
}

function renderVenues() {
  const names = window.NachtkaartAuth.getFavoriteVenues();
  const label = `<div class="section-label">VENUES (${names.length})</div>`;
  if (!names.length) return label + `<div class="empty">NO SAVED VENUES YET.</div>`;
  const rows = names
    .map((name) => {
      const vid = venueNameToId.get(name);
      const main = vid != null
        ? `<a class="prow-main prow-name" href="venue.html?id=${encodeURIComponent(vid)}">${esc(name)}</a>`
        : `<span class="prow-main prow-name">${esc(name)}</span>`;
      return `<div class="prow">${main}<button class="prow-action" type="button" data-unfav="${esc(name)}">REMOVE</button></div>`;
    })
    .join("");
  return label + rows;
}

function renderWantToGo(picks) {
  const list = picks
    .filter((p) => p.status === "want_to_go")
    .sort((a, b) => (pickSortKey(a) < pickSortKey(b) ? -1 : 1)); // soonest first
  const label = `<div class="section-label">WANT TO GO (${list.length})</div>`;
  if (!list.length) return label + `<div class="empty">NOTHING ON THE LIST. THE NIGHT IS YOUNG.</div>`;
  return label + list.map(eventRowHtml).join("");
}

// WENT is the going-out history and grows for years, so render in pages.
let wentAll = [];
let wentShown = 0;

function renderWent(picks) {
  wentAll = picks
    .filter((p) => p.status === "went")
    .sort((a, b) => (pickSortKey(a) > pickSortKey(b) ? -1 : 1)); // newest first
  wentShown = 0;
  const label = `<div class="section-label">WENT (${wentAll.length})</div>`;
  if (!wentAll.length) return label + `<div class="empty">NO NIGHTS LOGGED YET.</div>`;
  return label + `<div id="wentList"></div><div id="wentMore"></div>`;
}

function appendWent() {
  const listEl = document.getElementById("wentList");
  const moreEl = document.getElementById("wentMore");
  if (!listEl || !moreEl) return;
  const next = wentAll.slice(wentShown, wentShown + WENT_PAGE);
  listEl.insertAdjacentHTML("beforeend", next.map(eventRowHtml).join(""));
  wentShown += next.length;
  const remaining = wentAll.length - wentShown;
  moreEl.innerHTML = remaining > 0
    ? `<button class="load-more" type="button" data-loadmore>LOAD MORE (${remaining})</button>`
    : "";
}

function accountHtml() {
  return `<div class="section-label">ACCOUNT</div><div class="account">` +
    `<div class="account-actions">` +
    `<button class="link-btn" type="button" id="logoutBtn2">LOG OUT</button>` +
    `<button class="link-btn" type="button" id="deleteBtn">DELETE ACCOUNT</button></div>` +
    `<div class="delete-confirm hidden" id="deleteConfirm">` +
    `<p class="delete-warn">THIS PERMANENTLY ERASES YOUR FOLLOWS, VENUES AND PICKS, AND YOUR ACCOUNT. THERE IS NO UNDO. TYPE DELETE TO CONFIRM.</p>` +
    `<div class="delete-row">` +
    `<input class="delete-input" id="deleteInput" placeholder="TYPE DELETE" autocomplete="off" autocapitalize="characters" spellcheck="false">` +
    `<button class="link-btn" type="button" id="deleteConfirmBtn" disabled>CONFIRM</button></div>` +
    `<p class="delete-status" id="deleteStatus"></p></div></div>`;
}

function wireAccount() {
  document.getElementById("logoutBtn2").addEventListener("click", () => window.NachtkaartAuth.logout());

  document.getElementById("deleteBtn").addEventListener("click", () => {
    document.getElementById("deleteConfirm").classList.remove("hidden");
    document.getElementById("deleteInput").focus();
  });

  const input = document.getElementById("deleteInput");
  const confirmBtn = document.getElementById("deleteConfirmBtn");
  input.addEventListener("input", () => {
    confirmBtn.disabled = input.value.trim().toUpperCase() !== "DELETE";
  });
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    const status = document.getElementById("deleteStatus");
    status.textContent = "DELETING…";
    try {
      await window.NachtkaartAuth.deleteAccount();
      location.href = "index.html";
    } catch (err) {
      status.textContent = "ERROR: " + (err && err.message ? err.message : "COULD NOT DELETE");
      confirmBtn.disabled = false;
    }
  });
}

// ---------- orchestration ----------

async function render() {
  if (!window.NachtkaartAuth.isLoggedIn()) {
    emailEl.textContent = "";
    mainEl.innerHTML = `<div class="empty">LOG IN TO SEE YOUR FOLLOWS, VENUES AND NIGHTS.</div>`;
    window.NachtkaartAuth.openLogin();
    return;
  }

  emailEl.textContent = window.NachtkaartAuth.getEmail() || "";
  const picks = window.NachtkaartAuth.getPicks();
  await loadEventIndex(new Set(picks.map((p) => p.event_id)));

  const following = await renderFollowing();
  mainEl.innerHTML =
    following +
    renderVenues() +
    renderWantToGo(picks) +
    renderWent(picks) +
    accountHtml();
  appendWent();
  wireAccount();
}

// Inline mutations + paging are handled here so a follow/favorite toggle doesn't
// trigger a full re-render (its notify() lands in onChange, which no-ops when the
// login state is unchanged).
mainEl.addEventListener("click", async (e) => {
  const unfollow = e.target.closest("[data-unfollow]");
  if (unfollow) {
    await window.NachtkaartAuth.toggleFollow(unfollow.dataset.unfollow);
    const row = unfollow.closest(".prow");
    if (row) row.remove();
    return;
  }
  const unfav = e.target.closest("[data-unfav]");
  if (unfav) {
    await window.NachtkaartAuth.toggleFavoriteVenue(unfav.dataset.unfav);
    const row = unfav.closest(".prow");
    if (row) row.remove();
    return;
  }
  if (e.target.closest("[data-loadmore]")) appendWent();
});

// Re-render only when the login state actually flips (login/logout), not on every
// data mutation that also fires onAuthChange.
let lastLoggedIn = null;
window.NachtkaartAuth.onAuthChange(() => {
  const now = window.NachtkaartAuth.isLoggedIn();
  if (now === lastLoggedIn) return;
  lastLoggedIn = now;
  render();
});
