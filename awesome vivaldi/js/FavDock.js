// ==UserScript==
// @name         FavDock
// @description  Arc-like Favorites Dock for Vivaldi, inspired by Zen
//               Essentials. A favorite is a pinned tab whose fixed title
//               carries a "✦" marker, kept in the first 9 pinned slots.
//               Uninstall-safe: tabs stay pinned, marker visible in title.
// @requirements FavDock.css
// @version      2026.7.31
// @author       PaRr0tBoY
// ==/UserScript==

(() => {
  "use strict";
  console.log("[FavDock] Script loaded");

  // ─── Configuration ─────────────────────────────────────────────────────

  const CONFIG = {
    maxFavorites: 12, // 3 columns × 4 rows
    marker: "\u2726", // ✦ — marker prefixed to the fixed title
  };
  const MARKER_RE = new RegExp(CONFIG.marker, "g");

  // ─── State ─────────────────────────────────────────────────────────────

  const state = {
    root: null,
    grid: null,
    dropZone: null,
    slots: [],
    favorites: [], // [{ tabId, url, title, favicon }] — derived from pinned tabs
    currentWindowId: null,
    activeTabId: null,
    currentWsId: null,      // workspace of the active tab (vivExtData.workspaceId)
    // drag state
    dragging: false,
    draggedTabId: null,     // tab dragged from the tab strip
    dockDragTabId: null,    // favorite dragged out of the dock
    pendingDrop: null,      // { sourceId, x, y, kind: "dock"|"strip" } drop intent awaiting drag-end signal
    reconcileTimer: null,   // quiet-window timer after the drag-end signal
    reconcileCap: null,     // liveness ceiling for a pending drop
    observedContainer: null,
    dropZoneVisible: false,
    dockHovering: false,
    dropHandled: false,
    mountedContainer: null,
    mountObserver: null,
    stripObserver: null,
    disposeListeners: [],
    syncTimer: null,
    syncing: false,
  };

  // ─── Chrome Helpers ────────────────────────────────────────────────────

  function queryTabs(opts) {
    return new Promise((resolve) => chrome.tabs.query(opts, resolve));
  }

  function getTabById(tabId) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.get(tabId, (t) => resolve(t || null));
      } catch {
        resolve(null);
      }
    });
  }

  function updateTab(tabId, props) {
    return new Promise((resolve) => chrome.tabs.update(tabId, props, resolve));
  }

  function moveTab(tabId, index) {
    return new Promise((resolve) => chrome.tabs.move(tabId, { index }, resolve));
  }

  // ─── Marker: ✦ in the fixed title (vivExtData.fixedTitle) ──────────────

  function parseViv(tab) {
    if (!tab?.vivExtData) return {};
    if (typeof tab.vivExtData === "string") {
      try {
        return JSON.parse(tab.vivExtData);
      } catch {
        return {};
      }
    }
    return tab.vivExtData;
  }

  function isMarked(tab) {
    if (!tab) return false;
    const viv = parseViv(tab);
    const title = viv.fixedTitle || tab.title || "";
    return title.includes(CONFIG.marker);
  }

  function setFixedTitle(tabId, title, extra) {
    return new Promise((resolve) => {
      getTabById(tabId).then((tab) => {
        if (!tab) return resolve();
        const viv = parseViv(tab);
        if (title) viv.fixedTitle = title;
        else delete viv.fixedTitle;
        if (extra) Object.assign(viv, extra);
        chrome.tabs.update(tabId, { vivExtData: JSON.stringify(viv) }, () => resolve());
      });
    });
  }

  // Current workspace = the active tab's workspaceId (Vivaldi stores it in
  // vivExtData.workspaceId); null when the window has no workspace concept.
  async function getCurrentWorkspaceId() {
    const tabs = await queryTabs({ currentWindow: true, active: true });
    const active = tabs[0];
    return active ? (parseViv(active).workspaceId ?? null) : null;
  }

  // Favorites are per-workspace: vivExtData.favdockWs lists the workspace
  // ids whose dock shows this tab. ✦ with no/empty favdockWs (legacy, or a
  // hand-edited title) counts as a favorite in every workspace.
  function isFavoriteInWs(tab, wsId) {
    if (!isMarked(tab)) return false;
    const wsList = parseViv(tab).favdockWs;
    if (!Array.isArray(wsList) || wsList.length === 0) return true;
    return wsList.includes(wsId);
  }

  async function markFavorite(tabId) {
    const tab = await getTabById(tabId);
    if (!tab) return;
    const viv = parseViv(tab);
    const base = (viv.fixedTitle || tab.title || "").replace(MARKER_RE, "").trim();
    const title = base ? `${CONFIG.marker} ${base}` : CONFIG.marker;
    const wsId = await getCurrentWorkspaceId();
    const wsList = Array.isArray(viv.favdockWs) ? [...viv.favdockWs] : [];
    if (!wsList.includes(wsId)) wsList.push(wsId);
    const changed =
      (viv.fixedTitle || "") !== title ||
      (Array.isArray(viv.favdockWs) ? viv.favdockWs.join() : "") !== wsList.join();
    if (changed) await setFixedTitle(tabId, title, { favdockWs: wsList });
  }

  async function unmarkFavorite(tabId) {
    const tab = await getTabById(tabId);
    if (!tab) return;
    const viv = parseViv(tab);
    const wsId = await getCurrentWorkspaceId();
    const wsList = Array.isArray(viv.favdockWs) ? [...viv.favdockWs] : [];
    const i = wsList.indexOf(wsId);
    if (i >= 0) wsList.splice(i, 1);
    const newTitle = viv.fixedTitle || "";
    const cleaned = wsList.length === 0 && newTitle.includes(CONFIG.marker)
      ? newTitle.replace(MARKER_RE, "").replace(/\s+/g, " ").trim()
      : newTitle;
    const changed =
      (viv.fixedTitle || undefined) !== (cleaned || undefined) ||
      (Array.isArray(viv.favdockWs) ? viv.favdockWs.join() : "") !== wsList.join();
    if (changed) await setFixedTitle(tabId, cleaned || undefined, { favdockWs: wsList });
  }

  // ─── Favorites: derived from this workspace's ✦ pinned tabs ────────────

  async function syncFavoritesNow() {
    if (state.syncing) return;
    // Never fight Vivaldi's live reordering mid-drag; defer and re-sync on
    // drag end (endDragState → scheduleSync).
    if (state.dragging) {
      scheduleSync();
      return;
    }
    ensureStripObserver();
    state.syncing = true;
    try {
      const wsId = await getCurrentWorkspaceId();
      state.currentWsId = wsId;

      // 1. Fix the invariant: this workspace's favorites live among the
      //    first maxFavorites pinned slots. Unpinned or overflow ✦ tabs
      //    are unmarked per-workspace (other workspaces keep theirs).
      const tabs = await queryTabs({ currentWindow: true });
      const pinned = tabs.filter((t) => t.pinned).sort((a, b) => a.index - b.index);
      for (const t of pinned.slice(CONFIG.maxFavorites)) {
        if (isFavoriteInWs(t, wsId)) await unmarkFavorite(t.id);
      }
      for (const t of tabs) {
        if (!t.pinned && isFavoriteInWs(t, wsId)) await unmarkFavorite(t.id);
      }

      // 2. This workspace's favorites occupy the leading pinned slots.
      const tabs2 = await queryTabs({ currentWindow: true });
      const pinned2 = tabs2.filter((t) => t.pinned).sort((a, b) => a.index - b.index);
      const marked2 = pinned2.filter((t) => isFavoriteInWs(t, wsId));
      const ordered = [...marked2, ...pinned2.filter((t) => !isFavoriteInWs(t, wsId))];
      const needsReorder = pinned2.some((t, i) => t.id !== ordered[i]?.id);
      if (needsReorder && ordered.length > 1) {
        await new Promise((r) => chrome.tabs.move(ordered.map((t) => t.id), { index: 0 }, r));
      }

      // 3. Final state for this workspace.
      const tabs3 = await queryTabs({ currentWindow: true });
      const pinned3 = tabs3.filter((t) => t.pinned).sort((a, b) => a.index - b.index);
      state.favorites = pinned3
        .slice(0, CONFIG.maxFavorites)
        .filter((t) => isFavoriteInWs(t, wsId))
        .map((t) => ({
          tabId: t.id,
          url: t.url || "",
          title: (t.title || "").replace(MARKER_RE, "").trim(),
          favicon: t.favIconUrl || "",
        }));
      applyHiddenPins();
      renderDock();
      injectFavoritesHidden();
    } finally {
      state.syncing = false;
    }
  }

  function scheduleSync() {
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(syncFavoritesNow, 150);
  }

  // Hide favorite pins in the tab strip (they live in the dock now)
  // Hide favorite pins in the tab strip (they live in the dock now).
  // tabId-driven (data-id), so it never depends on title rendering.
  function applyHiddenPins() {
    const strip = document.querySelector(".tab-strip");
    if (!strip) return;
    const favIds = new Set(state.favorites.map((f) => String(f.tabId)));
    for (const el of strip.querySelectorAll(".tab-position")) {
      const id = getTabIdFromElement(el);
      el.classList.toggle("favdock-hidden", id != null && favIds.has(String(id)));
    }
    reflowStrip();
  }

  // ─── Vivaldi-native hiding (pageIdsHiddenForDrag) ────────────────────
  // createFlexBoxLayout zeroes the yoga size of every tab whose id sits in
  // the TabStrip's pageIdsHiddenForDrag prop — native "hidden but fully
  // present, zero layout space", exactly what a favorites dock needs. We
  // merge the favorites' ids into that set through the component's own
  // setter, located via the React fiber (AGENTS.md fiber-walk technique).
  // Skipped during drags: Vivaldi owns the set then (drag source hiding);
  // after drag end Vivaldi clears it, so endDragState re-injects.

  function findTabStripFiber() {
    const strip = document.querySelector(".tab-strip");
    if (!strip) return null;
    let node = strip;
    while (node) {
      const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
      if (key) {
        let fiber = node[key];
        while (fiber) {
          if (fiber.memoizedProps &&
              typeof fiber.memoizedProps.setPageIdsHiddenForDrag === "function") {
            return fiber;
          }
          fiber = fiber.return;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  function injectFavoritesHidden() {
    if (state.dragging) return; // Vivaldi manages the set during drags
    if (state.favorites.length === 0) return; // never touch an empty set
    const fiber = findTabStripFiber();
    if (!fiber) return;
    const { pageIdsHiddenForDrag: cur, setPageIdsHiddenForDrag } = fiber.memoizedProps;
    if (!cur || typeof setPageIdsHiddenForDrag !== "function") return;
    const favIds = state.favorites.map((f) => f.tabId);
    try {
      const hasAll = favIds.every((id) => cur.has(id));
      const onlyFavs = cur.every((id) => favIds.includes(id));
      if (hasAll && onlyFavs) return; // already in sync
      let next = cur;
      if (!hasAll) next = next.union(favIds);
      if (!onlyFavs) next = next.subtract(cur.filter((id) => !favIds.includes(id)));
      setPageIdsHiddenForDrag(next);
      console.log("[FavDock] injected", favIds.length, "favorites into pageIdsHiddenForDrag");
    } catch (err) {
      console.error("[FavDock] injectFavoritesHidden failed:", err);
    }
  }

  // Vivaldi's yoga layout assigns every tab a contiguous --PositionY via
  // inline CSS variables; display:none does not free that slot, so hidden
  // favorites leave a blank block. Re-map visible tabs to contiguous
  // positions (React only rewrites these vars when the layout actually
  // changes, and the strip observer re-applies afterwards). Skipped during
  // drags — Vivaldi's live reordering uses its internal layout tree.
  function reflowStrip() {
    // Skip only while Vivaldi live-moves strip tabs (React rewrites
    // --PositionY continuously); dock-sourced drags never touch the strip.
    if (state.dragging && !state.dockDragTabId) return;
    const strip = document.querySelector(".tab-strip");
    if (!strip) return;
    const sep = document.querySelector(".tab-strip .separate") ||
                document.querySelector(".separate");
    let y = 0;
    let sepPlaced = false;
    for (const el of strip.querySelectorAll(".tab-position")) {
      // yoga places the pinned separator before the first non-pinned tab.
      if (!sepPlaced && sep && !el.classList.contains("is-pinned")) {
        sep.style.setProperty("--PositionY", `${y}px`);
        y += sep.offsetHeight || 18;
        sepPlaced = true;
      }
      if (el.classList.contains("favdock-hidden")) continue;
      el.style.setProperty("--PositionY", `${y}px`);
      y += el.offsetHeight || 33;
    }
  }

  // Add a tab to favorites, landing at slot `slotIndex` (0-11) or the end.
  // When this workspace's dock is full, the last slot is evicted.
  async function addFavorite(tabId, slotIndex = null) {
    if (!tabId) return false;
    const tab = await getTabById(tabId);
    if (!tab || tab.windowId !== state.currentWindowId) return false;
    if (state.favorites.length >= CONFIG.maxFavorites) {
      const evict = state.favorites[CONFIG.maxFavorites - 1];
      if (evict && evict.tabId !== tabId) await unmarkFavorite(evict.tabId);
    }
    if (!tab.pinned) {
      await updateTab(tabId, { pinned: true });
    }
    await markFavorite(tabId);
    const idx = slotIndex == null
      ? Math.min(state.favorites.length, CONFIG.maxFavorites - 1)
      : slotIndex;
    const target = Math.max(0, Math.min(idx, CONFIG.maxFavorites - 1));
    await moveTab(tabId, target);
    await syncFavoritesNow();
    console.log("[FavDock] ✓ pinned favorite:", (tab.title || tab.url || tabId).slice(0, 40));
    return true;
  }

  async function removeFavorite(tabId, unpin = false) {
    await unmarkFavorite(tabId);
    if (unpin) {
      await updateTab(tabId, { pinned: false });
    }
    await syncFavoritesNow();
  }

  // Reorder: move `fromTabId` into slot `toSlotIndex` (0-8)
  async function moveFavoriteTo(fromTabId, toSlotIndex) {
    const idx = Math.max(0, Math.min(toSlotIndex, CONFIG.maxFavorites - 1));
    await moveTab(fromTabId, idx);
    await syncFavoritesNow();
  }

  // ─── DOM Creation ──────────────────────────────────────────────────────

  function createRoot() {
    const root = document.createElement("div");
    root.className = "fav-dock";
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Favorites Dock");

    // Drop zone — only shown while dragging when favorites is empty
    const dropZone = document.createElement("div");
    dropZone.className = "fav-dock-dropzone";
    dropZone.innerHTML = `
      <div class="fav-dock-dropzone-content">
        <div class="fav-dock-dropzone-icon">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2L12.5 7.5L18 8.5L14 12.5L15 18L10 15.5L5 18L6 12.5L2 8.5L7.5 7.5L10 2Z" fill="currentColor"/>
          </svg>
        </div>
        <div class="fav-dock-dropzone-text">Pin to Favorites</div>
      </div>
    `;
    root.appendChild(dropZone);
    state.dropZone = dropZone;

    // 9-slot grid (Zen Essentials style)
    const grid = document.createElement("div");
    grid.className = "fav-dock-grid";
    root.appendChild(grid);
    state.grid = grid;

    for (let i = 0; i < CONFIG.maxFavorites; i++) {
      const slot = document.createElement("div");
      slot.className = "fav-dock-slot fav-dock-slot-empty";
      slot.dataset.slot = String(i);
      grid.appendChild(slot);
      state.slots.push(slot);
    }

    // Delegated events on the grid
    grid.addEventListener("click", (e) => {
      const slot = e.target.closest(".fav-dock-slot-filled");
      if (!slot?.dataset.tabId) return;
      e.preventDefault();
      chrome.tabs.update(Number(slot.dataset.tabId), { active: true }, () => {});
    });
    grid.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      const slot = e.target.closest(".fav-dock-slot-filled");
      if (!slot?.dataset.tabId) return;
      e.preventDefault();
      chrome.tabs.remove(Number(slot.dataset.tabId), () => {});
    });
    grid.addEventListener("contextmenu", (e) => {
      const slot = e.target.closest(".fav-dock-slot-filled");
      if (!slot?.dataset.tabId) return;
      e.preventDefault();
      const fav = state.favorites.find((f) => f.tabId === Number(slot.dataset.tabId));
      if (fav) showContextMenu(e, fav);
    });
    grid.addEventListener("dragstart", (e) => {
      const slot = e.target.closest(".fav-dock-slot-filled");
      if (!slot?.dataset.tabId) return;
      onSlotDragStart(e, Number(slot.dataset.tabId));
    });
    grid.addEventListener("dragend", () => {
      if (state.dockDragTabId) endDragState();
    });

    return root;
  }

  function renderSlot(slot, fav) {
    const filled = !!fav;
    slot.classList.toggle("fav-dock-slot-filled", filled);
    slot.classList.toggle("fav-dock-slot-empty", !filled);
    slot.classList.toggle("fav-dock-active", filled && fav.tabId === state.activeTabId);
    slot.draggable = filled;
    slot.style.display = filled || state.dockHovering ? "" : "none";

    let icon = slot.querySelector(".fav-dock-icon");
    let dot = slot.querySelector(".fav-dock-indicator");
    if (fav) {
      if (!icon) {
        icon = document.createElement("img");
        icon.className = "fav-dock-icon";
        icon.loading = "lazy";
        icon.alt = "";
        slot.appendChild(icon);
      }
      const src = fav.favicon || getGoogleFavicon(fav.url);
      if (icon.src !== src) icon.src = src;
      icon.onerror = () => { icon.src = getGoogleFavicon(fav.url); };
      slot.title = fav.title || fav.url || "";
      slot.dataset.tabId = String(fav.tabId);
      if (!dot) {
        dot = document.createElement("div");
        dot.className = "fav-dock-indicator";
        slot.appendChild(dot);
      }
    } else {
      icon?.remove();
      dot?.remove();
      delete slot.dataset.tabId;
      slot.title = "";
    }
  }

  function renderDock() {
    if (!state.grid) return;
    state.slots.forEach((slot, i) => renderSlot(slot, state.favorites[i]));
    const showGrid = state.favorites.length > 0;
    state.grid.style.display = showGrid ? "flex" : "none";
    updateDockVisibility();
    reflowStrip(); // dock height changed → re-reserve the strip offset
  }

  function updateDockVisibility() {
    if (!state.root) return;
    const show = state.favorites.length > 0 || state.dropZoneVisible;
    state.root.style.display = show ? "block" : "none";
  }

  function getGoogleFavicon(url) {
    try {
      const host = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
    } catch {
      return "";
    }
  }

  // ─── Context Menu ──────────────────────────────────────────────────────

  function showContextMenu(event, fav) {
    const existing = document.querySelector(".fav-dock-menu");
    if (existing) existing.remove();

    const menu = document.createElement("div");
    menu.className = "fav-dock-menu";
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    const items = [
      { label: "Remove from Favorites", action: () => removeFavorite(fav.tabId, false) },
      { label: "Unpin & Remove", action: () => removeFavorite(fav.tabId, true) },
    ];

    for (const { label, action } of items) {
      const btn = document.createElement("div");
      btn.className = "fav-dock-menu-item";
      btn.textContent = label;
      btn.addEventListener("click", () => { menu.remove(); action(); });
      menu.appendChild(btn);
    }

    document.body.appendChild(menu);

    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("mousedown", close);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  // ─── Drag Detection ─────────────────────────────────────────────────────
  // Three tracks: mouse (native C++ path), HTML5 drag events, DOM signals.

  function beginDrag(tabId) {
    if (state.dragging) return;
    if (!tabId) return;
    state.dropHandled = false;
    state.dragging = true;
    state.draggedTabId = tabId;
    console.log("[FavDock] ★ drag tab", tabId);
    refreshDragSourceInfo();
  }

  function refreshDragSourceInfo() {
    showDropZone();
  }

  function endDragState() {
    state.dragging = false;
    state.draggedTabId = null;
    state.dockDragTabId = null;
    state.mouseDownInfo = null;
    clearSlotIndicators();
    state.slots.forEach((s) => s.classList.remove("fav-dock-dragging"));
    if (state.dockHovering) {
      state.dockHovering = false;
      renderDock();
    }
    state.root?.classList.remove("fav-dock-dragover");
    hideDropZone();
    reflowStrip(); // restore contiguous layout immediately
    setTimeout(reflowStrip, 120); // after Vivaldi's maybeResetDragging tail
    injectFavoritesHidden(); // Vivaldi cleared the set on drag end
    setTimeout(injectFavoritesHidden, 200); // after maybeResetDragging
    scheduleSync(); // final invariant pass (no-op while dragging)
  }
  function setupDragDetection() {
    // ── Track 1: mouse events ────────────────────────────────────────────
    function handleMouseDown(e) {
      if (e.button !== 0) return;
      const tabEl = e.target.closest?.(".tab");
      if (!tabEl) return;
      state.mouseDownInfo = {
        tabId: getTabIdFromElement(tabEl),
        x: e.clientX,
        y: e.clientY,
      };
    }

    function handleMouseMove(e) {
      const m = state.mouseDownInfo;
      if (!m) return;
      if (state.dragging) {
        // C++-driven drags fire no HTML5 dragover — drive the dock hover
        // feedback from the real mouse moves instead.
        updateDockHover(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - m.x;
      const dy = e.clientY - m.y;
      if (Math.hypot(dx, dy) <= 5) return; // drag threshold
      beginDrag(m.tabId);
    }

    function handleMouseUp(e) {
      const m = state.mouseDownInfo;
      // Fallback: C++-driven tab drags never fire HTML5 drop events, so
      // mB.dropHandlerFired stays false and Vivaldi's onDragEnd detaches
      // the tab into a new window. Deliver a synthetic drop on document:
      // its windowDropHandler runs synchronously and sets the flag (empty
      // dataTransfer → flag only, no moves), while our own capture
      // listener records the pending intent. Applied even when no dragend
      // follows (C++ path) via the liveness cap below.
      if (state.dragging && !state.dropHandled && !state.dockDragTabId) {
        const tabId = state.draggedTabId || m?.tabId;
        if (tabId) {
          console.log("[FavDock] drop never fired → synthetic drop, tab", tabId);
          const ev = new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: e.clientX,
            clientY: e.clientY,
            dataTransfer: new DataTransfer(),
          });
          document.dispatchEvent(ev);
          if (state.pendingDrop && !state.reconcileCap) {
            state.reconcileCap = setTimeout(runPendingDrop, 150);
          }
        }
      }
      state.mouseDownInfo = null;
      if (state.dragging) endDragState();
    }

    // ── Track 2: HTML5 drag events ───────────────────────────────────────
    function handleDragStart(e) {
      const tabEl = e.target.closest?.(".tab");
      if (!tabEl) return;
      beginDrag(getTabIdFromElement(tabEl));
    }

    // ── Track 3: DOM signals ─────────────────────────────────────────────
    function handleDragDomMutation(muts) {
      for (const m of muts) {
        if (m.type === "attributes" && m.attributeName === "class") {
          const cls = m.target.classList;
          if (cls?.contains?.("tab-position") && (cls.contains("dragging") || cls.contains("is-dragging"))) {
            beginDrag(getTabIdFromElement(m.target));
            return;
          }
        } else if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && (n.classList?.contains("tab-dropzone") || n.id === "drag-image")) {
              const pos = n.closest?.(".tab-position") || document.querySelector(".tab-position.dragging");
              beginDrag(getTabIdFromElement(pos));
              return;
            }
          }
        }
      }
    }

    const dragDomObserver = new MutationObserver(handleDragDomMutation);
    dragDomObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", handleMouseUp, true);
    document.addEventListener("dragstart", handleDragStart, true);

    // ── Drag-over: keep drop alive + hover feedback ─────────────────────
    document.addEventListener("dragover", (e) => {
      if (!state.dragging) return;
      // Vivaldi's own drags carry its MIME and are kept alive by its own
      // windowDragOverHandler. Our dock-drag carries no Vivaldi MIME, so we
      // must preventDefault ourselves to keep the drop event deliverable.
      if (state.dockDragTabId) e.preventDefault();
      updateDockHover(e.clientX, e.clientY);
    }, true);

    // ── Drop (capture): dock drops are swallowed, strip drops recorded.
    // Vivaldi's windowDropHandler detaches the tab whenever dndMode is not
    // "move" — true for C++-driven drags — so a dock drop must not reach
    // it: first deliver a synthetic drop so it sets mB.dropHandlerFired
    // (empty dataTransfer → flag only, no moves), then stop the real drop.
    // Strip drops are deferred to the drag-end signal (runPendingDrop).
    document.addEventListener("drop", (e) => {
      if (!state.dragging) return;
      const sourceId = state.dockDragTabId || state.draggedTabId;
      if (!sourceId || state.dropHandled) return;
      const x = e.clientX, y = e.clientY;

      const rootRect = state.root?.getBoundingClientRect();
      if (rootRect && isInRect(rootRect, x, y)) {
        // dropHandled set BEFORE dispatching: the synthetic drop's own
        // capture pass (re-entrant) must exit immediately.
        state.dropHandled = true;
        const ev = new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: new DataTransfer(),
        });
        document.dispatchEvent(ev); // windowDropHandler sets dropHandlerFired
        e.stopImmediatePropagation(); // real drop never reaches detach logic
        state.pendingDrop = { sourceId, x, y, kind: "dock" };
        return;
      }

      const strip = document.querySelector(".tab-strip");
      if (strip && isInRect(strip.getBoundingClientRect(), x, y)) {
        state.dropHandled = true;
        state.pendingDrop = { sourceId, x, y, kind: "strip" };
      }
    }, true);

    // Drag ended anywhere (drop, escape, other window) — also the reconcile
    // trigger signal when tabsPrivate.onDragEnd is not subscribable.
    document.addEventListener("dragend", () => {
      onDragEndSignal();
      if (state.dragging) endDragState();
    }, true);

    state.disposeListeners.push(() => dragDomObserver.disconnect());
  }

  // Start drag detection immediately, independent of init()
  setupDragDetection();

  // ─── Drop Zone (favorites empty only) ─────────────────────────────────

  function showDropZone() {
    if (state.favorites.length > 0) return; // never with favorites present
    if (state.dropZoneVisible) return;
    state.dropZoneVisible = true;
    state.dropZone.classList.add("fav-dock-dropzone-visible");
    updateDockVisibility();
  }

  function hideDropZone() {
    if (!state.dropZoneVisible) return;
    state.dropZoneVisible = false;
    state.dropZone.classList.remove("fav-dock-dropzone-visible", "fav-dock-dropzone-active");
    if (state.favorites.length === 0) {
      setTimeout(() => {
        if (!state.dropZoneVisible && state.favorites.length === 0) {
          updateDockVisibility();
        }
      }, 300);
    }
  }

  // ─── Dock drop handling ────────────────────────────────────────────────

  async function handleDockDrop(sourceId, x, y) {
    const slotIdx = getSlotIndexAt(x, y);
    console.log("[FavDock] drop in dock → slot", slotIdx, "tab", sourceId);
    const srcFavIdx = state.favorites.findIndex((f) => f.tabId === sourceId);
    if (srcFavIdx >= 0) {
      if (slotIdx >= 0 && slotIdx !== srcFavIdx) {
        await moveFavoriteTo(sourceId, slotIdx);
      }
    } else if (slotIdx >= 0) {
      await addFavorite(sourceId, slotIdx);
    } else {
      await addFavorite(sourceId); // fell between slots → end of list
    }
    endDragState();
  }

  // Vivaldi has already moved the tab itself; we correct the state so the
  // pinned/favorite invariants hold. Zone detection uses the .separate
  // divider (above = pinned block, below = normal tabs).
  async function reconcileStripDrop(sourceId, x, y) {
    const src = await getTabById(sourceId);
    if (!src) return;
    if (src.windowId !== state.currentWindowId) {
      // Tab left this window (detach/close) — never pin across windows.
      console.log("[FavDock] reconcile skip: tab in window", src.windowId);
      scheduleSync();
      return;
    }

    const sep = document.querySelector(".tab-strip .separate") ||
                document.querySelector(".separate");
    let inPinnedZone;
    if (sep) {
      inPinnedZone = y < sep.getBoundingClientRect().top;
    } else {
      // Fallback: pinned count from the tab list
      const tabs = await queryTabs({ currentWindow: true });
      const pinnedCount = tabs.filter((t) => t.pinned).length;
      inPinnedZone = computeRealInsertIndex(y) < pinnedCount;
    }
    const insertIdx = computeRealInsertIndex(y);
    const intoFavZone = insertIdx < CONFIG.maxFavorites;

    console.log("[FavDock] reconcile:", sourceId, "→", insertIdx,
      inPinnedZone ? "(pinned)" : "(normal)", intoFavZone ? "+fav" : "");

    if (inPinnedZone) {
      if (!src.pinned) {
        // Vivaldi may not pin cross-type drops by itself
        await updateTab(sourceId, { pinned: true });
      }
      if (intoFavZone) await markFavorite(sourceId);
      else await unmarkFavorite(sourceId);
      const idx = Math.min(insertIdx, CONFIG.maxFavorites - 1);
      await moveTab(sourceId, intoFavZone ? idx : insertIdx);
    } else {
      // Dragged into the normal zone → ensure unpinned + unmarked
      await unmarkFavorite(sourceId);
      if (src.pinned) {
        await updateTab(sourceId, { pinned: false });
        await moveTab(sourceId, Math.max(0, insertIdx - 1));
      }
    }
    scheduleSync();
  }

  // ─── Pending-drop reconcile machinery ────────────────────────────────
  // Drops are recorded at drop time and executed only after the drag fully
  // ended: Vivaldi's bubble-phase drop handlers have run (setting
  // mB.dropHandlerFired) and its async tabsPrivate moves have landed. The
  // trigger signal is tabsPrivate.onDragEnd when subscribable, else the
  // document dragend; execution waits for a 150ms quiet window after the
  // last chrome.tabs model change, capped at 600ms.

  function onTabModelChange() {
    if (state.pendingDrop && state.reconcileTimer) {
      clearTimeout(state.reconcileTimer);
      state.reconcileTimer = setTimeout(runPendingDrop, 150);
    }
  }

  function onDragEndSignal() {
    if (!state.pendingDrop) return;
    if (!state.reconcileTimer) {
      console.log("[FavDock] drag-end signal → wait for tab model to settle");
    }
    clearTimeout(state.reconcileTimer);
    state.reconcileTimer = setTimeout(runPendingDrop, 150);
    if (!state.reconcileCap) {
      state.reconcileCap = setTimeout(runPendingDrop, 600);
    }
  }

  async function runPendingDrop() {
    clearTimeout(state.reconcileTimer);
    clearTimeout(state.reconcileCap);
    state.reconcileTimer = null;
    state.reconcileCap = null;
    const p = state.pendingDrop;
    state.pendingDrop = null;
    if (!p) return;
    if (p.kind === "dock") await handleDockDrop(p.sourceId, p.x, p.y);
    else await reconcileStripDrop(p.sourceId, p.x, p.y);
  }

  function setupDragEndSignal() {
    try {
      const tpe = vivaldi?.tabsPrivate?.onDragEnd;
      if (tpe?.addListener) {
        tpe.addListener(onDragEndSignal);
        state.disposeListeners.push(() => tpe.removeListener?.(onDragEndSignal));
        console.log("[FavDock] tabsPrivate.onDragEnd subscribed ✓");
      } else {
        console.log("[FavDock] tabsPrivate.onDragEnd unavailable → document dragend");
      }
    } catch (err) {
      console.error("[FavDock] tabsPrivate.onDragEnd subscribe failed:", err);
    }
  }

  // ─── Slot / strip indicators (Zen-style) ──────────────────────────────

  function getSlotIndexAt(x, y) {
    for (let i = 0; i < state.slots.length; i++) {
      const r = state.slots[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i;
    }
    return -1;
  }

  let lastHoverSlot = -1;
  let lastSourceIndex = -999;

  // Drive dock hover feedback from both dragover and mousemove (C++-path
  // drags fire no dragover). Light DOM work only, no logging.
  function updateDockHover(x, y) {
    if (!state.dragging) return;
    const overDock = !!state.root && isInRect(state.root.getBoundingClientRect(), x, y);
    if (overDock !== state.dockHovering) {
      state.dockHovering = overDock;
      state.root?.classList.toggle("fav-dock-dragover", overDock);
      renderDock(); // show/hide the empty trailing slots
    }
    if (overDock) {
      // Highlight the big drop zone when the grid is hidden (empty favorites)
      if (state.favorites.length === 0 && state.dropZone) {
        const dz = state.dropZone.getBoundingClientRect();
        state.dropZone.classList.toggle(
          "fav-dock-dropzone-active",
          dz.height > 0 && isInRect(dz, x, y)
        );
      }
      updateSlotIndicators(getSlotIndexAt(x, y));
    } else {
      clearSlotIndicators();
      state.dropZone?.classList.remove("fav-dock-dropzone-active");
    }
  }

  // Hover feedback: highlight the target slot only. The previous Zen-style
  // translate-yield animation is gone — it fought the stretch-to-fill row
  // layout and made slots jitter between competing targets.
  function updateSlotIndicators(hoverIdx) {
    if (hoverIdx < 0) {
      clearSlotIndicators();
      return;
    }
    const srcIdx = state.favorites.findIndex(
      (f) => f.tabId === (state.dockDragTabId || state.draggedTabId)
    );
    if (hoverIdx === lastHoverSlot && srcIdx === lastSourceIndex) return;
    lastHoverSlot = hoverIdx;
    lastSourceIndex = srcIdx;
    state.slots.forEach((slot, i) => {
      slot.classList.toggle("fav-dock-slot-target", i === hoverIdx);
    });
  }

  function clearSlotIndicators() {
    if (lastHoverSlot === -1 && lastSourceIndex === -999) return;
    lastHoverSlot = -1;
    lastSourceIndex = -999;
    for (const slot of state.slots) {
      slot.classList.remove("fav-dock-slot-target");
    }
  }

  // Real tab index (counting hidden favorite pins) for a client Y position
  function computeRealInsertIndex(y) {
    const strip = document.querySelector(".tab-strip");
    if (!strip) return 0;
    const all = [...strip.querySelectorAll(".tab-position")];
    const visible = all.filter((p) => p.getBoundingClientRect().height > 0);
    if (!visible.length) return all.length;
    for (let i = 0; i < visible.length; i++) {
      const r = visible[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        return all.indexOf(visible[i]);
      }
    }
    return all.length;
  }

  // ─── Utilities ─────────────────────────────────────────────────────────

  function isInRect(rect, x, y) {
    return rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function getTabIdFromElement(el) {
    if (!el) return null;
    // .tab-wrapper can sit above or below the loop element depending on the
    // strip's DOM shape; search both directions.
    const wrapper = el.closest?.(".tab-wrapper") || el.querySelector?.(".tab-wrapper") || el;
    const dataId = wrapper.getAttribute?.("data-id");
    if (dataId) {
      const num = parseInt(dataId.replace(/^tab-/, ""), 10);
      if (Number.isFinite(num) && num > 0) return num;
    }
    const pos = el.closest?.(".tab-position") || el;
    const idAttr = pos.getAttribute?.("id");
    if (idAttr) {
      const num = parseInt(idAttr.replace(/\D/g, ""), 10);
      if (Number.isFinite(num) && num > 0) return num;
    }
    if (pos.dataset) {
      for (const k of ["tabId", "tab-id", "pageId", "page-id"]) {
        const num = parseInt(pos.dataset[k], 10);
        if (Number.isFinite(num) && num > 0) return num;
      }
    }
    return null;
  }

  function onSlotDragStart(e, tabId) {
    state.dropHandled = false;
    state.dragging = true;
    state.dockDragTabId = tabId;
    e.dataTransfer.setData("text/favdock-tab", String(tabId));
    e.dataTransfer.effectAllowed = "move";
    // Cache the element: e.currentTarget is nulled once the dragstart
    // event finishes dispatching, before the rAF callback runs.
    const slot = e.currentTarget;
    requestAnimationFrame(() => {
      slot?.classList.add("fav-dock-dragging");
    });
  }

  // ─── Tab Event Listeners ───────────────────────────────────────────────

  function onTabActivated(activeInfo) {
    if (activeInfo.windowId !== state.currentWindowId) return;
    state.activeTabId = activeInfo.tabId;
    // Workspace switch = active tab's workspaceId changed → re-derive.
    getCurrentWorkspaceId().then((wsId) => {
      if (wsId !== state.currentWsId) {
        state.currentWsId = wsId;
        scheduleSync();
      }
    });
    renderDock();
  }

  function onTabUpdated(tabId, changeInfo, tab) {
    if (tab.windowId !== state.currentWindowId) return;
    onTabModelChange();
    if (changeInfo.title || changeInfo.favIconUrl || changeInfo.url || changeInfo.pinned !== undefined) {
      scheduleSync();
    }
  }

  function onTabRemoved() {
    onTabModelChange();
    scheduleSync();
  }

  function onTabCreated(tab) {
    onTabModelChange();
    if (tab.windowId === state.currentWindowId && tab.pinned) scheduleSync();
  }

  function onTabMoved() {
    onTabModelChange();
  }

  // ─── Mount / Unmount ───────────────────────────────────────────────────

  function ensureMounted() {
    const container = document.querySelector("#tabs-container") ||
                      document.querySelector("#tabs-tabbar-container");
    if (!container) return;

    if (!state.root) {
      state.root = createRoot();
      updateDockVisibility();
    }

    // Mount at the top of #tabs-container (the strip's own column). The
    // sibling-mount experiment (parent container) broke the sidebar layout
    // because the parent's flex orientation is unknown — revert to the
    // proven in-container position; reflowStrip keeps the strip contiguous.
    if (state.mountedContainer !== container || !container.contains(state.root)) {
      container.prepend(state.root);
      state.mountedContainer = container;
      console.log("[FavDock] ✓ mounted in", container.id);
    }
  }

  function observeMounts() {
    if (state.mountObserver) state.mountObserver.disconnect();
    let timer = null;
    state.mountObserver = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(ensureMounted, 500);
    });
    const browser = document.querySelector("#browser") || document.documentElement;
    state.mountObserver.observe(browser, { childList: true, subtree: true });
    state.disposeListeners.push(() => state.mountObserver?.disconnect());
  }

  // Keep .favdock-hidden applied when the tab strip rebuilds. Observe the
  // stable #tabs-container ancestor — Vivaldi can replace the whole
  // .tab-strip node (workspace switches, big reorders), which would orphan
  // an observer attached to it. ensureStripObserver self-heals on re-sync.
  function observeTabStrip() {
    ensureStripObserver();
    state.disposeListeners.push(() => state.stripObserver?.disconnect());
  }

  function ensureStripObserver() {
    const container = document.querySelector("#tabs-container") ||
                      document.querySelector("#tabs-tabbar-container");
    if (state.stripObserver && state.observedContainer === container) return;
    if (state.stripObserver) {
      state.stripObserver.disconnect();
      state.stripObserver = null;
    }
    state.observedContainer = container;
    if (!container) return;
    let timer = null;
    state.stripObserver = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        applyHiddenPins();
        scheduleSync();
      }, 200);
    });
    state.stripObserver.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  function registerListener(obj, event, handler) {
    obj[event].addListener(handler);
    state.disposeListeners.push(() => obj[event].removeListener(handler));
  }

  // ─── Initialization ────────────────────────────────────────────────────

  async function init() {
    try {
      const windows = await new Promise((r) => chrome.windows.getLastFocused(r));
      state.currentWindowId = windows?.id;
      const activeTabs = await queryTabs({ currentWindow: true, active: true });
      if (activeTabs[0]) state.activeTabId = activeTabs[0].id;
      state.currentWsId = await getCurrentWorkspaceId();

      ensureMounted();
      observeMounts();
      observeTabStrip();
      setupDragEndSignal();
      await syncFavoritesNow();

      registerListener(chrome.tabs, "onActivated", onTabActivated);
      registerListener(chrome.tabs, "onUpdated", onTabUpdated);
      registerListener(chrome.tabs, "onRemoved", onTabRemoved);
      registerListener(chrome.tabs, "onCreated", onTabCreated);
      registerListener(chrome.tabs, "onMoved", onTabMoved);
      registerListener(chrome.windows, "onFocusChanged", (windowId) => {
        if (windowId === chrome.windows.WINDOW_ID_NONE) return;
        state.currentWindowId = windowId;
        scheduleSync();
      });

      // Released outside the window → no mouseup/dragend ever fires → drag
      // state would stick and swallow the next drag (and leave the strip
      // indicator behind). Clean up when the window loses focus.
      window.addEventListener("blur", () => {
        if (state.dragging) endDragState();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && state.dragging) endDragState();
      });

      console.log("[FavDock] ✓ init complete (" + state.favorites.length + " favorites)");
    } catch (err) {
      console.error("[FavDock] init() error:", err);
    }
  }

  init();
})();
