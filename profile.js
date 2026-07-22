const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const CACHE_BUST = Date.now();
const WENT_PAGE = 50;

const mainEl = document.getElementById("main");
const emailEl = document.getElementById("profileEmail");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
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

// ---------- event resolution (live window + sharded search index) ----------

let eventIndex = new Map();    // id -> {title, date, venue, venue_id, area, ra_url}
let venueNameToId = new Map(); // venue name -> venue id
let searchEntries = [];        // flat past-event records {…, terms} for search
let searchFetched = false;
let nameLists = null;          // {venues, artists, promoters} for autocomplete

function addToIndex(id, rec) {
  if (!eventIndex.has(id)) eventIndex.set(id, rec);
  if (rec.venue && rec.venue_id != null && !venueNameToId.has(rec.venue)) venueNameToId.set(rec.venue, rec.venue_id);
}

function indexLive(events) {
  for (const e of events) {
    const v = e.venue || {};
    addToIndex(e.id, { title: e.title, date: e.date, venue: v.name, venue_id: v.id, area: v.area, ra_url: e.ra_url });
  }
}

function indexShards(entries) {
  for (const e of entries) {
    addToIndex(e.id, { title: e.title, date: e.date, venue: e.venue, venue_id: e.venue_id, area: e.area, ra_url: e.ra_url });
  }
}

// Fetch the year-sharded search index once (memoized), then (re-)index it into
// the current eventIndex. Kills the old archive year-range guess.
async function ensureSearch() {
  if (!searchFetched) {
    const years = (await fetchJson(`data/search/years.json?t=${CACHE_BUST}`)) || [];
    const shards = await Promise.all(years.map((y) => fetchJson(`data/search/${y}.json?t=${CACHE_BUST}`)));
    searchEntries = shards.filter(Array.isArray).flat();
    searchFetched = true;
  }
  indexShards(searchEntries);
}

async function ensureNameLists() {
  if (nameLists) return nameLists;
  const [v, a, p] = await Promise.all([
    fetchJson(`data/search/venues.json?t=${CACHE_BUST}`),
    fetchJson(`data/search/artists.json?t=${CACHE_BUST}`),
    fetchJson(`data/search/promoters.json?t=${CACHE_BUST}`),
  ]);
  nameLists = { venues: v || [], artists: a || [], promoters: p || [] };
  return nameLists;
}

async function loadEventIndex(pickIds) {
  eventIndex = new Map();
  venueNameToId = new Map();
  const live = await fetchJson(`data/events.json?t=${CACHE_BUST}`);
  if (Array.isArray(live)) indexLive(live);
  if ([...pickIds].some((id) => !eventIndex.has(id))) await ensureSearch();
}

// ---------- row renderers ----------

let profileGigs = [];
function eventRowHtml(pick) {
  const ev = eventIndex.get(pick.event_id);
  if (!ev) {
    const d = pick.created_at ? formatDate(pick.created_at.slice(0, 10)) : "—";
    return `<div class="gig unresolved"><span class="gig-date">${d}</span><span>` +
      `<span class="gig-title">${esc(pick.event_id)}</span>` +
      `<span class="gig-sub">EVENT NO LONGER IN RANGE</span></span></div>`;
  }
  const gi = profileGigs.push({
    id: pick.event_id, title: ev.title, date: ev.date,
    venue: ev.venue, venue_id: ev.venue_id, area: ev.area, url: ev.ra_url,
  }) - 1;
  const venue = ev.venue_id != null
    ? `<a href="venue.html?id=${encodeURIComponent(ev.venue_id)}">${esc(ev.venue)}</a>`
    : esc(ev.venue || "");
  const sub = `<span class="gig-sub">${venue}${ev.area ? " · " + esc(ev.area) : ""}</span>`;
  return `<div class="gig" role="button" tabindex="0" data-gi="${gi}">` +
    `<span class="gig-date">${formatDate(ev.date)}</span>` +
    `<span><span class="gig-title">${esc(ev.title)}</span>${sub}</span></div>`;
}

