// =============================================================================
// Edge-Style Close & Discard for Vivaldi Web Panels — Root-Cause Fix
// =============================================================================
//
// Why previous fixes failed:
//   Previous iterations used chrome.tabs.discard() on close. Discard only suspends
//   the tab in memory — it does NOT remove the tabId from Vivaldi's internal panel
//   tab registry (Pge.Z). So when the panel reopened:
//     1. Rge._createRelatedTab() checked _getRelatedTabId() → found existing tabId → returned early
//     2. this.home() set wv.src, but Chromium simultaneously un-discarded the old tab
//        and restored its session history → RACE CONDITION → old URL won
//
// The correct fix:
//   On explicit (X) close, call chrome.tabs.remove(tabId). This triggers Chromium's
//   chrome.tabs.onRemoved event, which Vivaldi's internal pe() handler catches and
//   calls Pge.Z.offerEraseTabId(tabId) — completely wiping the tabId from the registry.
//   On reopen, _getRelatedTabId() returns undefined, so _createRelatedTab() runs fully:
//     r.Z.tabs.create({ url: this.props.webPanel.url, ... })
//   Creating a 100% fresh tab with zero navigation history. No race. No session restore.
//
// =============================================================================

(function () {
  'use strict';

  // ── Configuration ─────────────────────────────────────────────────────────
  const GLIDE_DELAY_MS = 150;     // Delay for panel exit animation before tab teardown
  const REVIVE_TIMEOUT_MS = 2500; // Safety timeout for wakeup lock release

  // Exact native Vivaldi close icon SVG (from Vivaldi's core icon library Pe.kze)
  const NATIVE_CLOSE_SVG = [
    '<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">',
    '  <path d="M4.293 4.293a1 1 0 0 1 1.414 0L8 6.586l2.293-2.293a1 1 0 1 1 1.414 1.414L9.414 8l2.293 2.293a1 1 0 0 1-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L6.586 8 4.293 5.707a1 1 0 0 1 0-1.414Z"/>',
    '</svg>'
  ].join('');

  // ── State Tracking ────────────────────────────────────────────────────────
  const closedPanelsForReset = new Set(); // Panel IDs flagged for fresh tab creation on reopen
  const revivingTabs = new Set();          // Atomic lock to prevent duplicate reload loops

  // ── React Bridge: Reopen Signal ───────────────────────────────────────────
  // Called by Rge.componentDidUpdate in bundle.js when panel transitions hidden → visible.
  // Returns true if this panel was explicitly closed via (X) and needs a fresh tab.
  window.__edgeShouldReset = function (panelId) {
    if (!panelId) return false;
    if (closedPanelsForReset.has(panelId)) {
      closedPanelsForReset.delete(panelId);
      log('__edgeShouldReset: true for panel', panelId, '→ _createRelatedTab() + home() will fire');
      return true;
    }
    return false;
  };

  // ── Debug Logging ─────────────────────────────────────────────────────────
  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log('[EdgePanelMod]', ...args);
  }
  function warn(...args) {
    console.warn('[EdgePanelMod]', ...args);
  }

  // ── DOM Helpers ───────────────────────────────────────────────────────────
  function getLivePanels() {
    return Array.from(document.querySelectorAll(
      '#panels .panel, #panels .webpanel, .panel-group .panel, #panels-container .panel'
    ));
  }

  function getWebview(panel) {
    if (!panel) return document.querySelector('#panels webview');
    return panel.querySelector('webview') || document.querySelector('#panels webview');
  }

  function getTabId(wv) {
    if (!wv) return null;
    const raw = wv.getAttribute('tab_id') || wv.tab_id;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? null : parsed;
  }

  function getPanelId(panel) {
    if (!panel) return null;
    const idAttr = panel.getAttribute('data-id') || panel.getAttribute('id') || panel.dataset?.id;
    if (idAttr && idAttr !== 'panels') return idAttr;

    const rge = getRgeComponent(panel);
    if (rge?.props?.webPanel?.id) return rge.props.webPanel.id;

    const wv = getWebview(panel);
    if (wv) {
      const tabId = getTabId(wv);
      if (tabId) return `tab-${tabId}`;
    }
    return null;
  }

  // ── Extension Panel Guard ─────────────────────────────────────────────────
  function isExtensionPanel(panel) {
    if (!panel) return false;

    const rge = getRgeComponent(panel);
    if (rge && typeof rge.isExtension === 'function') {
      try { if (rge.isExtension()) return true; } catch (_) {}
    }

    const panelId = getPanelId(panel);
    if (panelId && typeof panelId === 'string') {
      if (/^(ext-|extension-|panel-ext|EXT_PANEL_)/.test(panelId)) return true;
    }

    const wv = getWebview(panel);
    const src = wv?.src || wv?.getAttribute('src') || '';
    if (/^(chrome-extension:|vivaldi:|chrome:)/.test(src)) return true;

    return false;
  }

  // ── Rge (WebPanel Component) Resolver ────────────────────────────────────
  function getRgeComponent(panel) {
    if (!panel) return null;

    for (const key of Object.keys(panel)) {
      if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
        let fiber = panel[key];
        while (fiber) {
          if (fiber.stateNode && typeof fiber.stateNode.home === 'function') {
            return fiber.stateNode;
          }
          if (fiber.child?.stateNode && typeof fiber.child.stateNode.home === 'function') {
            return fiber.child.stateNode;
          }
          fiber = fiber.return;
        }
      }
    }

    const header = panel.querySelector('header.webpanel-header, .panel-header, header');
    if (header) {
      for (const key of Object.keys(header)) {
        if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
          let fiber = header[key];
          while (fiber) {
            if (fiber.stateNode && typeof fiber.stateNode.home === 'function') {
              return fiber.stateNode;
            }
            fiber = fiber.return;
          }
        }
      }
    }

    return null;
  }

  // ── Multi-Tier Panel Close Trigger (UI Level) ──────────────────────────────
  // Toggles the panel closed via the sidebar switcher button, which dispatches
  // PANEL_CLOSE and sets contentVisible=false → Rge receives isVisible=false.
  function closeActivePanel(panel) {
    const activeSwitchBtn = document.querySelector(
      '#switch .button-toolbar.active button, #switch button.active, .button-toolbar-webpanel.active button'
    );

    if (activeSwitchBtn) {
      const downEvent = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' });
      const upEvent = new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' });
      activeSwitchBtn.dispatchEvent(downEvent);
      activeSwitchBtn.dispatchEvent(upEvent);
      return;
    }

    const toggleBtn = document.querySelector(
      '#panels button.panel-collapse-guard, button[name="PanelToggle"], #panels .panel-header button.close, #panels header button.close'
    );
    if (toggleBtn && typeof toggleBtn.click === 'function') {
      toggleBtn.click();
      return;
    }

    try {
      const f4Event = new KeyboardEvent('keydown', { key: 'F4', code: 'F4', keyCode: 115, which: 115, bubbles: true, cancelable: true });
      document.dispatchEvent(f4Event);
    } catch (_) {}

    if (panel && panel.classList.contains('visible')) {
      panel.classList.remove('visible');
    }
  }

  // ── Destroy Panel Tab via chrome.tabs.remove() ────────────────────────────
  // THIS IS THE KEY FIX: remove() (not discard()) completely destroys the tab.
  // Chromium fires chrome.tabs.onRemoved → Vivaldi's pe() handler calls
  // Pge.Z.offerEraseTabId() → tabId wiped from Pge.Z registry.
  // On reopen, _getRelatedTabId() returns undefined → _createRelatedTab() creates fresh tab.
  function destroyPanelTab(panel) {
    if (isExtensionPanel(panel)) {
      log('Skipping tab destruction on extension panel');
      return;
    }

    const wv = getWebview(panel);
    if (!wv) return;

    const tabId = getTabId(wv);
    const src = wv.src || wv.getAttribute('src') || '';

    if (src && !src.startsWith('http')) return;

    if (tabId && typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
      log('Destroying tab via chrome.tabs.remove (tabId:', tabId, ')');
      chrome.tabs.remove(tabId, () => {
        if (chrome.runtime?.lastError) {
          warn('chrome.tabs.remove failed for tabId:', tabId, chrome.runtime.lastError.message);
        } else {
          log('Tab fully removed from Chromium and Pge.Z (tabId:', tabId, ')');
        }
      });
    }
  }

  // ── Handle Edge-Style Close (X): Flag + Close UI + Destroy Tab ────────────
  function handleEdgeClose(panel) {
    if (!panel || panel.__isClosing) return;
    panel.__isClosing = true;

    if (panel.__glideTimer) {
      clearTimeout(panel.__glideTimer);
      panel.__glideTimer = null;
    }

    log('Edge Close (X) triggered — will destroy tab and flag for fresh creation');

    const panelId = getPanelId(panel);

    // Flag this panel so __edgeShouldReset returns true on reopen
    if (panelId) closedPanelsForReset.add(panelId);

    // Close the panel UI (triggers PANEL_CLOSE → contentVisible=false → isVisible=false)
    closeActivePanel(panel);

    // After glide animation, fully destroy the underlying Chromium tab
    panel.__glideTimer = setTimeout(() => {
      panel.__glideTimer = null;
      panel.__isClosing = false;
      destroyPanelTab(panel);
    }, GLIDE_DELAY_MS);
  }

  // ── Global Native Rge Close Bridge ──────────────────────────────────────────
  // Called from patched bundle.js when the native Rge close button is clicked.
  // Has direct access to the Rge component instance ('this' in Rge render).
  window.__edgeCloseWebPanel = function (rge) {
    if (!rge) return;
    try {
      const panelId = rge.props?.webPanel?.id;
      const wv = rge.refWebpanelwebview?.current || document.querySelector('#panels webview');
      const tabId = rge.props?.tabId || (wv ? getTabId(wv) : null);
      const domPanel = rge.nodeRef?.current ||
        (panelId ? document.querySelector(`#panels [data-id="${panelId}"], #panels .panel, #panels .webpanel`) : null);

      // Flag for fresh tab creation on reopen
      if (panelId) closedPanelsForReset.add(panelId);

      // Close the panel UI
      if (domPanel) {
        closeActivePanel(domPanel);
      } else {
        closeActivePanel();
      }

      // Fully destroy the tab (not discard!)
      if (tabId && typeof chrome !== 'undefined' && chrome?.tabs?.remove) {
        setTimeout(() => {
          log('Destroying tab via __edgeCloseWebPanel (tabId:', tabId, ')');
          chrome.tabs.remove(tabId, () => {
            if (chrome.runtime?.lastError) {
              warn('chrome.tabs.remove failed:', chrome.runtime.lastError.message);
            } else {
              log('Tab fully removed (tabId:', tabId, ')');
            }
          });
        }, GLIDE_DELAY_MS);
      }
    } catch (err) {
      console.warn('[EdgePanelMod] __edgeCloseWebPanel error:', err);
    }
  };

  // ── Handle Reopen ──────────────────────────────────────────────────────────
  // When panel becomes visible again after being hidden.
  // For explicit (X) closes: the bundle.js patch handles reset via componentDidUpdate
  //   (_createRelatedTab() + home()) — we don't need to do anything here for those.
  // For auto-hide (multitasking): the tab was never destroyed, so the session is warm.
  //   Nothing to do.
  function handleReopen(panel) {
    if (!panel) return;

    // Cancel any pending destruction if user reopened before glide timer
    if (panel.__glideTimer) {
      clearTimeout(panel.__glideTimer);
      panel.__glideTimer = null;
      log('Reopened panel before destruction timer; cancelled pending tab removal');
    }
    panel.__isClosing = false;
  }

  // ── Unify / Ensure Close Button in Header ──────────────────────────────────
  function setupCloseButton(panel) {
    const header = panel.querySelector('header.webpanel-header, .panel-header, header');
    if (!header) return;

    if (!header.__edgeCloseCaptureBound) {
      header.__edgeCloseCaptureBound = true;
      header.addEventListener(
        'click',
        (e) => {
          const closeBtn = e.target.closest('button.close, .mod-edge-close-btn, [aria-label="Close Panel"]');
          if (closeBtn) {
            e.stopImmediatePropagation();
            e.preventDefault();
            handleEdgeClose(panel);
          }
        },
        true
      );
    }

    const nativeBtn = header.querySelector('button.close:not(.mod-edge-close-btn)');
    const modBtn = header.querySelector('button.mod-edge-close-btn');

    if (nativeBtn) {
      if (modBtn) {
        modBtn.remove();
        log('Removed duplicate injected close button; using native close button');
      }
      nativeBtn.title = 'Close Panel & Reset (Edge Style)';
      nativeBtn.setAttribute('tabindex', '-1');
      return;
    }

    if (!modBtn) {
      const toolbar = header.querySelector('.toolbar-default, .toolbar-group') || header;

      const btn = document.createElement('button');
      btn.className = 'close transparent mod-edge-close-btn';
      btn.title = 'Close Panel & Reset (Edge Style)';
      btn.setAttribute('aria-label', 'Close Panel');
      btn.setAttribute('tabindex', '-1');
      btn.innerHTML = `<span class="VivaldiSvgIcon" aria-hidden="true">${NATIVE_CLOSE_SVG}</span>`;

      toolbar.appendChild(btn);
      log('Injected close button into header');
    }
  }

  // ── Panel Visibility Observation ───────────────────────────────────────────
  function handleVisibilityChange(panel) {
    const isVisible = panel.classList.contains('visible');

    if (isVisible) {
      setupCloseButton(panel);
      handleReopen(panel);
    } else {
      log('Panel hidden; session preserved (if multitask) or tab will be destroyed (if X close).');
    }
  }

  function observePanel(panel) {
    if (panel.__edgeModObserved) return;
    panel.__edgeModObserved = true;

    new MutationObserver(() => handleVisibilityChange(panel))
      .observe(panel, { attributes: true, attributeFilter: ['class'] });

    if (panel.classList.contains('visible')) {
      setupCloseButton(panel);
      handleReopen(panel);
    }
  }

  // ── Global Fallback Close Click Guard ──────────────────────────────────────
  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('#panels button.close, #panels .mod-edge-close-btn, #panels [aria-label="Close Panel"]');
    if (closeBtn) {
      const panel = closeBtn.closest('.panel, .webpanel, #panels > div') || getLivePanels()[0];
      if (panel) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleEdgeClose(panel);
      }
    }
  }, true);

  // ── Initialization & Scoped Container Watcher ──────────────────────────────
  function scanAndInit() {
    const panels = getLivePanels();
    if (!panels.length) return false;
    panels.forEach(observePanel);

    const container = document.querySelector('#panels-container') || document.querySelector('#panels') || document.body;
    new MutationObserver(() => {
      getLivePanels().forEach(observePanel);
    }).observe(container, { childList: true, subtree: false });

    return true;
  }

  function bootstrap() {
    if (scanAndInit()) return;

    const observer = new MutationObserver((_, obs) => {
      if (scanAndInit()) obs.disconnect();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
