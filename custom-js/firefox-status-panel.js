/**
 * vivaldi-status-bar.js
 * Firefox-style bottom-left status panel for Vivaldi
 * Import via window.html modding
 *
 * Hooks into Vivaldi's webview events:
 *   - did-start-loading
 *   - did-stop-loading
 *   - did-navigate / did-navigate-in-page
 *   - load-commit
 *   - update-target-url  (hover link preview)
 *
 * Usage: Add <script src="vivaldi-status-bar.js"></script>
 *        inside window.html, before </body>
 */

(function () {
  "use strict";

  // ─── Config ────────────────────────────────────────────────────────────────
  const CONFIG = {
    hideDelay: 1800,       // ms before bar auto-hides after load complete
    maxWidth: 480,         // px max width of the panel
    hoverThrottle: 80,     // ms throttle on update-target-url events
    phases: {
      connecting:   (host) => `Connecting to ${host}…`,
      waiting:      (host) => `Waiting for ${host}…`,
      transferring: (host) => `Transferring data from ${host}…`,
      done:         (host) => `Done`,
    },
  };

  // ─── State ──────────────────────────────────────────────────────────────────
  let _hideTimer    = null;
  let _hoverTimer   = null;
  let _isHoverMode  = false;
  let _lastUrl      = "";

  // ─── DOM ────────────────────────────────────────────────────────────────────
  const bar = document.createElement("div");
  bar.id = "viv-status-bar";
  bar.innerHTML = `<span id="viv-status-text"></span>`;

  const style = document.createElement("style");
  style.textContent = `
    #viv-status-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      z-index: 9999999;
      max-width: ${CONFIG.maxWidth}px;
      min-width: 80px;
      padding: 3px 10px 3px 8px;
      background: var(--colorBg, #1e1e1e);
      color: var(--colorFg, #d4d4d4);
      font: 12px/1.5 "Segoe UI", system-ui, sans-serif;
      border-top: 1px solid var(--colorBgDark, #444);
      border-right: 1px solid var(--colorBgDark, #444);
      border-radius: 0 4px 0 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 2px -2px 6px rgba(0,0,0,0.25);
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 0.12s ease, transform 0.12s ease;
      pointer-events: none;
      user-select: none;
    }

    #viv-status-bar.visible {
      opacity: 1;
      transform: translateY(0);
    }

    #viv-status-bar.load-done #viv-status-text {
      opacity: 0.6;
    }

    #viv-status-text {
      display: block;
      transition: opacity 0.2s ease;
    }
  `;

  // ─── Helpers ────────────────────────────────────────────────────────────────
  function getHost(url) {
    try {
      return new URL(url).hostname || url;
    } catch {
      return url;
    }
  }

  function setText(msg) {
    const el = document.getElementById("viv-status-text");
    if (el) el.textContent = msg;
  }

  function show(msg, classes = []) {
    clearTimeout(_hideTimer);
    setText(msg);
    bar.className = ["visible", ...classes].join(" ");
  }

  function hide(delay = 0) {
    clearTimeout(_hideTimer);
    _hideTimer = setTimeout(() => {
      bar.classList.remove("visible");
    }, delay);
  }

  function showPhase(phase, url) {
    const host = getHost(url);
    const msg = CONFIG.phases[phase]?.(host) ?? host;
    show(msg, phase === "done" ? ["load-done"] : []);
  }

  // ─── Webview event wiring ───────────────────────────────────────────────────
  /**
   * Vivaldi's webviews live inside #browser (the main tab area).
   * We use MutationObserver to catch newly created <webview> elements
   * and attach events to each one.
   */
  function attachToWebview(wv) {
    if (wv._statusBarAttached) return;
    wv._statusBarAttached = true;

    wv.addEventListener("did-start-loading", () => {
      _isHoverMode = false;
      const url = wv.getURL?.() || _lastUrl;
      bar.classList.remove("load-done");
      showPhase("connecting", url);
    });

    wv.addEventListener("load-commit", (e) => {
      if (!e.isMainFrame) return;
      _lastUrl = e.url;
      if (!_isHoverMode) showPhase("waiting", e.url);
    });

    wv.addEventListener("did-navigate", (e) => {
      _lastUrl = e.url;
      if (!_isHoverMode) showPhase("transferring", e.url);
    });

    wv.addEventListener("did-navigate-in-page", (e) => {
      if (!e.isMainFrame) return;
      _lastUrl = e.url;
    });

    wv.addEventListener("did-stop-loading", () => {
      if (_isHoverMode) return;
      showPhase("done", _lastUrl);
      hide(CONFIG.hideDelay);
    });

    wv.addEventListener("did-fail-load", (e) => {
      if (e.errorCode === -3) return; // aborted (user navigated away)
      if (!_isHoverMode) {
        show(`Failed: ${e.errorDescription || "Load error"}`);
        hide(CONFIG.hideDelay);
      }
    });

    // Hover link preview — throttled
    wv.addEventListener("update-target-url", (e) => {
      clearTimeout(_hoverTimer);
      _hoverTimer = setTimeout(() => {
        if (e.url) {
          _isHoverMode = true;
          show(e.url);
        } else {
          _isHoverMode = false;
          // Restore loading state or hide
          const isLoading = wv.isLoading?.();
          if (isLoading) {
            showPhase("transferring", _lastUrl);
          } else {
            hide(200);
          }
        }
      }, CONFIG.hoverThrottle);
    });
  }

  // ─── Observer: watch for webviews ───────────────────────────────────────────
  function scanAndAttach() {
    document.querySelectorAll("webview").forEach(attachToWebview);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "WEBVIEW") attachToWebview(node);
        // Also search descendants in case it's wrapped
        node.querySelectorAll?.("webview").forEach(attachToWebview);
      }
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    document.head.appendChild(style);
    document.body.appendChild(bar);

    // Observe the entire document for new webviews
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Attach to any webviews already present at load time
    scanAndAttach();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();