// Diary entry. Linked names where an RA id is present, plain text otherwise.
function customRowHtml(ce) {
  const venue = ce.venue_id
    ? `<a href="venue.html?id=${encodeURIComponent(ce.venue_id)}">${esc(ce.venue_name)}</a>`
    : esc(ce.venue_name || "PAST NIGHT");
  const lineup = (ce.lineup || [])
    .map((a) => (a.id ? `<a href="artist.html?id=${encodeURIComponent(a.id)}">${esc(a.name)}</a>` : esc(a.name)))
    .join(", ");
  const org = ce.organizer_name
    ? (ce.organizer_id
        ? `<a href="promoter.html?id=${encodeURIComponent(ce.organizer_id)}">${esc(ce.organizer_name)}</a>`
        : esc(ce.organizer_name))
    : "";
  const subBits = [lineup, org].filter(Boolean).join(" · ");
  const note = ce.note ? `<span class="gig-note">${esc(ce.note)}</span>` : "";
  return `<div class="gig custom"><span class="gig-date">${formatDate(ce.date)}</span><span>` +
    `<span class="gig-title">${venue}</span>` +
    (subBits ? `<span class="gig-sub">${subBits}</span>` : "") +
    note +
    `<span class="gig-tags"><span class="tag-diary">DIARY</span>` +
    `<button class="prow-action" type="button" data-remove-custom="${esc(ce.id)}">REMOVE</button></span>` +
    `</span></div>`;
}

// ---------- sections ----------

// ---------- collapsible sections (open/closed persisted, first ~10 + SHOW ALL) ----------

const LS_OPEN = "nachtkaart:profileOpen";

function openState() {
  try { return JSON.parse(localStorage.getItem(LS_OPEN) || "{}"); } catch { return {}; }
}
function isSecOpen(key) {
  const o = openState();
  return key in o ? !!o[key] : true; // default open
}
function setSecOpen(key, val) {
  const o = openState();
  o[key] = val;
  try { localStorage.setItem(LS_OPEN, JSON.stringify(o)); } catch {}
}

function collapsible(key, titleWithCount, bodyHtml) {
  const open = isSecOpen(key);
  return `<section class="sec">` +
    `<button class="sec-head" type="button" data-sec-toggle data-key="${key}">` +
    `<span class="sec-title">${titleWithCount}</span>` +
    `<span class="sec-caret">${open ? "–" : "+"}</span></button>` +
    `<div class="sec-body${open ? "" : " closed"}">${bodyHtml}</div></section>`;
}

// Body of rows with the first ~10 shown and a SHOW ALL toggle for the rest (CSS
// hides the 11th+ until expanded, so no re-render needed).
function rowsBody(rowsHtml, emptyMsg) {
  if (!rowsHtml.length) return `<div class="empty">${emptyMsg}</div>`;
  const collapsed = rowsHtml.length > 10;
  return `<div class="sec-rows${collapsed ? " collapsed" : ""}">${rowsHtml.join("")}</div>` +
    (collapsed ? `<button class="show-all" type="button" data-showall>SHOW ALL (${rowsHtml.length})</button>` : "");
}

async function renderFollowingArtists() {
  const ids = window.NachtkaartAuth.getFollows("artist");
  const names = await Promise.all(
    ids.map(async (id) => {
      const a = await fetchJson(`data/artists/${encodeURIComponent(id)}.json?t=${CACHE_BUST}`);
      return (a && a.name) || id;
    })
  );
  const rows = ids.map(
    (id, i) => `<div class="prow">` +
      `<a class="prow-main prow-name" href="artist.html?id=${encodeURIComponent(id)}">${esc(names[i])}</a>` +
      `<button class="prow-action" type="button" data-unfollow="${esc(id)}" data-kind="artist">UNFOLLOW</button></div>`
  );
  return collapsible("following-artists", `FOLLOWING — ARTISTS (${ids.length})`,
    rowsBody(rows, "NOBODY YET — FOLLOW ARTISTS FROM THEIR PAGES."));
}

async function renderFollowingPromoters() {
  const ids = window.NachtkaartAuth.getFollows("promoter");
  const names = await Promise.all(
    ids.map(async (id) => {
      const p = await fetchJson(`data/promoters/${encodeURIComponent(id)}.json?t=${CACHE_BUST}`);
      return (p && p.name) || id;
    })
  );
  const rows = ids.map(
    (id, i) => `<div class="prow">` +
      `<a class="prow-main prow-name" href="promoter.html?id=${encodeURIComponent(id)}">${esc(names[i])}</a>` +
      `<button class="prow-action" type="button" data-unfollow="${esc(id)}" data-kind="promoter">UNFOLLOW</button></div>`
  );
  return collapsible("following-promoters", `FOLLOWING — PROMOTERS (${ids.length})`,
    rowsBody(rows, "NO PROMOTERS FOLLOWED YET."));
}

