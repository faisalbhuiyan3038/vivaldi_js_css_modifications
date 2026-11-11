// PiP window helper for Vivaldi's UI (window.html)  v1.0.0
//
// Companion to the Firefox-style picture-in-picture mod (picture-in-picture.js in
// resources\vivaldi\components\picture-in-picture\). Web pages can't move windows between monitors or make a
// PiP window fullscreen, but Vivaldi's UI can. The PiP mod asks this helper (cross-extension message) to:
//   enterFullscreen → move the video's tab into its own window on the monitor the PiP window is on and make
//                     that window fullscreen (your browsing window on the other monitor is left alone);
//   exitFullscreen  → move the tab back to its original window and position;
//   pipOpened/pipClosed → remember where you leave PiP windows (monitor, corner, size — for all sites) and open
//                     new ones there, like Firefox.
//
// Install: copy this file into resources\vivaldi\custom-js\ (or wherever your other window.html mods live)
// and add  <script src="custom-js/pip-window-helper.js"></script>  before </body> in window.html.

(() => {
  'use strict';
  if (window.__vivaldiPipHelper) return;
  window.__vivaldiPipHelper = true;

  const VERSION = 1;
  const PIP_COMPONENT_ID = 'jffbochibkahlbbmanpmndnhmeliecah'; // Vivaldi's internal picture-in-picture component
  const LOG = (...a) => console.debug('[FPiP helper]', ...a);

  // Every Vivaldi window runs its own copy of window.html (and of this helper). Only the window that currently
  // holds the sender's tab answers, so each request is handled exactly once.
  const myWindowId = chrome.windows.getCurrent().then((w) => w.id);

  // —— PiP placement memory (shared by all windows and all sites: chrome.storage.local of Vivaldi's UI;
  //    window.html's localStorage is null in Vivaldi) ——
  // Chromium always opens a document PiP window bottom-right on the primary monitor and forgets where you put it.
  // We remember the last place (monitor + nearest corner + size) and move every new PiP window there.
  const PLACEMENT_KEY = 'fpip.placement';
  const createdAt = new Map(); // windowId -> time created (to identify a freshly opened PiP window)
  const bounds = new Map();    // windowId -> last known bounds
  const pipByTab = new Map();  // opener tabId -> PiP windowId
  const applied = new Map();   // PiP windowId -> the saved placement we restored it from (to avoid drift)
  const rememberBounds = (w) => bounds.set(w.id, { left: w.left, top: w.top, width: w.width, height: w.height });
  chrome.windows.onCreated.addListener((w) => { createdAt.set(w.id, Date.now()); rememberBounds(w); });
  // Keep a closed window's last bounds briefly: the PiP mod's "pipClosed" message can arrive after the removal.
  chrome.windows.onRemoved.addListener((id) => { createdAt.delete(id); setTimeout(() => bounds.delete(id), 30000); });
  chrome.windows.onBoundsChanged.addListener(rememberBounds);

  const loadPlacement = async () => {
    try { return (await chrome.storage.local.get(PLACEMENT_KEY))[PLACEMENT_KEY] || null; } catch (_) { return null; }
  };
  const savePlacement = async (p) => {
    try { await chrome.storage.local.set({ [PLACEMENT_KEY]: p }); } catch (e) { LOG('could not save placement:', e && e.message); }
  };
  const validRect = (r) => !!r && [r.left, r.top, r.width, r.height].every(Number.isFinite) && r.width > 100 && r.height > 100;

  // The PiP window is a one-tab about:blank window that appeared just now and isn't the opener's window.
  async function findNewPipWindow(openerWindowId) {
    const all = await chrome.windows.getAll({ populate: true });
    const cands = all.filter((w) => w.id !== openerWindowId && w.tabs && w.tabs.length === 1 &&
      w.tabs[0].url === 'about:blank' && w.state !== 'fullscreen');
    const recent = cands.filter((w) => Date.now() - (createdAt.get(w.id) || 0) < 10000);
    const pick = (recent.length ? recent : cands).sort((a, b) => b.id - a.id)[0];
    if (pick) rememberBounds(pick);
    return pick || null;
  }

  // Where should a PiP window of size w×h go, given the saved placement? Same monitor, same nearest corner.
  function targetBounds(p, w, h) {
    const s = p.screen;
    const b = p.bounds;
    const width = Math.round(Math.min(p.keepSize ? b.width : w, s.width));
    const height = Math.round(Math.min(p.keepSize ? b.height : h, s.height));
    const dl = b.left - s.left, dr = s.left + s.width - (b.left + b.width);
    const dt = b.top - s.top, db = s.top + s.height - (b.top + b.height);
    let left = dl <= dr ? s.left + dl : s.left + s.width - dr - width;
    let top = dt <= db ? s.top + dt : s.top + s.height - db - height;
    left = Math.round(Math.min(Math.max(left, s.left), s.left + s.width - width));
    top = Math.round(Math.min(Math.max(top, s.top), s.top + s.height - height));
    return { left, top, width, height };
  }

  chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
    if (sender.id !== PIP_COMPONENT_ID || !msg || !msg.fpip || !sender.tab) return false;
    myWindowId.then((id) => {
      if (sender.tab.windowId !== id) return;
      if (msg.fpip === 'exitFullscreen') {
        // Moving the tab out closes this (temporary) window and this copy of the helper with it, so answer first.
        reply({ ok: true });
        handle(msg, sender.tab).catch((e) => LOG('exitFullscreen failed:', e && e.message));
        return;
      }
      handle(msg, sender.tab)
        .then(reply, (e) => reply({ ok: false, error: String((e && e.message) || e) }));
    });
    return true; // async reply
  });

  async function handle(msg, tab) {
    switch (msg.fpip) {
      case 'ping':
        return { ok: true, version: VERSION };

      case 'enterFullscreen': {
        const s = msg.screen || {};
        const valid = [s.left, s.top, s.width, s.height].every(Number.isFinite) && s.width > 100 && s.height > 100;
        const bounds = valid
          ? { left: Math.round(s.left + 40), top: Math.round(s.top + 40),
              width: Math.round(Math.min(960, s.width - 80)), height: Math.round(Math.min(600, s.height - 80)) }
          : {};
        const origin = { origWindowId: tab.windowId, origIndex: tab.index };
        const win = await chrome.windows.create({ tabId: tab.id, focused: true, ...bounds });
        await chrome.windows.update(win.id, { state: 'fullscreen' });
        LOG('tab', tab.id, 'fullscreen in window', win.id, 'on', JSON.stringify(s));
        return { ok: true, windowId: win.id, ...origin };
      }

      case 'exitFullscreen': {
        let target = msg.origWindowId;
        try { await chrome.windows.get(target); } catch (_) { target = null; }
        if (target === null) {
          // The original window is gone: keep the tab in this window, just leave fullscreen.
          await chrome.windows.update(tab.windowId, { state: 'maximized' });
          return { ok: true, stayed: true };
        }
        await chrome.tabs.move(tab.id, { windowId: target, index: Number.isInteger(msg.origIndex) ? msg.origIndex : -1 });
        LOG('tab', tab.id, 'back in window', target, 'at', msg.origIndex);
        return { ok: true };
      }

      // A PiP window just opened for this tab: move it to where the user last left one.
      case 'pipOpened': {
        const pip = await findNewPipWindow(tab.windowId);
        if (!pip) return { ok: false, error: 'PiP window not found' };
        pipByTab.set(tab.id, pip.id);
        const p = await loadPlacement();
        if (!msg.remember || !p || !validRect(p.screen) || !p.bounds) return { ok: true, moved: false };
        // Chromium ignores the position when moving and resizing a PiP window in one call (it clamps the size to
        // the current monitor and stays put), so: move to the monitor, resize there, then re-place at the corner
        // using the size Chromium actually allowed (resizing re-centres the window).
        const t = targetBounds(p, pip.width, pip.height);
        await chrome.windows.update(pip.id, { left: t.left, top: t.top });
        const sized = await chrome.windows.update(pip.id, { width: t.width, height: t.height });
        const final = targetBounds({ ...p, keepSize: false }, sized.width, sized.height);
        const placed = await chrome.windows.update(pip.id, { left: final.left, top: final.top });
        rememberBounds(placed);
        applied.set(pip.id, { placement: p, bounds: { left: placed.left, top: placed.top, width: placed.width, height: placed.height } });
        LOG('PiP', pip.id, 'placed at', JSON.stringify(applied.get(pip.id).bounds));
        return { ok: true, moved: true, screen: p.screen };
      }

      // The placement's monitor is gone (the window landed on another screen): use that screen's bottom-right.
      case 'pipReset': {
        const id = pipByTab.get(tab.id);
        const s = msg.screen;
        if (!id || !validRect(s)) return { ok: false };
        const b = bounds.get(id) || (await chrome.windows.get(id));
        await chrome.windows.update(id, { left: Math.round(s.left + s.width - b.width - 16), top: Math.round(s.top + s.height - b.height - 16) });
        return { ok: true };
      }

      // The PiP window is closing: remember its monitor, position and size for next time.
      case 'pipClosed': {
        const id = pipByTab.get(tab.id);
        pipByTab.delete(tab.id);
        const b = id && bounds.get(id);
        const restoredFrom = id && applied.get(id);
        applied.delete(id);
        if (!msg.remember || !b || !validRect(msg.screen)) return { ok: true, saved: false };
        // Not moved/resized since we placed it (beyond DPI rounding): keep the saved placement as it is.
        if (restoredFrom) {
          const a = restoredFrom.bounds;
          const near = Math.abs(a.left - b.left) <= 12 && Math.abs(a.top - b.top) <= 12 &&
            Math.abs(a.width - b.width) <= 12 && Math.abs(a.height - b.height) <= 12;
          if (near) return { ok: true, saved: false, unchanged: true };
        }
        await savePlacement({ screen: msg.screen, bounds: b, keepSize: true, at: Date.now() });
        LOG('remembered PiP placement', JSON.stringify(b), 'on', JSON.stringify(msg.screen));
        return { ok: true, saved: true };
      }

      // The video's tab got hidden without Chromium offering auto-PiP (e.g. it came back from the fullscreen window
      // as a background tab, or something other than a tab switch hid it) and the page has no user gesture to open
      // PiP itself. Chromium only offers auto-PiP when a tab stops being the active one, so flip: activate the video
      // tab for a moment, then give the active spot back to the tab the user is on.
      case 'nudgeAutoPip': {
        const t = await chrome.tabs.get(tab.id);
        if (t.active) return { ok: false, error: 'tab is active (window hidden or minimized?)' };
        const [current] = await chrome.tabs.query({ windowId: t.windowId, active: true });
        if (!current) return { ok: false, error: 'no active tab' };
        await chrome.tabs.update(t.id, { active: true });
        await new Promise((r) => setTimeout(r, 60));
        await chrome.tabs.update(current.id, { active: true });
        LOG('nudged auto-PiP for tab', t.id);
        return { ok: true };
      }

      // Sent after exitFullscreen for "back to tab"; answered by the helper of the window the tab is now in.
      case 'activateTab':
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return { ok: true };

      default:
        return { ok: false, error: 'unknown request ' + msg.fpip };
    }
  }

  LOG(`v${VERSION} ready`);
})();
