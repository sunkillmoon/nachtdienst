// Shared Supabase auth + accounts layer, loaded by both index.html and
// artist.html before app.js/artist.js. Everything is wrapped in an IIFE so
// nothing but window.NachtkaartAuth leaks into the global scope (app.js and
// artist.js each define their own top-level `esc`, `formatGigDate` etc. —
// this avoids any collision with those).
(function () {
  // The project URL you gave was the REST endpoint
  // (https://smqoxsouhvbwfmjlessg.supabase.co/rest/v1/); createClient() wants
  // the bare project origin — it appends /rest/v1/, /auth/v1/, etc. itself.
  const SUPABASE_URL = "https://smqoxsouhvbwfmjlessg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EViVR2WaNdXJgUCVKvInpQ_45hkGFHj";

  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  const LOCAL_PICKS_KEY = "nachtkaart:picks";

  let session = null;
  let picksCache = new Map(); // event_id -> "went" | "want_to_go"
  let picksMeta = new Map(); // event_id -> created_at (ISO); logged-in only
  let followsCache = new Set(); // artist_id
  let favoriteVenuesCache = new Set(); // venue_name
  let customEventsCache = []; // user-authored diary rows
  const listeners = [];

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function notify() {
    for (const cb of listeners) cb();
  }

  function getLocalPicks() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_PICKS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function setLocalPicks(obj) {
    localStorage.setItem(LOCAL_PICKS_KEY, JSON.stringify(obj));
  }

  async function loadUserData() {
    if (!session) {
      picksCache = new Map();
      picksMeta = new Map();
      followsCache = new Set();
      favoriteVenuesCache = new Set();
      customEventsCache = [];
      return;
    }
    const uid = session.user.id;
    const [picksRes, followsRes, favRes, customRes] = await Promise.all([
      sb.from("picks").select("event_id,status,created_at").eq("user_id", uid),
      sb.from("follows").select("artist_id").eq("user_id", uid),
      sb.from("favorite_venues").select("venue_name").eq("user_id", uid),
      sb.from("custom_events").select("*").eq("user_id", uid),
    ]);
    picksCache = new Map((picksRes.data || []).map((r) => [r.event_id, r.status]));
    picksMeta = new Map((picksRes.data || []).map((r) => [r.event_id, r.created_at]));
    followsCache = new Set((followsRes.data || []).map((r) => r.artist_id));
    favoriteVenuesCache = new Set((favRes.data || []).map((r) => r.venue_name));
    customEventsCache = customRes.data || [];
  }

  // Local picks made before this device ever logged in get folded into the
  // account on first sign-in. Local values win on conflict — "what I had
  // locally becomes true" is the simplest rule for a one-way, one-time merge.
  async function migrateLocalPicks() {
    const local = getLocalPicks();
    const entries = Object.entries(local);
    if (!entries.length) return;
    const uid = session.user.id;
    const now = new Date().toISOString();
    const rows = entries.map(([event_id, status]) => ({ user_id: uid, event_id, status, updated_at: now }));
    const { error } = await sb.from("picks").upsert(rows, { onConflict: "user_id,event_id" });
    if (!error) setLocalPicks({});
  }

  // ---------- header + login panel ----------

  function renderAuthUI() {
    const el = document.getElementById("authControl");
    if (!el) return;
    if (session) {
      const email = session.user.email || "";
      el.innerHTML = `
        <a class="auth-email" href="profile.html" title="${esc(email)}">${esc(email)}</a>
        <button class="auth-btn" type="button" id="logoutBtn">LOG OUT</button>
      `;
      document.getElementById("logoutBtn").addEventListener("click", () => sb.auth.signOut());
    } else {
      el.innerHTML = `<button class="auth-btn" type="button" id="loginBtn">LOG IN</button>`;
      document.getElementById("loginBtn").addEventListener("click", openLogin);
    }
  }

  function openLogin() {
    const scrim = document.getElementById("authScrim");
    const panel = document.getElementById("authPanel");
    if (!scrim || !panel) return;
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
    scrim.classList.add("open");
  }

  function closeLogin() {
    const scrim = document.getElementById("authScrim");
    const panel = document.getElementById("authPanel");
    if (!scrim || !panel) return;
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    scrim.classList.remove("open");
  }

  function wireAuthPanel() {
    const scrim = document.getElementById("authScrim");
    const panel = document.getElementById("authPanel");
    const handle = document.getElementById("authPanelHandle");
    const form = document.getElementById("authForm");
    const emailInput = document.getElementById("authEmailInput");
    const statusEl = document.getElementById("authStatusMsg");
    if (!scrim || !panel || !form) return; // page doesn't include the auth panel

    scrim.addEventListener("click", closeLogin);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && panel.classList.contains("open")) closeLogin();
    });

    // Swipe-down-to-close, same mechanic as the event detail panel, kept as a
    // small self-contained copy here rather than refactoring app.js's version
    // (which is hardcoded to the event panel) just for this.
    if (handle) {
      let startY = null;
      handle.addEventListener("touchstart", (e) => {
        startY = e.touches[0].clientY;
        panel.style.transition = "none";
      });
      handle.addEventListener("touchmove", (e) => {
        if (startY == null) return;
        const delta = Math.max(0, e.touches[0].clientY - startY);
        panel.style.transform = `translateY(${delta}px)`;
      });
      handle.addEventListener("touchend", (e) => {
        if (startY == null) return;
        const delta = Math.max(0, e.changedTouches[0].clientY - startY);
        panel.style.transition = "";
        panel.style.transform = "";
        startY = null;
        if (delta > 60) closeLogin();
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) return;
      statusEl.textContent = "SENDING...";
      const redirectTo = location.href.split("#")[0];
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
      statusEl.textContent = error ? `ERROR: ${error.message}` : "CHECK YOUR EMAIL FOR THE LINK.";
    });
  }

  // ---------- public API ----------

  window.NachtkaartAuth = {
    onAuthChange(callback) {
      listeners.push(callback);
    },
    isLoggedIn() {
      return !!session;
    },
    getEmail() {
      return session?.user?.email ?? null;
    },
    async logout() {
      await sb.auth.signOut();
    },
    openLogin,
    getPickStatus(eventId) {
      return session ? picksCache.get(eventId) ?? null : getLocalPicks()[eventId] ?? null;
    },
    async setPick(eventId, status) {
      if (session) {
        const uid = session.user.id;
        if (status == null) {
          await sb.from("picks").delete().eq("user_id", uid).eq("event_id", eventId);
          picksCache.delete(eventId);
        } else {
          await sb
            .from("picks")
            .upsert(
              { user_id: uid, event_id: eventId, status, updated_at: new Date().toISOString() },
              { onConflict: "user_id,event_id" }
            );
          picksCache.set(eventId, status);
        }
      } else {
        const local = getLocalPicks();
        if (status == null) delete local[eventId];
        else local[eventId] = status;
        setLocalPicks(local);
      }
      notify();
    },
    // Whole-collection getters for the profile page.
    getFollows() {
      return [...followsCache];
    },
    getFavoriteVenues() {
      return [...favoriteVenuesCache];
    },
    getPicks() {
      return [...picksCache.entries()].map(([event_id, status]) => ({
        event_id,
        status,
        created_at: picksMeta.get(event_id) ?? null,
      }));
    },
    // Private user-authored diary events (past parties not in RA's data).
    getCustomEvents() {
      return [...customEventsCache];
    },
    async addCustomEvent(payload) {
      if (!session) return null;
      const { data, error } = await sb
        .from("custom_events")
        .insert({ ...payload, user_id: session.user.id })
        .select()
        .single();
      if (error) throw error;
      customEventsCache = [...customEventsCache, data];
      notify();
      return data;
    },
    async deleteCustomEvent(id) {
      if (!session) return;
      await sb.from("custom_events").delete().eq("user_id", session.user.id).eq("id", id);
      customEventsCache = customEventsCache.filter((e) => e.id !== id);
      notify();
    },
    // Self-service erase: a security-definer SQL function removes every row plus
    // the auth user (a client can't delete auth.users itself), then we sign out.
    async deleteAccount() {
      const { error } = await sb.rpc("delete_own_account");
      if (error) throw error;
      await sb.auth.signOut();
    },
    isFollowing(artistId) {
      return followsCache.has(artistId);
    },
    async toggleFollow(artistId) {
      if (!session) return;
      const uid = session.user.id;
      if (followsCache.has(artistId)) {
        await sb.from("follows").delete().eq("user_id", uid).eq("artist_id", artistId);
        followsCache.delete(artistId);
      } else {
        await sb.from("follows").insert({ user_id: uid, artist_id: artistId });
        followsCache.add(artistId);
      }
      notify();
    },
    isFavoriteVenue(venueName) {
      return favoriteVenuesCache.has(venueName);
    },
    async toggleFavoriteVenue(venueName) {
      if (!session) return;
      const uid = session.user.id;
      if (favoriteVenuesCache.has(venueName)) {
        await sb.from("favorite_venues").delete().eq("user_id", uid).eq("venue_name", venueName);
        favoriteVenuesCache.delete(venueName);
      } else {
        await sb.from("favorite_venues").insert({ user_id: uid, venue_name: venueName });
        favoriteVenuesCache.add(venueName);
      }
      notify();
    },
  };

  // ---------- init ----------

  wireAuthPanel();

  sb.auth.onAuthStateChange(async (event, newSession) => {
    session = newSession;
    if (event === "SIGNED_IN") {
      await migrateLocalPicks();
    }
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      await loadUserData();
      if (event === "SIGNED_IN") closeLogin();
    }
    if (event === "SIGNED_OUT") {
      picksCache = new Map();
      picksMeta = new Map();
      followsCache = new Set();
      favoriteVenuesCache = new Set();
      customEventsCache = [];
    }
    renderAuthUI();
    notify();
  });
})();