function renderVenues() {
  const names = window.NachtkaartAuth.getFavoriteVenues();
  const rows = names.map((name) => {
    const vid = venueNameToId.get(name);
    const main = vid != null
      ? `<a class="prow-main prow-name" href="venue.html?id=${encodeURIComponent(vid)}">${esc(name)}</a>`
      : `<span class="prow-main prow-name">${esc(name)}</span>`;
    return `<div class="prow">${main}<button class="prow-action" type="button" data-unfav="${esc(name)}">REMOVE</button></div>`;
  });
  return collapsible("venues", `VENUES (${names.length})`, rowsBody(rows, "NO SAVED VENUES YET."));
}

function renderWantToGo(picks) {
  const list = picks
    .filter((p) => p.status === "want_to_go")
    .sort((a, b) => (pickSortKey(a) < pickSortKey(b) ? -1 : 1));
  const rows = list.map(eventRowHtml);
  return collapsible("want-to-go", `WANT TO GO (${list.length})`,
    rowsBody(rows, "NOTHING ON THE LIST. THE NIGHT IS YOUNG."));
}

function pickSortKey(pick) {
  const ev = eventIndex.get(pick.event_id);
  if (ev && ev.date) return ev.date;
  return pick.created_at ? pick.created_at.slice(0, 10) : "0000-00-00";
}

// WENT = one chronology of resolved 'went' picks + diary entries, newest first.
let wentAll = [];
let wentShown = 0;

function buildWentItems(picks) {
  const items = [];
  for (const p of picks.filter((p) => p.status === "went")) items.push({ date: pickSortKey(p), html: eventRowHtml(p) });
  for (const ce of window.NachtkaartAuth.getCustomEvents()) items.push({ date: ce.date, html: customRowHtml(ce) });
  items.sort((a, b) => (a.date > b.date ? -1 : 1));
  return items;
}

function renderWent(picks) {
  wentAll = buildWentItems(picks);
  wentShown = 0;
  const addBlock =
    `<div class="add-past"><button class="link-btn" type="button" id="addPastBtn">+ ADD PAST EVENT</button></div>` +
    addPanelHtml();
  const body = wentAll.length
    ? addBlock + `<div id="wentList"></div><div id="wentMore"></div>`
    : addBlock + `<div class="empty">NO NIGHTS LOGGED YET.</div>`;
  // WENT keeps its own 50 + LOAD MORE paging (the diary can be huge), so no
  // first-10 SHOW ALL here — just the collapsible wrapper.
  return collapsible("went", `WENT (${wentAll.length})`, body);
}

function appendWent() {
  const listEl = document.getElementById("wentList");
  const moreEl = document.getElementById("wentMore");
  if (!listEl || !moreEl) return;
  const next = wentAll.slice(wentShown, wentShown + WENT_PAGE);
  listEl.insertAdjacentHTML("beforeend", next.map((it) => it.html).join(""));
  wentShown += next.length;
  const remaining = wentAll.length - wentShown;
  moreEl.innerHTML = remaining > 0
    ? `<button class="load-more" type="button" data-loadmore>LOAD MORE (${remaining})</button>`
    : "";
}

// ---------- add-past-event block ----------

function addPanelHtml() {
  return `<div class="add-panel hidden" id="addPanel">
    <div class="add-tabs">
      <button class="add-tab active" type="button" data-addmode="search">SEARCH</button>
      <button class="add-tab" type="button" data-addmode="manual">ADD MANUALLY</button>
    </div>
    <div class="add-mode" id="addSearch">
      <input class="add-input" id="searchQ" placeholder="EVENT, VENUE, ARTIST OR PROMOTER…" autocomplete="off">
      <div class="add-dates"><input class="add-input" id="searchFrom" type="date"><input class="add-input" id="searchTo" type="date"></div>
      <div class="search-results" id="searchResults"></div>
    </div>
    <div class="add-mode hidden" id="addManual">
      <input class="add-input" id="mDate" type="date">
      <div class="ac-field"><input class="add-input" id="mVenue" placeholder="VENUE" autocomplete="off"><div class="ac-drop" id="mVenueDrop"></div></div>
      <div class="ac-field"><input class="add-input" id="mLineup" placeholder="ADD ARTIST (ENTER)" autocomplete="off"><div class="ac-drop" id="mLineupDrop"></div></div>
      <div class="chips" id="mChips"></div>
      <div class="ac-field"><input class="add-input" id="mOrg" placeholder="ORGANIZER" autocomplete="off"><div class="ac-drop" id="mOrgDrop"></div></div>
      <input class="add-input" id="mNote" placeholder="NOTE (OPTIONAL)" autocomplete="off">
      <button class="link-btn" type="button" id="mSave">SAVE NIGHT</button>
      <p class="add-status" id="mStatus"></p>
    </div>
  </div>`;
}

// A minimal autocomplete: filter a [{id,name}] list by substring, show up to 8,
// click fills the input and reports {name,id}. Leaving free text keeps id null.
function attachAutocomplete(input, drop, getList, onPick) {
  function close() { drop.innerHTML = ""; drop.classList.remove("open"); }
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const matches = getList().filter((x) => (x.name || "").toLowerCase().includes(q)).slice(0, 8);
    drop.innerHTML = matches.map((m) => `<button class="ac-item" type="button" data-id="${esc(m.id)}">${esc(m.name)}</button>`).join("");
    drop.classList.toggle("open", matches.length > 0);
    drop.querySelectorAll(".ac-item").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onPick(btn.textContent, btn.dataset.id);
        close();
      });
    });
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

function wireAddPanel(refresh) {
  const btn = document.getElementById("addPastBtn");
  if (!btn) return;
  const panel = document.getElementById("addPanel");
  btn.addEventListener("click", async () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
      await ensureSearch();
      await ensureNameLists();
    }
  });

  // mode tabs
  panel.querySelectorAll("[data-addmode]").forEach((tab) => {
    tab.addEventListener("click", () => {
      panel.querySelectorAll(".add-tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.getElementById("addSearch").classList.toggle("hidden", tab.dataset.addmode !== "search");
      document.getElementById("addManual").classList.toggle("hidden", tab.dataset.addmode !== "manual");
    });
  });

  // search mode
  const q = document.getElementById("searchQ");
  const from = document.getElementById("searchFrom");
  const to = document.getElementById("searchTo");
  const runSearch = () => {
    const query = q.value.trim().toLowerCase();
    const toks = query ? query.split(/\s+/) : [];
    let results = searchEntries;
    if (toks.length) results = results.filter((e) => toks.every((t) => e.terms.includes(t)));
    if (from.value) results = results.filter((e) => e.date >= from.value);
    if (to.value) results = results.filter((e) => e.date <= to.value);
    if (!query && !from.value && !to.value) results = [];
    results = results.slice().sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 30);
    const box = document.getElementById("searchResults");
    box.innerHTML = results.length
      ? results.map((r) =>
          `<button class="search-result" type="button" data-add-pick="${esc(r.id)}">` +
          `<span class="sr-date">${formatDate(r.date)}</span>` +
          `<span><span class="sr-title">${esc(r.title || "")}</span>` +
          `<span class="sr-venue">${esc(r.venue || "")}${r.area ? " · " + esc(r.area) : ""}</span></span></button>`
        ).join("")
      : ((query || from.value || to.value) ? `<div class="empty">NO MATCHES.</div>` : "");
  };
  q.addEventListener("input", runSearch);
  from.addEventListener("change", runSearch);
  to.addEventListener("change", runSearch);

  // manual mode
  let venuePick = { id: null };
  let orgPick = { id: null };
  let lineup = [];
  const chipsEl = document.getElementById("mChips");
  const renderChips = () => {
    chipsEl.innerHTML = lineup
      .map((a, i) => `<span class="chip">${esc(a.name)}<button class="chip-x" type="button" data-chip="${i}">×</button></span>`)
      .join("");
    chipsEl.querySelectorAll("[data-chip]").forEach((x) =>
      x.addEventListener("click", () => { lineup.splice(Number(x.dataset.chip), 1); renderChips(); })
    );
  };
  const mVenue = document.getElementById("mVenue");
  const mOrg = document.getElementById("mOrg");
  const mLineup = document.getElementById("mLineup");
  attachAutocomplete(mVenue, document.getElementById("mVenueDrop"), () => nameLists.venues, (name, id) => { mVenue.value = name; venuePick.id = id; });
  mVenue.addEventListener("input", () => { venuePick.id = null; }); // typing free text clears the linked id
  attachAutocomplete(mOrg, document.getElementById("mOrgDrop"), () => nameLists.promoters, (name, id) => { mOrg.value = name; orgPick.id = id; });
  mOrg.addEventListener("input", () => { orgPick.id = null; });
  attachAutocomplete(mLineup, document.getElementById("mLineupDrop"), () => nameLists.artists, (name, id) => {
    lineup.push({ name, id: id || null }); mLineup.value = ""; renderChips();
  });
  mLineup.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && mLineup.value.trim()) {
      e.preventDefault();
      lineup.push({ name: mLineup.value.trim(), id: null });
      mLineup.value = "";
      renderChips();
    }
  });

  document.getElementById("mSave").addEventListener("click", async () => {
    const status = document.getElementById("mStatus");
    const date = document.getElementById("mDate").value;
    if (!date) { status.textContent = "DATE IS REQUIRED."; return; }
    status.textContent = "SAVING…";
    try {
      await window.NachtkaartAuth.addCustomEvent({
        date,
        venue_name: mVenue.value.trim() || null,
        venue_id: venuePick.id,
        lineup,
        organizer_name: mOrg.value.trim() || null,
        organizer_id: orgPick.id,
        note: document.getElementById("mNote").value.trim() || null,
      });
      await refresh();
    } catch (err) {
      status.textContent = "ERROR: " + (err && err.message ? err.message : "COULD NOT SAVE");
    }
  });
}

// ---------- account ----------

function accountHtml() {
  return `<div class="section-label">ACCOUNT</div><div class="account">` +
    `<div class="account-actions">` +
    `<button class="link-btn" type="button" id="logoutBtn2">LOG OUT</button>` +
    `<button class="link-btn" type="button" id="deleteBtn">DELETE ACCOUNT</button></div>` +
    `<div class="delete-confirm hidden" id="deleteConfirm">` +
    `<p class="delete-warn">THIS PERMANENTLY ERASES YOUR FOLLOWS, VENUES, PICKS AND DIARY, AND YOUR ACCOUNT. THERE IS NO UNDO. TYPE DELETE TO CONFIRM.</p>` +
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

  const [followingArtists, followingPromoters] = await Promise.all([
    renderFollowingArtists(),
    renderFollowingPromoters(),
  ]);
  profileGigs = [];
  mainEl.innerHTML =
    followingArtists +
    followingPromoters +
    renderVenues() +
    renderWantToGo(picks) +
    renderWent(picks) +
    accountHtml();
  appendWent();
  wireAddPanel(render);
  wireAccount();
}

mainEl.addEventListener("click", async (e) => {
  const secToggle = e.target.closest("[data-sec-toggle]");
  if (secToggle) {
    const body = secToggle.closest(".sec").querySelector(".sec-body");
    const nowClosed = body.classList.toggle("closed");
    secToggle.querySelector(".sec-caret").textContent = nowClosed ? "+" : "–";
    setSecOpen(secToggle.dataset.key, !nowClosed);
    return;
  }
  const showall = e.target.closest("[data-showall]");
  if (showall) {
    const rows = showall.previousElementSibling;
    const stillCollapsed = rows.classList.toggle("collapsed");
    showall.textContent = stillCollapsed ? `SHOW ALL (${rows.children.length})` : "SHOW LESS";
    return;
  }
  const unfollow = e.target.closest("[data-unfollow]");
  if (unfollow) {
    await window.NachtkaartAuth.toggleFollow(unfollow.dataset.unfollow, unfollow.dataset.kind || "artist");
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
  const addPick = e.target.closest("[data-add-pick]");
  if (addPick) {
    await window.NachtkaartAuth.setPick(addPick.dataset.addPick, "went");
    await render();
    return;
  }
  const removeCustom = e.target.closest("[data-remove-custom]");
  if (removeCustom) {
    await window.NachtkaartAuth.deleteCustomEvent(removeCustom.dataset.removeCustom);
    await render();
    return;
  }
  if (e.target.closest("[data-loadmore]")) { appendWent(); return; }
  // A resolved WENT / WANT-TO-GO row opens the shared panel (unless a link inside).
  const gigRow = e.target.closest("[data-gi]");
  if (gigRow && !e.target.closest("a")) window.NkPanel.openGig(profileGigs[Number(gigRow.dataset.gi)]);
});

mainEl.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const gigRow = e.target.closest("[data-gi]");
  if (gigRow) { e.preventDefault(); window.NkPanel.openGig(profileGigs[Number(gigRow.dataset.gi)]); }
});

let lastLoggedIn = null;
window.NachtkaartAuth.onAuthChange(() => {
  const now = window.NachtkaartAuth.isLoggedIn();
  if (now === lastLoggedIn) return;
  lastLoggedIn = now;
  render();
});
