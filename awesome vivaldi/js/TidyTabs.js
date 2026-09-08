// ==UserScript==
// @name         Tidy Tabs
// @description  AI-assisted tab grouping and cleanup for Vivaldi.
// @requirements TidyTabs.css, ClearTabs.css
// @version      2026.7.31
// @author       PaRr0tBoY
// ==/UserScript==

(function () {
  "use strict";

  const configReady = VividAI.loadConfig({ modKey: "tidyTabs" });
  window.addEventListener("vivaldi-mod-ai-config-updated", (e) => {
    VividAI.applyConfig(e.detail || {});
  });
  // ==================== Script Configuration ====================

  const CONFIG = {
    debug: false,
    autoStackWorkspaces: [],
    enableAIGrouping: true,
    enableStackColor: false,
    maxTabsForAI: 50,
    delays: {
      init: 500,
      mutation: 50,
      workspaceSwitch: 100,
      retry: 500,
      reattach: 500,
      debounce: 150,
      autoStack: 1000,
    },
  };

  function applyModSettings(raw) {
    const mods = raw?.mods && typeof raw.mods === "object" ? raw.mods : {};
    const tidySeries = mods.tidySeries && typeof mods.tidySeries === "object" ? mods.tidySeries : {};
    if (typeof tidySeries.enableStackColor === "boolean") {
      CONFIG.enableStackColor = tidySeries.enableStackColor;
    }
  }

  async function loadModSettings() {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(".askonpage", { create: true });
      const fileHandle = await dir.getFileHandle("config.json", { create: false });
      const file = await fileHandle.getFile();
      applyModSettings(JSON.parse(await file.text()));
    } catch (_error) {}
  }

  loadModSettings();
  window.addEventListener("vivaldi-mod-config-updated", (event) => {
    applyModSettings(event.detail || {});
  });

  const SELECTORS = {
    TAB_STRIP: ".tab-strip",
    SEPARATOR: ".tab-strip .separator",
    TAB_WRAPPER: ".tab-wrapper",
    TAB_POSITION: ".tab-position",
    STACK_COUNTER: ".stack-counter",
    TAB_STACK: ".svg-tab-stack",
    SUBSTACK: ".tab-position.is-substack, .tab-position.is-stack",
    ACTIVE: ".active",
  };

  const CLASSES = {
    TIDY_BUTTON: "tidy-tabs-below-button",
    CLEAR_BUTTON: "clear-tabs-below-button",
    LOADING: "tidy-loading",
    PINNED: "is-pinned",
    SUBSTACK: "is-substack",
  };

  const LANGUAGE_MAP = {
    zh: "Chinese",
    "zh-CN": "Chinese",
    "zh-TW": "Chinese",
    en: "English",
    "en-US": "English",
    "en-GB": "English",
    ja: "Japanese",
    "ja-JP": "Japanese",
    ko: "Korean",
    "ko-KR": "Korean",
    es: "Spanish",
    fr: "French",
    de: "German",
    ru: "Russian",
    pt: "Portuguese",
    it: "Italian",
    ar: "Arabic",
    hi: "Hindi",
  };

  const OTHERS_NAMES = [
    "其它", "Others", "その他", "Other",
    "Outros", "Andere", "Autres", "Autre",
    "Altri", "Другое", "다른", "أخرى", "अन्य",
  ];

  const OTHERS_MAP = {
    Chinese: "其它",
    Japanese: "その他",
    English: "Others",
    Korean: "다른",
    Spanish: "Otros",
    French: "Autres",
    German: "Andere",
    Russian: "Другое",
    Portuguese: "Outros",
    Italian: "Altri",
    Arabic: "أخرى",
    Hindi: "अन्य",
  };

  const SUGGESTED_CLOSE_MAP = {
    Chinese: "Close Me",
    Japanese: "Close Me",
    English: "Close Me",
    French: "Close Me",
    German: "Close Me",
    Spanish: "Close Me",
    Italian: "Close Me",
  };

  const SUGGESTED_PIN_MAP = {
    Chinese: "Pin Me",
    Japanese: "Pin Me",
    English: "Pin Me",
    French: "Pin Me",
    German: "Pin Me",
    Spanish: "Pin Me",
    Italian: "Pin Me",
  };

  const SUGGESTED_CLOSE_NAMES = Object.values(SUGGESTED_CLOSE_MAP);
  const SUGGESTED_PIN_NAMES = Object.values(SUGGESTED_PIN_MAP);

  const getSuggestedCloseName = () => {
    const lang = getLanguageName(getBrowserLanguage());
    return SUGGESTED_CLOSE_MAP[lang] || "Close Me";
  };

  const getSuggestedPinName = () => {
    const lang = getLanguageName(getBrowserLanguage());
    return SUGGESTED_PIN_MAP[lang] || "Pin Me";
  };

  const isSpecialCategory = (name) =>
    SUGGESTED_CLOSE_NAMES.includes(name) || SUGGESTED_PIN_NAMES.includes(name) || OTHERS_NAMES.includes(name);

  const debugLog = (...args) => { if (CONFIG.debug) console.log(...args); };
  const debugWarn = (...args) => { if (CONFIG.debug) console.warn(...args); };

  let debounceTimer = null;
  const processingSeparators = new Set();
  const TIDY_TABS_STACK_OWNER = "TidyTabs";

  // ==================== Utility Functions ====================

  const parseVivExtData = (tab) => {
    if (!tab?.vivExtData) return {};
    if (typeof tab.vivExtData === "string") {
      try { return JSON.parse(tab.vivExtData); } catch (_) { return {}; }
    }
    return tab.vivExtData;
  };

  const getBrowserLanguage = () =>
    chrome.i18n?.getUILanguage?.() || navigator.language || "zh-CN";

  const getLanguageName = (langCode) =>
    LANGUAGE_MAP[langCode] || LANGUAGE_MAP[langCode.split("-")[0]] || "English";

  const getOthersName = () => {
    const lang = getLanguageName(getBrowserLanguage());
    return OTHERS_MAP[lang] || "Others";
  };

  // ==================== Tab Scoring for "Suggested to Close" ====================

  const CLOSE_SCORE = {
    DISCARDED: 15,
    IDLE_24H: 25,
    NO_STACK: 5,
    AUDIBLE: -30,
    ACTIVE: -50,
  };
  const CLOSE_THRESHOLD = 25;

  const SEARCH_URL_PATTERNS = [
    /google\.[a-z.]+\/search/i,
    /baidu\.com\/s\b/i,
    /bing\.com\/search/i,
    /duckduckgo\.com\/\?q=/i,
    /yahoo\.com\/search/i,
    /yandex\.[a-z]+\/search/i,
    /sogou\.com\/web/i,
    /so\.com\/s\b/i,
    /zhihu\.com\/search/i,
    /bilibili\.com\/search/i,
    /youtube\.com\/results/i,
    /github\.com\/search/i,
    /stackoverflow\.com\/search/i,
  ];

  const isSearchResultPage = (url) => {
    if (!url) return false;
    return SEARCH_URL_PATTERNS.some((p) => p.test(url));
  };

  // ── Tab age tracking via OPFS ──────────────────────────────────────────

  const TAB_AGE_FILE = "tabAge.json";

  const loadTabAgeData = async () => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(".askonpage", { create: true });
      const fh = await dir.getFileHandle(TAB_AGE_FILE, { create: true });
      const file = await fh.getFile();
      const text = await file.text();
      return text ? JSON.parse(text) : {};
    } catch (_) { return {}; }
  };

  const saveTabAgeData = async (data) => {
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle(".askonpage", { create: true });
      const fh = await dir.getFileHandle(TAB_AGE_FILE, { create: true });
      const writable = await fh.createWritable();
      await writable.write(JSON.stringify(data));
      await writable.close();
    } catch (_) { /* non-critical */ }
  };

  // Record current activation time for open tabs (call periodically)
  const recordTabActivation = async () => {
    try {
      const tabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
      const data = await loadTabAgeData();
      const now = Date.now();
      let changed = false;
      for (const tab of tabs) {
        if (tab.id < 0 || !tab.url || tab.pinned) continue;
        const key = String(tab.id);
        if (!data[key]) { data[key] = { created: now, lastActive: now, activationCount: 0, totalActiveMs: 0 }; changed = true; }
      }
      if (changed) await saveTabAgeData(data);
    } catch (_) { /* non-critical */ }
  };

  let currentActiveTabId = null;
  let currentActiveSince = null;

  const updateTabActiveTime = async (tabId, isActivating = true) => {
    try {
      const data = await loadTabAgeData();
      const key = String(tabId);
      const now = Date.now();
      if (!data[key]) data[key] = { created: now, lastActive: now, activationCount: 0, totalActiveMs: 0 };
      if (isActivating) {
        data[key].activationCount = (data[key].activationCount || 0) + 1;
      }
      data[key].lastActive = now;
      await saveTabAgeData(data);
    } catch (_) { /* non-critical */ }
  };

  // Track active time: when switching away from a tab, record how long it was active
  const flushActiveTime = async () => {
    if (currentActiveTabId == null || currentActiveSince == null) return;
    const elapsed = Date.now() - currentActiveSince;
    if (elapsed < 1000) return; // ignore <1s
    try {
      const data = await loadTabAgeData();
      const key = String(currentActiveTabId);
      if (!data[key]) data[key] = { created: Date.now(), lastActive: Date.now(), activationCount: 0, totalActiveMs: 0 };
      data[key].totalActiveMs = (data[key].totalActiveMs || 0) + elapsed;
      await saveTabAgeData(data);
    } catch (_) { /* non-critical */ }
  };

  chrome.tabs?.onActivated?.addListener(async (activeInfo) => {
    if (activeInfo.tabId && activeInfo.tabId !== -1) {
      await flushActiveTime();
      currentActiveTabId = activeInfo.tabId;
      currentActiveSince = Date.now();
      updateTabActiveTime(activeInfo.tabId, true);
    }
  });

  // ── Score a single tab ──────────────────────────────────────────────────

  const scoreTab = (tab, allTabs, stacksMap, ageData) => {
    if (!tab || tab.pinned) return -999; // pinned tabs excluded
    let score = 0;
    const reasons = [];

    // Positive signals
    if (tab.discarded) { score += CLOSE_SCORE.DISCARDED; reasons.push("discarded"); }

    const key = String(tab.id);
    const age = ageData[key];
    const idleMs = age ? Date.now() - age.lastActive : 0;
    if (idleMs > 24 * 60 * 60 * 1000) { score += CLOSE_SCORE.IDLE_24H; reasons.push("idle>24h"); }

    if (!stacksMap.has(tab.id)) { score += CLOSE_SCORE.NO_STACK; reasons.push("noStack"); }

    // Negative signals (only subtract, never add for absence)
    if (tab.audible) { score += CLOSE_SCORE.AUDIBLE; reasons.push("audible"); }
    if (tab.active) { score += CLOSE_SCORE.ACTIVE; reasons.push("active"); }

    return { score, reasons };
  };
  // ── Build a map of tabId → stackId for all tabs ────────────────────────

  const buildStackMap = (allTabs) => {
    const map = new Map();
    for (const tab of allTabs) {
      try {
        const viv = typeof tab.vivExtData === "string" ? JSON.parse(tab.vivExtData) : (tab.vivExtData || {});
        if (viv.group) map.set(tab.id, viv.group);
      } catch (_) { /* skip */ }
    }
    return map;
  };

  const findSuggestedCloseTabs = async (tabs) => {
    const allTabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
    const stacksMap = buildStackMap(allTabs);
    const ageData = await loadTabAgeData();
    const scored = tabs.map((tab) => ({ tab, ...scoreTab(tab, allTabs, stacksMap, ageData) }));
    const closeTabs = new Set();

    // 1. Hard-close: search result pages — no scoring needed
    for (const s of scored) {
      if (isSearchResultPage(s.tab.url)) {
        closeTabs.add(s.tab);
      }
    }
    if (closeTabs.size > 0) {
      console.log("[TidyTabs] [scoring] Hard-close search results:", [...closeTabs].map(t => t.id));
    }

    // 2. Hard-close: tabs older than 7 days
    for (const s of scored) {
      if (closeTabs.has(s.tab)) continue;
      const key = String(s.tab.id);
      const createdMs = ageData[key] ? Date.now() - ageData[key].created : 0;
      if (createdMs > 7 * 24 * 60 * 60 * 1000) {
        closeTabs.add(s.tab);
      }
    }
    if (closeTabs.size > 0) {
      console.log("[TidyTabs] [scoring] Hard-close age>7d:", [...closeTabs].filter(t => !isSearchResultPage(t.url)).map(t => t.id));
    }

    // 3. Hard-close: duplicate URLs — keep the best one (most recently active), close the rest
    const urlGroups = new Map();
    for (const s of scored) {
      if (closeTabs.has(s.tab)) continue; // already hard-closed
      const url = s.tab.url;
      if (!url) continue;
      if (!urlGroups.has(url)) urlGroups.set(url, []);
      urlGroups.get(url).push(s);
    }
    for (const [, group] of urlGroups) {
      if (group.length < 2) continue;
      // Sort by: not discarded first, then most recently active
      group.sort((a, b) => {
        if (a.tab.discarded !== b.tab.discarded) return a.tab.discarded ? 1 : -1;
        const aActive = (ageData[String(a.tab.id)]?.lastActive) || 0;
        const bActive = (ageData[String(b.tab.id)]?.lastActive) || 0;
        return bActive - aActive; // most recent first
      });
      // Keep the first (best) one, close the rest
      for (let i = 1; i < group.length; i++) {
        closeTabs.add(group[i].tab);
      }
      console.log("[TidyTabs] [scoring] Duplicate URL — keeping tab", group[0].tab.id, "closing", group.length - 1, "duplicates");
    }

    // 4. Score-based: remaining tabs above threshold
    for (const s of scored) {
      if (closeTabs.has(s.tab)) continue;
      if (s.score >= CLOSE_THRESHOLD) {
        closeTabs.add(s.tab);
      }
    }

    const result = [...closeTabs];
    if (result.length > 0) {
      const details = result.map((t) => {
        const s = scored.find((x) => x.tab.id === t.id);
        return { id: t.id, score: s?.score, reasons: s?.reasons };
      });
      console.log("[TidyTabs] [scoring] Suggested close tabs:", details);
    }
    return result;
  };

  // ── Behavior-based "Suggested to Pin" scoring ──────────────────────────

  const PIN_SCORE = {
    HIGH_ACTIVATION: 25,  // Activated many times
    LONG_ACTIVE_TIME: 20, // Spent significant time on this tab
    OLD_AGE: 15,          // Tab created long ago, never closed
    FREQUENT_URL: 5,      // URL also appears frequently in history (weak signal)
  };
  const PIN_THRESHOLD = 35;

  const scoreTabForPin = (tab, ageData, frequentUrls) => {
    if (!tab || tab.pinned) return { score: -999, reasons: [] };
    let score = 0;
    const reasons = [];

    // 1. Activation count
    const key = String(tab.id);
    const age = ageData[key];
    const activations = age?.activationCount || 0;
    if (activations >= 10) { score += PIN_SCORE.HIGH_ACTIVATION; reasons.push("activations:" + activations); }

    // 2. Total active time
    const activeMs = age?.totalActiveMs || 0;
    if (activeMs > 30 * 60 * 1000) { score += PIN_SCORE.LONG_ACTIVE_TIME; reasons.push("activeTime>30m"); }

    // 3. Tab age (always open, never closed)
    const createdMs = age ? Date.now() - age.created : 0;
    if (createdMs > 14 * 24 * 60 * 60 * 1000) { score += PIN_SCORE.OLD_AGE; reasons.push("age>14d"); }

    // 4. Frequent URL (weak auxiliary signal)
    if (frequentUrls?.length) {
      const urlSet = new Set(frequentUrls);
      try { if (urlSet.has(new URL(tab.url).href)) { score += PIN_SCORE.FREQUENT_URL; reasons.push("frequentUrl"); } }
      catch (_) { /* skip */ }
    }

    return { score, reasons };
  };

  // Weak auxiliary signal — frequent URLs from history
  const getFrequentUrls = async (minVisits = 8, daysBack = 14) => {
    try {
      if (!vivaldi?.historyPrivate?.visitSearch) return [];
      const now = Date.now();
      const startTime = now - daysBack * 24 * 60 * 60 * 1000;
      const historyItems = await new Promise((resolve) => {
        vivaldi.historyPrivate.visitSearch({ startTime, endTime: now }, (result) => {
          resolve(chrome.runtime.lastError ? [] : (result || []));
        });
      }).catch(() => []);
      if (!historyItems?.length) return [];
      const count = {};
      for (const item of historyItems) {
        if (!item.url) continue;
        count[item.url] = (count[item.url] || 0) + 1;
      }
      return Object.entries(count)
        .filter(([, c]) => c >= minVisits)
        .map(([url]) => url);
    } catch (_) { return []; }
  };

  const findSuggestedPinTabs = async (tabs, ageData, frequentUrls) => {
    // Collect domains of already-pinned tabs
    const allTabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
    const pinnedDomains = new Set();
    for (const tab of allTabs) {
      if (tab.pinned && tab.url) {
        try { pinnedDomains.add(new URL(tab.url).hostname); } catch (_) {}
      }
    }
    if (pinnedDomains.size > 0) {
      console.log("[TidyTabs] [scoring] Pinned domains:", [...pinnedDomains]);
    }

    // Filter out tabs whose domain is already pinned
    const candidateTabs = tabs.filter((tab) => {
      if (!tab.url) return true;
      try {
        const domain = new URL(tab.url).hostname;
        if (pinnedDomains.has(domain)) return false;
      } catch (_) {}
      return true;
    });

    const scored = candidateTabs.map((tab) => ({ tab, ...scoreTabForPin(tab, ageData, frequentUrls) }));
    const qualifying = scored.filter((s) => s.score >= PIN_THRESHOLD);

    // Deduplicate by domain: keep only the best tab per domain
    const domainGroups = new Map();
    for (const s of qualifying) {
      let domain = "";
      try { domain = new URL(s.tab.url).hostname; } catch (_) { domain = s.tab.url || ""; }
      if (!domainGroups.has(domain)) domainGroups.set(domain, []);
      domainGroups.get(domain).push(s);
    }
    const deduped = [];
    for (const [domain, group] of domainGroups) {
      if (group.length > 1) {
        // Keep highest score; tie-break by most recent activation
        group.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const aActive = (ageData[String(a.tab.id)]?.lastActive) || 0;
          const bActive = (ageData[String(b.tab.id)]?.lastActive) || 0;
          return bActive - aActive;
        });
        console.log("[TidyTabs] [scoring] Pin domain dedup — keeping tab", group[0].tab.id, "dropping", group.length - 1, "duplicate(s) of", domain);
      }
      deduped.push(group[0]);
    }

    if (deduped.length > 0) {
      console.log("[TidyTabs] [scoring] Suggested pin tabs:", deduped.map((s) => ({ id: s.tab.id, score: s.score, reasons: s.reasons })));
    }
    return deduped.map((s) => s.tab);
  };

  const getUrlFragments = (url) => {
    try {
      if (vivaldi?.utilities?.getUrlFragments)
        return vivaldi.utilities.getUrlFragments(url);
    } catch (e) {
      /* fallback */
    }
    try {
      const u = new URL(url);
      const parts = u.hostname.split(".");
      return {
        hostForSecurityDisplay: u.hostname,
        tld: parts.length > 1 ? parts[parts.length - 1] : "",
      };
    } catch (e) {
      return { hostForSecurityDisplay: "", tld: "" };
    }
  };

  const getBaseDomain = (url) => {
    const { hostForSecurityDisplay, tld } = getUrlFragments(url);
    const match = hostForSecurityDisplay.match(`([^.]+\\.${tld})$`);
    return match ? match[1] : hostForSecurityDisplay;
  };

  const getHostname = (url) => getUrlFragments(url).hostForSecurityDisplay;

  const getTabStrip = () => document.querySelector(SELECTORS.TAB_STRIP);

  const getSeparatorIndex = (separator) => {
    const tabStrip = separator?.closest(SELECTORS.TAB_STRIP);
    if (!tabStrip) return -1;
    return Array.from(tabStrip.querySelectorAll(":scope > .separator")).indexOf(
      separator
    );
  };

  const getSeparatorKey = (separator) => {
    // Prefer stable dataset key (survives index shifts from tab add/remove)
    if (separator?.dataset?.tidyKey) return separator.dataset.tidyKey;
    // Fallback to index-based key (for separators not yet assigned a tidy key)
    const tabStrip = separator?.closest(SELECTORS.TAB_STRIP);
    const index = getSeparatorIndex(separator);
    if (!tabStrip || index < 0) return null;
    return `${tabStrip.getAttribute("aria-owns") || ""}::${index}`;
  };

  const findLiveSeparatorByKey = (key) => {
    if (!key) return null;
    // Fast path: search by dataset.tidyKey
    const byData = document.querySelector(`${SELECTORS.SEPARATOR}[data-tidy-key="${key}"]`);
    if (byData) return byData;
    // Fallback: index-based lookup (for keys created before this separator got a tidyKey)
    const [owned = "", indexRaw = "-1"] = String(key).split("::");
    const index = Number.parseInt(indexRaw, 10);
    if (!Number.isInteger(index) || index < 0) return null;
    const tabStrip = getTabStrip();
    if (!tabStrip) return null;
    const currentOwned = tabStrip.getAttribute("aria-owns") || "";
    if (owned && currentOwned && owned !== currentOwned) return null;
    return tabStrip.querySelectorAll(":scope > .separator")[index] || null;
  };

  const setSeparatorLoadingState = (key, loading) => {
    if (!key) return;
    const separator = findLiveSeparatorByKey(key);
    if (!separator) return;
    separator.classList.toggle(CLASSES.LOADING, loading);
  };

  const reapplyLoadingStates = () => {
    for (const key of processingSeparators) {
      let separator = findLiveSeparatorByKey(key);
      if (!separator) {
        // Tab-strip was rebuilt (e.g. auto-hide toggle) — transfer key to a new separator
        const allSeps = document.querySelectorAll(SELECTORS.SEPARATOR);
        for (const sep of allSeps) {
          if (!sep.dataset.tidyKey) { separator = sep; break; }
        }
        if (separator) {
          separator.dataset.tidyKey = key;
          console.log("[TidyTabs] [recovery] Transferred tidy key to rebuilt separator:", key);
        }
      }
      if (separator) separator.classList.add(CLASSES.LOADING);
    }
  };

  const getTab = (tabId) =>
    new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        if (tab.vivExtData) {
          try {
            tab.vivExtData = JSON.parse(tab.vivExtData);
          } catch (e) {
            /* ignore */
          }
        }
        resolve(tab);
      });
    });

  const getWorkspaceName = (workspaceId) => {
    if (!workspaceId) return Promise.resolve("<default_workspace>");
    return new Promise((resolve) => {
      if (vivaldi?.prefs) {
        vivaldi.prefs.get("vivaldi.workspaces.list", (list) => {
          const ws = list.find((w) => w.id === workspaceId);
          resolve(ws ? ws.name : "<unknown_workspace>");
        });
      } else resolve("<unknown_workspace>");
    });
  };

  const isAutoStackAllowed = async (workspaceId) => {
    if (CONFIG.autoStackWorkspaces.length === 0) return false;
    return CONFIG.autoStackWorkspaces.includes(
      await getWorkspaceName(workspaceId)
    );
  };

  const getTabsByWorkspace = (workspaceId) =>
    new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, async (tabs) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        const valid = [];
        for (const tab of tabs) {
          if (tab.id === -1 || !tab.vivExtData) continue;
          try {
            const viv = JSON.parse(tab.vivExtData);
            if (
              viv.workspaceId === workspaceId &&
              !tab.pinned &&
              !viv.panelId
            ) {
              valid.push({ ...tab, vivExtData: viv });
            }
          } catch (e) {
            /* skip */
          }
        }
        resolve(valid);
      });
    });

  const STACK_COLORS = Array.from({ length: 9 }, (_, i) => `color${i + 1}`);
  const COLOR_WEIGHTS = { color2: 3, color5: 3, color8: 3 };
  const RESTRICTED = new Set(["color3", "color6", "color4", "color9", "color7"]);
  let lastAssignedColor = "";

  const randomStackColor = (overrideLast) => {
    const last = overrideLast || lastAssignedColor;
    const candidates = STACK_COLORS.filter(c => {
      if (!last || !RESTRICTED.has(last)) return true;
      return !RESTRICTED.has(c);
    });
    const weighted = candidates.flatMap(c => Array(COLOR_WEIGHTS[c] || 1).fill(c));
    const pick = weighted[Math.floor(Math.random() * weighted.length)] || candidates[0];
    lastAssignedColor = pick;
    return pick;
  };



  const updateTabProperties = async (tabId, fields) => {
    // 1. Keep compatibility metadata written via standard chrome.tabs.update
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resolve();
          return;
        }
        let viv = {};
        try {
          viv = typeof tab.vivExtData === "string" ? JSON.parse(tab.vivExtData) : (tab.vivExtData || {});
        } catch (e) { console.warn("[TidyTabs] Failed to parse vivExtData:", e); }

        Object.assign(viv, fields);
        
        chrome.tabs.update(tabId, { vivExtData: JSON.stringify(viv) }, () => {
          if (chrome.runtime.lastError) {
            console.error("[TidyTabs] [chrome.tabs.update] Error:", chrome.runtime.lastError.message);
          } else {
            debugLog(`[TidyTabs] [updateTabProperties] Updated tabId=${tabId}`);
          }
          resolve();
        });
      });
    });
  };

  const addTabToStack = async (tabId, stackId, stackName, stackColor, parentExtId) => {
    debugLog(`[TidyTabs] [addTabToStack] tabId=${tabId}, stackId=${stackId}, stackName="${stackName}"`);
    
    const freshTab = await getTab(tabId);
    let viv = {};
    if (freshTab?.vivExtData) {
      viv = typeof freshTab.vivExtData === "string" ? JSON.parse(freshTab.vivExtData) : freshTab.vivExtData;
    }
    
    const extId = viv.ext_id || crypto.randomUUID();
    
    const fields = {
      ext_id: extId,
      group: stackId,
      tidyStackOwner: TIDY_TABS_STACK_OWNER,
      tidyStackId: stackId
    };
    if (stackName) fields.fixedGroupTitle = stackName;
    if (stackColor) fields.groupColor = stackColor;
    if (parentExtId) {
      fields.parent_ext_id = parentExtId;
    } else {
      fields.parent_ext_id = null;
    }
    
    await updateTabProperties(tabId, fields);
    
    const verifyTab = await getTab(tabId);
    debugLog(`[TidyTabs] [addTabToStack] Verified tabId=${tabId}`);
    
    return extId;
  };

  const showToast = (message, options = {}) => {
    window.VModToast?.show(message, { module: "TidyTabs", ...options });
  };

  const truncateTitle = (title, maxLen = 30) => {
    if (!title) return "Untitled";
    return title.length > maxLen ? title.slice(0, maxLen) + "…" : title;
  };

  const openSettings = () => {
    chrome.tabs.query({ url: "vivaldi://settings/*" }, (tabs) => {
      if (tabs?.length) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        window.location.assign("vivaldi://settings/?path=appearance");
      }
    });
  };

  // ==================== Existing Stack Detection ====================

  // Detect named stacks (user set a title) from a set of tabs
  const detectNamedStacks = (tabs) => {
    const stacksMap = new Map();
    for (const tab of tabs) {
      let viv;
      try { viv = typeof tab.vivExtData === "string" ? JSON.parse(tab.vivExtData) : (tab.vivExtData || {}); } catch (_) { continue; }
      if (!viv.group) continue;
      if (!stacksMap.has(viv.group)) {
        stacksMap.set(viv.group, {
          id: viv.group,
          name: viv.fixedGroupTitle || null,
          tabIds: [],
        });
      }
      stacksMap.get(viv.group).tabIds.push(tab.id);
    }
    return [...stacksMap.values()].filter((s) => s.name && s.tabIds.length >= 2);
  };

  // Find unnamed stack group IDs (stacks without a custom title)
  const findUnnamedStackIds = (tabs) => {
    const stackInfo = new Map();
    for (const tab of tabs) {
      let viv;
      try { viv = typeof tab.vivExtData === "string" ? JSON.parse(tab.vivExtData) : (tab.vivExtData || {}); } catch (_) { continue; }
      if (!viv.group) continue;
      if (!stackInfo.has(viv.group)) {
        stackInfo.set(viv.group, { named: !!viv.fixedGroupTitle, count: 0 });
      }
      stackInfo.get(viv.group).count++;
    }
    return [...stackInfo.entries()]
      .filter(([, info]) => !info.named && info.count >= 2)
      .map(([id]) => id);
  };

  // Dismantle an unnamed stack, returning its tabs back to the pool
  const dismantleStack = async (groupId) => {
    // Collect tab IDs BEFORE dismantling
    const allTabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
    const stackTabIds = allTabs.filter((t) => {
      try {
        const viv = typeof t.vivExtData === "string" ? JSON.parse(t.vivExtData) : (t.vivExtData || {});
        return viv.group === groupId;
      } catch (_) { return false; }
    }).map((t) => t.id);

    if (stackTabIds.length < 2) return stackTabIds;

    await _unstackGroup(groupId);
    console.log("[TidyTabs] Dismantled unnamed stack:", groupId.slice(0, 8), "→", stackTabIds.length, "tabs freed");
    return stackTabIds;
  };

  // Strip site-name suffixes from tab titles (e.g. "Page Title - YouTube" → "Page Title")
  const cleanTabTitle = (title) => {
    if (!title) return "";
    let s = title
      // Known site names after separator (- – — | · _ » /) — run twice for chained suffixes like "_哔哩哔哩_bilibili"
      .replace(/\s*[-–—|·_/»]\s*(YouTube|(?:哔哩哔哩|bilibili)(?:视频)?|X(?:\.com|\s*\(Twitter\))?(?:\s*[-–—|·_/»]\s*\w+)*|GitHub|知乎|CSDN|掘金|百度|Google|Reddit|Stack\s*Overflow|nhentai|LINUX\s*DO|AI\s*HOT|Claude|DeepWiki)\s*$/i, "")
      .replace(/\s*[-–—|·_/»]\s*(YouTube|(?:哔哩哔哩|bilibili)(?:视频)?|X(?:\.com|\s*\(Twitter\))?(?:\s*[-–—|·_/»]\s*\w+)*|GitHub|知乎|CSDN|掘金|百度|Google|Reddit|Stack\s*Overflow|nhentai|LINUX\s*DO|AI\s*HOT|Claude|DeepWiki)\s*$/i, "")
      // " - Page N" suffix (nhentai etc.)
      .replace(/\s*[-–—]\s*Page\s*\d*\s*$/i, "")
      // Generic site suffix: - site.tld
      .replace(/\s*[-–—|·_/»]\s*[\w.-]+\.(com|net|org|io|ai|do|sh|top|app|ski)\s*$/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return s.length > 60 ? s.slice(0, 60) : s;
  };

  const buildAIPrompt = (tabs, existingStacks, languageName) => {
    const chromeIdToIndex = {};
    tabs.forEach((tab, i) => { chromeIdToIndex[tab.id] = i; });

    const tabsInfo = tabs.map((tab, i) => ({
      id: i,
      title: cleanTabTitle(tab.title) || "Untitled",
      domain: getHostname(tab.url),
      openerIndex: tab.openerTabId != null ? chromeIdToIndex[tab.openerTabId] : undefined,
    }));

    const tabLines = tabsInfo.map((t) => {
      let line = `${t.domain}/${t.id}: ${t.title}`;
      if (t.openerIndex !== undefined) {
        const opener = tabsInfo[t.openerIndex];
        if (opener) line = `${line}\n  \u21b3 ${opener.domain}/${opener.id}`;
      }
      return line;
    }).join("\n");

    const othersName = getOthersName();
    const maxGroups = Math.max(2, Math.min(Math.ceil(Math.sqrt(tabs.length)), tabs.length));

    let prompt = `<rules>You are a meticulous research librarian organizing browser tabs into themed clusters. Your goal: discover the specific research topics or work threads that connect these tabs, then name each cluster precisely.

INPUT FORMAT: Each line is "domain/N: title ↦ parent_domain/M" (the /N is the tab_id for output).

THINKING PROCESS (do this internally before outputting JSON):
1. Read ALL tab titles carefully. Identify concrete themes from the TITLE CONTENT — what is the user actually researching or working on? NEVER group tabs solely by website domain. Tabs from the same site can belong to completely different groups based on their content.
2. Each group name in ${languageName}: an action verb + the specific topic, 2-3 words. Think "what is the user DOING with these tabs?" — NOT "what category are these tabs?" NOT "what website are these tabs from?"
3. Groups must be THEMATICALLY DISTINCT: if two group names could appear in the same sentence naturally, they should be merged.
4. Prefer 2-${maxGroups} groups. Fewer groups = each group is too broad. More groups = you're splitting hairs.
5. A group can have as few as 1 tab if that tab doesn't fit anywhere else, but prefer ≥2 tabs per group.
6. You MUST include a "${othersName}" group. Put tabs here when: (a) the tab's title/URL gives no clear clue about its content, (b) it doesn't fit any other theme, (c) you would be guessing to assign it. "${othersName}" is better than a wrong guess.

CRITICAL: The BAD/GOOD naming rules below apply to ALL languages, not just English. Your ${languageName} names must follow the same principles.

BAD names — static category nouns, compound phrases with & / 与 / 和, generic labels, or website-as-group:
  "Technology", "Programming & Tools", "AI Applications & News", "B站视频", "Linux论坛", "阅读与写作", "GitHub项目"
GOOD names — verb + specific topic (reads like a task, not a folder label):
  "研究Kimi K3模型", "对比DeepSeek与Grok", "阅读Vibe Coding教程", "浏览乒乓球比赛数据", "调试逆向工程工具"
  The examples above show the PRINCIPLE — adapt to the actual tab content in ${languageName}.
</rules>`;

    if (existingStacks?.length > 0) {
      prompt += `\n<stacks>The user already has named stacks. If ungrouped tabs fit an existing stack's theme, add them there (use the exact same name). Do NOT create new stacks with these names:\n${existingStacks.map(s => `- "${s.name}": tab_ids [${s.existingTabIds.join(",")}]`).join("\n")}</stacks>`;
    } else {
      prompt += `\n<stacks>No existing stacks — start fresh. Ignore any previous stack membership.</stacks>`;
    }

    prompt += `\n<tabs>\n${tabLines}\n</tabs>
<output>Return json strictly, no explanation:
{"groups":[{"name":"Specific Topic Name","tab_ids":[0,1,2]},{"name":"${othersName}","tab_ids":[3]}]}
tab_ids = the number after domain/ (e.g. google.com/3 → 3). Each tab in exactly one group.</output>`;
    return prompt;
  };

  const parseAIResponse = (content) => {
    let s = content.trim();
    if (!s) {
      console.warn("[TidyTabs] [AI] parseAIResponse: empty content");
      return null;
    }
    const m = s.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (m) s = m[1].trim();
    const first = s.indexOf("{"),
      last = s.lastIndexOf("}");
    if (first !== -1 && last !== -1) s = s.substring(first, last + 1);
    try {
      const parsed = JSON.parse(s);
      console.log("[TidyTabs] [AI] parseAIResponse success — groups:", parsed.groups?.length, "keys:", Object.keys(parsed));
      return parsed;
    } catch (e) {
      console.error("[TidyTabs] [AI] JSON parse error:", e.message, "Content:", s.substring(0, 200));
      return null;
    }
  };

  const validateAIGroups = (result) => {
    if (!result?.groups || !Array.isArray(result.groups)) {
      console.warn("[TidyTabs] [AI] validateAIGroups failed: missing or invalid 'groups' array. result keys:", result ? Object.keys(result) : "null");
      return false;
    }
    const invalid = result.groups.filter(
      (g) => !g.name || typeof g.name !== "string" || !Array.isArray(g.tab_ids)
    );
    if (invalid.length > 0) {
      console.warn("[TidyTabs] [AI] validateAIGroups failed:", invalid.length, "invalid group(s):", JSON.stringify(invalid));
      return false;
    }
    console.log("[TidyTabs] [AI] validateAIGroups passed —", result.groups.length, "groups");
    return true;
  };

  const mapAIResultsToGroups = (aiResult, tabs, existingStacks) => {
    return aiResult.groups
      .map((group) => {
        const existing = existingStacks.find((s) => s.name === group.name);
        return {
          name: group.name,
          tabs: group.tab_ids.map((id) => tabs[id]).filter(Boolean),
          stackId: existing ? existing.id : crypto.randomUUID(),
          isExisting: !!existing,
        };
      })
      .filter((g) => g.isExisting || g.tabs.length > 1);
  };

  const handleOrphanTabs = (groupedTabs, tabs, existingStacks = []) => {
    const grouped = new Set();
    groupedTabs.forEach((g) => g.tabs.forEach((t) => grouped.add(t.id)));
    const orphans = tabs.filter((t) => !grouped.has(t.id));
    if (orphans.length === 0) return;

    let othersGroup = groupedTabs.find((g) => OTHERS_NAMES.includes(g.name));
    if (othersGroup) {
      othersGroup.tabs.push(...orphans);
    } else {
      const existing = existingStacks.find((s) =>
        OTHERS_NAMES.includes(s.name)
      );
      if (existing) {
        groupedTabs.push({
          name: existing.name,
          tabs: orphans,
          stackId: existing.id,
          isExisting: true,
        });
      } else if (orphans.length > 0) {
        groupedTabs.push({
          name: getOthersName(),
          tabs: orphans,
          stackId: crypto.randomUUID(),
          isExisting: false,
        });
      }
    }
  };


  const getAIGrouping = async (tabs, existingStacks = []) => {
    console.log("[TidyTabs] [AI] getAIGrouping called — tabs:", tabs.length, "existingStacks:", existingStacks.length, "apiKey configured:", !!VividAI.config.apiKey);

    if (!VividAI.config.apiKey) {
      console.warn("[TidyTabs] [AI] Skipped — no API key configured. Will fall back to domain grouping.");
      showToast("AI API key Unconfigured", {
        type: "error",
        button: { text: "Go to Settings", action: openSettings },
      });
      return null;
    }
    if (tabs.length > CONFIG.maxTabsForAI)
      tabs = tabs.slice(0, CONFIG.maxTabsForAI);

    const languageName = getLanguageName(getBrowserLanguage());

    try {
      const promptText = buildAIPrompt(tabs, existingStacks, languageName);
      console.log("[TidyTabs] [AI] Raw request (%d chars):", promptText.length, promptText);

      console.log("[TidyTabs] [AI] Sending request...");
      const data = await VividAI.fetchJSON({
        messages: [
          {
            role: "user",
            content: promptText,
          },
        ],
        temperature: VividAI.config.temperature,
        maxTokens: VividAI.config.maxTokens,
        timeout: VividAI.config.timeout,
        extra: { response_format: { type: "json_object" }, thinking: { type: "disabled" } },
      });

      console.log("[TidyTabs] [AI] Response received");

      if (data?.error) throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);

      const msg = data.choices?.[0]?.message || {};
      // Try content first, then reasoning_content (DeepSeek reasoning models put output there),
      // then check if content was cut off (finish_reason === "length" means max_tokens exceeded)
      let raw = msg.content || "";
      if (!raw && msg.reasoning_content) {
        console.log("[TidyTabs] [AI] content is empty, attempting to extract JSON from reasoning_content");
        raw = msg.reasoning_content;
      }
      if (!raw) {
        console.warn("[TidyTabs] [AI] Both content and reasoning_content are empty. finish_reason:", data.choices?.[0]?.finish_reason, "usage:", JSON.stringify(data.usage));
        // If model hit token limit, the JSON was never generated — return null to fall back
        return null;
      }

      debugLog("[TidyTabs] [AI] Raw output (first 500 chars):", raw.substring(0, 500));
      debugLog("[TidyTabs] [AI] finish_reason:", data.choices?.[0]?.finish_reason, "completion_tokens:", data.usage?.completion_tokens);
      const cleaned = raw.replace(/<(thought|reasoning)>[\s\S]*?<\/\1>/gi, "").trim();
      const result = parseAIResponse(cleaned);
      debugLog("[TidyTabs] [AI] Parsed result:", JSON.stringify(result));
      if (!result) {
        console.warn("[TidyTabs] [AI] parseAIResponse returned null. Will fall back to domain grouping.");
        return null;
      }
      if (!validateAIGroups(result)) {
        console.warn("[TidyTabs] [AI] validateAIGroups failed. Result structure:", JSON.stringify(result));
        return null;
      }

      const groups = mapAIResultsToGroups(result, tabs, existingStacks);
      debugLog("[TidyTabs] [AI] Mapped groups:", groups.map(g => ({ name: g.name, tabCount: g.tabs.length, isExisting: g.isExisting })));
      handleOrphanTabs(groups, tabs, existingStacks);
      const final = groups.length > 0 ? groups : null;
      return final;
    } catch (error) {
      console.error("[TidyTabs] [AI] Error:", error.message);
      showToast(`AI call failed: ${error.message}`, {
        type: "error",
        copyText: error.message,
      });
      return null;
    }
  };

  const groupByDomain = (tabs) => {
    console.log("[TidyTabs] [fallback] groupByDomain called — grouping", tabs.length, "tabs by hostname only (no AI)");
    const byHost = {};
    tabs.forEach((tab) => {
      const host = getHostname(tab.url);
      (byHost[host] ||= []).push(tab);
    });
    const groups = Object.entries(byHost)
      .filter(([, t]) => t.length > 1)
      .map(([, t]) => {
        const base = getBaseDomain(t[0].url).split(".")[0];
        return {
          name: base.charAt(0).toUpperCase() + base.slice(1),
          tabs: t,
          stackId: crypto.randomUUID(),
          isExisting: false,
        };
      });
    console.log("[TidyTabs] [fallback] groupByDomain result:", groups.map(g => ({ name: g.name, tabCount: g.tabs.length })));
    return groups;
  };

  const generateStackName = async (tabs) => {
    const languageName = getLanguageName(getBrowserLanguage());
    const tabInfo = tabs.map((t, i) =>
      `${i + 1}. [${getHostname(t.url || "")}] ${t.title || "Untitled"}`
    ).join("\n");

    const prompt = `Name this browser tab group in 2-3 words. Must suggest an action or ongoing work — not a static category label. NO ampersand (&), slash, or connective symbols.
Language: ${languageName}.

BAD: static category nouns, compound phrases with & or /, generic labels
GOOD: "[verb] [specific topic]" e.g. "Organize AI Docs", "Research Grok API", "Browse Bilibili"
  (use natural ${languageName} phrasing)

Tabs:
${tabInfo}

Return JSON strictly in this format, with no markdown backticks: {"name":"the group name"}`;

    try {
      const data = await VividAI.fetchJSON({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        maxTokens: 128,
        timeout: VividAI.config.timeout,
        extra: { response_format: { type: "json_object" }, thinking: { type: "disabled" } },
      });

      if (data?.error) return null;

      const msg = data.choices?.[0]?.message || {};
      let raw = msg.content || "";
      if (!raw && msg.reasoning_content) raw = msg.reasoning_content;
      if (!raw) return null;

      const cleaned = raw.replace(/<(thought|reasoning)>[\s\S]*?<\/\1>/gi, "").trim();
      const m = cleaned.match(/\{[\s\S]*?\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        if (parsed.name && typeof parsed.name === "string") return parsed.name.trim();
      }
    } catch (e) {
      console.warn("[TidyTabs] Stack name generation failed:", e.message);
    }
    return null;
  };

  const renameUnnamedStacks = async () => {
    if (!VividAI.config.apiKey) return;

    const allTabs = await new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, resolve);
    });

    // Group tabs by their stack ID
    const stacksMap = {};
    for (const tab of allTabs) {
      if (!tab.vivExtData) continue;
      try {
        const viv = typeof tab.vivExtData === "string"
          ? JSON.parse(tab.vivExtData) : tab.vivExtData;
        if (viv.group && !tab.pinned && !viv.panelId) {
          if (!stacksMap[viv.group]) stacksMap[viv.group] = { tabs: [], hasName: false };
          stacksMap[viv.group].tabs.push(tab);
          if (viv.fixedGroupTitle) stacksMap[viv.group].hasName = true;
        }
      } catch (e) { console.warn("[TidyTabs] Failed to parse vivExtData:", e); }
    }

    // Rename stacks that have no fixedGroupTitle
    for (const [stackId, { tabs, hasName }] of Object.entries(stacksMap)) {
      if (hasName || tabs.length < 2) continue;

      const name = await generateStackName(tabs);
      if (!name) continue;

      for (const tab of tabs) {
        await updateTabProperties(tab.id, { fixedGroupTitle: name });
      }
      
      // Natively rename the tab stack in Vivaldi UI
      if (window.vivaldi?.tabsPrivate?.setGroupProperties) {
        try {
          await new Promise((resolve) => {
            window.vivaldi.tabsPrivate.setGroupProperties({ groupExtId: stackId, groupTitle: name }, () => {
              resolve();
            });
          });
        } catch (e) {
          console.warn("[TidyTabs] renameUnnamedStacks setGroupProperties threw:", e.message);
        }
      }

      console.log(`[TidyTabs] Named unnamed stack: "${name}" (${tabs.length} tabs)`);
    }
  };

  const colorUncoloredStacks = async () => {
    if (!CONFIG.enableStackColor) return;

    const allTabs = await new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, resolve);
    });

    const stacksMap = {};
    for (const tab of allTabs) {
      if (!tab.vivExtData) continue;
      try {
        const viv = typeof tab.vivExtData === "string"
          ? JSON.parse(tab.vivExtData) : tab.vivExtData;
        if (viv.group && !tab.pinned && !viv.panelId) {
          if (!stacksMap[viv.group]) stacksMap[viv.group] = { tabs: [], hasColor: false };
          stacksMap[viv.group].tabs.push(tab);
          if (viv.groupColor) stacksMap[viv.group].hasColor = true;
        }
      } catch (e) { console.warn("[TidyTabs] Failed to parse vivExtData:", e); }
    }

    for (const [stackId, { tabs, hasColor }] of Object.entries(stacksMap)) {
      if (hasColor || tabs.length < 2) continue;

      const color = randomStackColor();
      for (const tab of tabs) {
        await updateTabProperties(tab.id, { groupColor: color });
      }
      
      // Natively color the tab stack in Vivaldi UI
      if (window.vivaldi?.tabsPrivate?.setGroupProperties) {
        try {
          await new Promise((resolve) => {
            window.vivaldi.tabsPrivate.setGroupProperties({ groupExtId: stackId, groupColor: color }, () => {
              resolve();
            });
          });
        } catch (e) {
          console.warn("[TidyTabs] colorUncoloredStacks setGroupProperties threw:", e.message);
        }
      }

      console.log(`[TidyTabs] Colored stack ${stackId.slice(0, 8)}... → ${color}`);
    }
  };

  // Add tabs to an existing named stack (without recreating it)
  const addTabsToExistingStack = async (groupId, groupName, newTabs) => {
    if (!newTabs.length) return;
    // Get existing stack tabs to find target position
    const allTabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
    const existingTabs = allTabs.filter((t) => {
      try {
        const viv = typeof t.vivExtData === "string" ? JSON.parse(t.vivExtData) : (t.vivExtData || {});
        return viv.group === groupId;
      } catch (_) { return false; }
    });
    const targetTab = existingTabs[existingTabs.length - 1] || newTabs[0];
    if (!targetTab) return;

    // Move new tabs adjacent to the existing stack (right after the last tab)
    const targetIndex = targetTab.index;
    for (let i = 0; i < newTabs.length; i++) {
      await new Promise((resolve) => {
        chrome.tabs.move(newTabs[i].id, { index: targetIndex + 1 + i }, () => {
          if (chrome.runtime.lastError) console.warn("[TidyTabs] move failed:", chrome.runtime.lastError.message);
          resolve();
        });
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Re-group: move all tabs (existing + new) together to recreate the stack
    const allIds = [...existingTabs.map((t) => t.id), ...newTabs.map((t) => t.id)];
    const firstId = existingTabs[0]?.id || newTabs[0]?.id;
    if (vivaldi?.tabsPrivate?.move && allIds.length >= 2) {
      try {
        const newGroupId = await new Promise((resolve) => {
          const promiseOrVal = vivaldi.tabsPrivate.move({
            tabIds: allIds,
            target: firstId,
            tweaks: ["do-not-reparent", "create-new-group", "target-is-tab"],
            debug: "TidyTabs.addToExisting"
          }, (res) => resolve(chrome.runtime.lastError ? null : (res?.group || null)));
          if (promiseOrVal && typeof promiseOrVal.then === "function") {
            promiseOrVal.then((res) => resolve(res?.group || null));
          }
        });
        // Re-apply group properties if group was recreated
        if (newGroupId && groupName && vivaldi?.tabsPrivate?.setGroupProperties) {
          vivaldi.tabsPrivate.setGroupProperties({ groupExtId: String(newGroupId), groupTitle: groupName }, () => {});
        }
        // Update vivExtData for new tabs
        for (const tab of newTabs) {
          await updateTabProperties(tab.id, {
            group: newGroupId || groupId,
            fixedGroupTitle: groupName,
            tidyStackOwner: TIDY_TABS_STACK_OWNER,
            tidyStackId: newGroupId || groupId,
          });
        }
        console.log(`[TidyTabs] [stacks] Added ${newTabs.length} tabs to stack "${groupName}"`);
      } catch (e) {
        console.warn("[TidyTabs] [stacks] Failed to add tabs to existing stack:", e.message);
      }
    }
  };

  // ==================== Tab Stack Operations ====================

  const createTabStacks = async (groups) => {
    let lastColor = "";
    for (const group of groups) {
      const color = group.isExisting ? null : (CONFIG.enableStackColor ? randomStackColor(lastColor) : null);
      if (color) lastColor = color;
      group.tabs.sort((a, b) => a.index - b.index);
      const targetIndex = group.tabs[0].index;

      // 1. Move all tabs in this group to be adjacent first
      for (let i = 0; i < group.tabs.length; i++) {
        const tab = group.tabs[i];
        await new Promise((resolve) => {
          chrome.tabs.move(tab.id, { index: targetIndex + i }, () => {
            if (chrome.runtime.lastError)
              console.error("[TidyTabs]", chrome.runtime.lastError.message);
            resolve();
          });
        });
      }

      // 2. Wait for Vivaldi React UI to settle and process the moves
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 3. Group tabs natively using Vivaldi's private tabsPrivate.move stacking API
      const tabIds = group.tabs.map((t) => t.id);
      debugLog(`[TidyTabs] Grouping tabIds natively via tabsPrivate.move:`, JSON.stringify(tabIds));
      
      const vivaldiGroupId = await new Promise(async (resolve) => {
        try {
          const params = {
            tabIds: tabIds,
            target: tabIds[0],
            tweaks: ["do-not-reparent", "create-new-group", "target-is-tab"],
            debug: "TidyTabs.createTabStack"
          };
          
          const promiseOrVal = window.vivaldi.tabsPrivate.move(params, (res) => {
            if (chrome.runtime.lastError) {
              console.error("[TidyTabs] tabsPrivate.move callback error:", chrome.runtime.lastError.message);
              resolve(null);
            } else {
              console.log("[TidyTabs] tabsPrivate.move callback success, native group ID =", res?.group);
              resolve(res?.group || null);
            }
          });
          
          if (promiseOrVal && typeof promiseOrVal.then === "function") {
            const res = await promiseOrVal;
            console.log("[TidyTabs] tabsPrivate.move promise success, native group ID =", res?.group);
            resolve(res?.group || null);
          }
        } catch (err) {
          console.error("[TidyTabs] tabsPrivate.move exception:", err.message);
          resolve(null);
        }
      });

      // 4. Update the tabs metadata (ext_id, parent_ext_id, tidyStackOwner, etc.) for compatibility with custom scripts
      if (vivaldiGroupId !== null) {
        // Set group title and color natively via vivaldi.tabsPrivate.setGroupProperties
        if (window.vivaldi?.tabsPrivate?.setGroupProperties) {
          try {
            await new Promise((resolve) => {
              const gIdStr = String(vivaldiGroupId);
              window.vivaldi.tabsPrivate.setGroupProperties({ groupExtId: gIdStr, groupTitle: group.name }, () => {
                if (chrome.runtime.lastError) {
                  console.warn("[TidyTabs] Native setGroupProperties for title failed:", chrome.runtime.lastError.message);
                } else {
                  console.log("[TidyTabs] Native group title set successfully:", group.name);
                }
                if (color) {
                  window.vivaldi.tabsPrivate.setGroupProperties({ groupExtId: gIdStr, groupColor: color }, () => {
                    if (chrome.runtime.lastError) {
                      console.warn("[TidyTabs] Native setGroupProperties for color failed:", chrome.runtime.lastError.message);
                    } else {
                      console.log("[TidyTabs] Native group color set successfully:", color);
                    }
                    resolve();
                  });
                } else {
                  resolve();
                }
              });
            });
          } catch (e) {
            console.warn("[TidyTabs] setGroupProperties threw exception:", e.message);
          }
        }

        // Apply metadata sequentially
        let parentExtId = "";
        for (let i = 0; i < group.tabs.length; i++) {
          const tab = group.tabs[i];
          const isParent = i === 0;
          
          if (isParent) {
            parentExtId = await addTabToStack(tab.id, String(vivaldiGroupId), group.name, color, null);
          } else {
            await addTabToStack(tab.id, String(vivaldiGroupId), group.name, color, parentExtId);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } else {
        // Safe Fallback: if tabsPrivate.move is not supported or failed, fall back to our metadata writes
        console.warn("[TidyTabs] Stacking failed, falling back to metadata writes.");
        const stackId = group.stackId || crypto.randomUUID();
        let parentExtId = "";
        for (let i = 0; i < group.tabs.length; i++) {
          const tab = group.tabs[i];
          const isParent = i === 0;
          
          if (isParent) {
            parentExtId = await addTabToStack(tab.id, stackId, group.name, color, null);
          } else {
            await addTabToStack(tab.id, stackId, group.name, color, parentExtId);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    }
  };

  const moveGroupToEnd = async (group) => {
    if (!group || !group.tabs.length) return;
    const allTabs = await new Promise((r) =>
      chrome.tabs.query({ currentWindow: true }, r)
    );
    const targetIndex = allTabs.length;
    for (let i = 0; i < group.tabs.length; i++) {
      await new Promise((resolve) => {
        chrome.tabs.move(group.tabs[i].id, { index: targetIndex + i }, () => {
          if (chrome.runtime.lastError)
            console.error("[TidyTabs]", chrome.runtime.lastError.message);
          resolve();
        });
      });
    }
  };

  const detectExistingStacks = async (nextElement) => {
    const stacks = [];
    while (nextElement) {
      if (nextElement.tagName === "SPAN") {
        const isStack =
          nextElement.querySelector(SELECTORS.STACK_COUNTER) ||
          nextElement.querySelector(SELECTORS.TAB_STACK) ||
          nextElement.querySelector(SELECTORS.SUBSTACK);

        if (isStack) {
          const wrapper = nextElement.querySelector(SELECTORS.TAB_WRAPPER);
          const stackTabId = wrapper
            ?.getAttribute("data-id")
            ?.replace("tab-", "");
          if (stackTabId) {
            const allTabs = await new Promise((r) =>
              chrome.tabs.query({ currentWindow: true }, r)
            );
            const stackTab = allTabs.find((t) => {
              try {
                const d = JSON.parse(t.vivExtData || "{}");
                return d.group && t.vivExtData.includes(stackTabId.slice(0, 8));
              } catch {
                return false;
              }
            });
            if (stackTab) {
              const viv = JSON.parse(stackTab.vivExtData);
              stacks.push({
                id: viv.group,
                name: viv.fixedGroupTitle || stackTab.title || "Unnamed",
                tabId: stackTab.id,
              });
            }
          }
        }
      }
      nextElement = nextElement.nextElementSibling;
    }
    return stacks;
  };

  const collectTabsFromSeparator = async (separator) => {
    const tabs = [];
    const seenTabIds = new Set();
    const allTabs = await new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, (queriedTabs) => {
        resolve(chrome.runtime.lastError ? [] : queriedTabs);
      });
    });
    const allTabsWithViv = allTabs.map((tab) => {
      let vivExtData = {};
      try {
        vivExtData = tab.vivExtData
          ? JSON.parse(tab.vivExtData)
          : {};
      } catch (e) { console.warn("[TidyTabs] Failed to parse vivExtData:", e); }
      return { ...tab, vivExtData };
    });

    const addTabId = (tabId) => {
      if (!Number.isInteger(tabId) || seenTabIds.has(tabId)) return;
      const tab = allTabsWithViv.find((item) => item.id === tabId);
      if (!tab || tab.pinned || tab.vivExtData.panelId) return;
      seenTabIds.add(tabId);
      tabs.push({ id: tabId });
    };

    const getStackGroupId = (element) => {
      const wrapper = element.querySelector(SELECTORS.TAB_WRAPPER);
      const stackDomId = wrapper
        ?.getAttribute("data-id")
        ?.replace("tab-", "");
      if (!stackDomId) return "";

      const exact = allTabsWithViv.find((tab) => tab.vivExtData.group === stackDomId);
      if (exact) return exact.vivExtData.group;

      const shortId = stackDomId.slice(0, 8);
      const matched = allTabsWithViv.find((tab) => {
        const group = tab.vivExtData.group;
        return typeof group === "string" && group.includes(shortId);
      });
      return matched?.vivExtData.group || "";
    };

    let el = separator.nextElementSibling;
    while (el) {
      if (el.tagName === "SPAN") {
        const isStack =
          el.querySelector(SELECTORS.STACK_COUNTER) ||
          el.querySelector(SELECTORS.TAB_STACK) ||
          el.querySelector(SELECTORS.SUBSTACK);
        const pos = el.querySelector(SELECTORS.TAB_POSITION);
        if (isStack) {
          const stackId = getStackGroupId(el);
          allTabsWithViv
            .filter((tab) =>
              tab.vivExtData.group === stackId &&
              !tab.pinned &&
              !tab.vivExtData.panelId
            )
            .sort((a, b) => a.index - b.index)
            .forEach((tab) => addTabId(tab.id));
        } else if (pos && !pos.classList.contains(CLASSES.PINNED)) {
          const wrapper = el.querySelector(SELECTORS.TAB_WRAPPER);
          const id = wrapper?.getAttribute("data-id");
          if (id) {
            const num = parseInt(id.replace("tab-", ""));
            if (!isNaN(num)) addTabId(num);
          }
        }
      }
      el = el.nextElementSibling;
    }
    return tabs;
  };

  // ==================== Clear Button (two-stage window cleanup) ====================

  // Two-stage cleanup scoped to the CURRENT WORKSPACE:
  //   Stage 1 (Clear) — close loose non-pinned tabs, keeping the focused tab
  //                      and all tab stacks intact.
  //   Stage 2 (Clear All) — close the focused tab and every tab stack.
  // The button shows "Clear All" only while the workspace holds no loose tabs
  // (its non-pinned tabs are exactly the focused tab plus tab stacks) AND the
  // arming Clear press happened within the last 5 s — the armed state expires
  // even when the condition still holds, so a stale Clear All can never fire
  // without a fresh Clear → Clear All confirmation. The label is re-evaluated
  // on every tab change, focus move, workspace switch, and at each click.
  // Stack members are collected with the same semantics as the per-stack close
  // button (getStackTabIds): closing a stack closes ALL its tabs, pinned ones included.
  const CLEAR_ARM_WINDOW_MS = 5000;
  let clearArmed = false;
  let clearArmTime = 0;
  let clearArmExpiryTimer = null;
  let clearArmUpdateTimer = null;

  const getWindowTabs = () =>
    new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        resolve(chrome.runtime.lastError ? [] : tabs);
      });
    });

  const removeTabs = (tabIds) =>
    new Promise((resolve) => {
      if (tabIds.length === 0) return resolve(0);
      chrome.tabs.remove(tabIds, () => {
        if (chrome.runtime.lastError) {
          console.error("[TidyTabs] [clear] remove failed:", chrome.runtime.lastError.message);
        }
        resolve(tabIds.length);
      });
    });

  const getCurrentWorkspaceId = async () => {
    const allTabs = await getWindowTabs();
    const activeTab = allTabs.find((t) => t.id > 0 && t.active);
    return activeTab ? (parseVivExtData(activeTab).workspaceId || null) : null;
  };

  // Tabs from other workspaces must never be touched. If the current workspace
  // id is unavailable, match only tabs that also lack one (safe: closes nothing).
  const isTabInWorkspace = (tab, workspaceId) => {
    const id = parseVivExtData(tab).workspaceId;
    return workspaceId ? id === workspaceId : !id;
  };

  const isWithinArmWindow = () => Date.now() - clearArmTime < CLEAR_ARM_WINDOW_MS;

  const setClearArmed = (armed) => {
    if (armed === clearArmed) return;
    clearArmed = armed;
    if (!armed) {
      clearArmTime = 0;
      clearTimeout(clearArmExpiryTimer);
      clearArmExpiryTimer = null;
    }
    updateClearButtons();
  };

  // Arm "Clear All" with a fresh 5 s window — only reachable from a Clear press
  const armClearAll = () => {
    clearArmTime = Date.now();
    clearArmed = true;
    clearTimeout(clearArmExpiryTimer);
    clearArmExpiryTimer = setTimeout(() => {
      clearArmExpiryTimer = null;
      setClearArmed(false); // window expired — even if the condition still holds
    }, CLEAR_ARM_WINDOW_MS);
    updateClearButtons();
  };

  // "Clear All" is armed only while the current workspace's non-pinned tabs
  // are exactly the focused tab plus tab stacks — no loose tabs
  const shouldShowClearAll = async () => {
    const allTabs = await getWindowTabs();
    const workspaceId = await getCurrentWorkspaceId();
    const stackMembers = new Set();
    let hasStack = false;
    for (const tab of allTabs) {
      if (tab.id < 0 || !isTabInWorkspace(tab, workspaceId)) continue;
      const viv = parseVivExtData(tab);
      if (viv.group) {
        stackMembers.add(tab.id);
        hasStack = true;
      }
    }
    const hasNonPinned = allTabs.some((t) => t.id > 0 && !t.pinned && isTabInWorkspace(t, workspaceId));
    if (!hasStack && !hasNonPinned) return false; // nothing for stage 2 to do
    return !allTabs.some((t) =>
      t.id > 0 && !t.pinned && !t.active && !stackMembers.has(t.id) && isTabInWorkspace(t, workspaceId)
    );
  };

  const updateClearArmState = async () => {
    // Can only disarm: an armed window exists only after a Clear press, and
    // only the click handler (re)arms. Expired window or broken condition → Clear.
    if (clearArmed && (!isWithinArmWindow() || !(await shouldShowClearAll()))) {
      setClearArmed(false);
    }
  };

  const scheduleClearArmUpdate = (delay = 250) => {
    clearTimeout(clearArmUpdateTimer);
    clearArmUpdateTimer = setTimeout(() => {
      clearArmUpdateTimer = null;
      updateClearArmState();
    }, delay);
  };

  // Stage 1 — close every non-pinned tab of the current workspace except the
  // focused one, keeping tab stacks intact (stacks are only closed by the
  // second click)
  const closeAllTabsExceptActive = async () => {
    const allTabs = await getWindowTabs();
    const workspaceId = await getCurrentWorkspaceId();
    const stackMembers = new Set();
    for (const tab of allTabs) {
      if (tab.id < 0 || !isTabInWorkspace(tab, workspaceId)) continue;
      const viv = parseVivExtData(tab);
      if (viv.group) stackMembers.add(tab.id);
    }
    const toClose = allTabs
      .filter((t) => t.id > 0 && !t.pinned && !t.active && !stackMembers.has(t.id) && isTabInWorkspace(t, workspaceId))
      .map((t) => t.id);
    const closed = await removeTabs(toClose);
    if (closed > 0) {
      showToast(`Closed ${closed} tabs — stacks and active tab kept`, { type: "info" });
    }
  };

  // Stage 2 — close every tab stack of the current workspace (same member
  // collection as the stack-close button, batched over one tab query), then
  // the remaining non-pinned tabs, which includes the focused one
  const closeAllTabsAndStacks = async () => {
    const allTabs = await getWindowTabs();
    const workspaceId = await getCurrentWorkspaceId();
    const closeIds = new Set();

    const stacks = new Map(); // group → member tab ids (pinned included)
    for (const tab of allTabs) {
      if (tab.id < 0 || !isTabInWorkspace(tab, workspaceId)) continue;
      const viv = parseVivExtData(tab);
      if (!viv.group) continue;
      if (!stacks.has(viv.group)) stacks.set(viv.group, []);
      stacks.get(viv.group).push(tab.id);
    }
    for (const members of stacks.values()) {
      for (const id of members) closeIds.add(id);
    }
    for (const tab of allTabs) {
      if (tab.id > 0 && !tab.pinned && isTabInWorkspace(tab, workspaceId)) closeIds.add(tab.id);
    }

    const closed = await removeTabs([...closeIds]);
    if (closed > 0) showToast(`Closed ${closed} tabs and stacks in this workspace`, { type: "success" });
  };

  const updateClearButtons = () => {
    document.querySelectorAll(`.${CLASSES.CLEAR_BUTTON}`).forEach((btn) => {
      btn.classList.toggle("is-armed", clearArmed);
      btn.textContent = clearArmed ? "Clear All" : "Clear";
      btn.title = clearArmed
        ? "Close the focused tab and all tab stacks in this workspace"
        : "Close all tabs in this workspace except the focused one";
    });
  };

  const handleClearClick = async () => {
    const armedNow = (await shouldShowClearAll()) && isWithinArmWindow(); // always decide against live state
    if (armedNow) {
      setClearArmed(false);
      await closeAllTabsAndStacks();
    } else {
      await closeAllTabsExceptActive();
      if (await shouldShowClearAll()) armClearAll();
      else setClearArmed(false);
    }
    scheduleAttachButtons(CONFIG.delays.reattach);
    scheduleClearArmUpdate(0); // refresh the label after the workspace state changed
  };

  // ==================== UI Components ====================

  const createTidyButton = () => {
    const btn = document.createElement("div");
    btn.className = CLASSES.TIDY_BUTTON;
    btn.textContent = "Tidy";
    return btn;
  };

  const createClearButton = () => {
    const btn = document.createElement("div");
    btn.className = CLASSES.CLEAR_BUTTON;
    btn.textContent = clearArmed ? "Clear All" : "Clear";
    btn.title = clearArmed
      ? "Close the focused tab and all tab stacks in this workspace"
      : "Close all tabs in this workspace except the focused one";
    if (clearArmed) btn.classList.add("is-armed");
    return btn;
  };

  const scheduleAttachButtons = (delay = CONFIG.delays.debounce) => {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      attachButtons();
      debounceTimer = null;
    }, delay);
  };

  const ensureSeparatorButton = (separator, className, factory, onClick) => {
    let button = separator.querySelector(`.${className}`);
    if (button) return button;
    button = factory();
    separator.appendChild(button);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick(separator);
    });
    return button;
  };

  const decorateSeparator = (separator) => {
    ensureSeparatorButton(
      separator,
      CLASSES.TIDY_BUTTON,
      createTidyButton,
      tidyTabsBelow
    );
    ensureSeparatorButton(
      separator,
      CLASSES.CLEAR_BUTTON,
      createClearButton,
      handleClearClick
    );
    let key = getSeparatorKey(separator);
    // If separator has no tidyKey but processing is active, claim an orphaned key
    // (happens when Vivaldi rebuilds separator DOM, e.g. auto-hide toggle)
    if (!separator.dataset.tidyKey && processingSeparators.size > 0) {
      const allSeps = document.querySelectorAll(SELECTORS.SEPARATOR);
      for (const sep of allSeps) {
        if (sep === separator) continue;
        if (sep.dataset.tidyKey && processingSeparators.has(sep.dataset.tidyKey)) {
          // Another separator already has this key — skip
        }
      }
      // Find a processing key not claimed by any separator
      for (const pKey of processingSeparators) {
        let claimed = false;
        for (const sep of allSeps) {
          if (sep.dataset.tidyKey === pKey) { claimed = true; break; }
        }
        if (!claimed) {
          separator.dataset.tidyKey = pKey;
          key = pKey;
          console.log("[TidyTabs] [recovery] Claimed orphaned key for rebuilt separator:", pKey);
          break;
        }
      }
    }
    separator.classList.toggle(CLASSES.LOADING, Boolean(key && processingSeparators.has(key)));
  };

  const attachButtons = () => {
    document.querySelectorAll(SELECTORS.SEPARATOR).forEach((separator) => {
      decorateSeparator(separator);
    });
    injectStackActionButtons();
    scheduleClearArmUpdate(0);
  };

  // ==================== Stack Action Buttons (Pin / Close Stack) ====================

  const STACK_BTN = {
    EDIT: "tidy-edit-stack-btn",
    UNSTACK: "tidy-unstack-stack-btn",
    PIN: "tidy-pin-stack-btn",
    CLOSE: "tidy-close-stack-btn",
  };

  const getStackTabIds = async (tabId) => {
    try {
      const tab = await getTab(tabId);
      if (!tab) return [];
      const { group: groupId } = parseVivExtData(tab);
      if (!groupId) return [];
      const allTabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
      return allTabs.filter((t) => {
        try { return parseVivExtData(t).group === groupId; } catch (_) { return false; }
      }).map((t) => t.id);
    } catch (_) { return []; }
  };

  // Shared unstack helper — hoisted function so all callers can use it
  async function _unstackGroup(groupId) {
    if (!groupId || !vivaldi?.tabsPrivate?.unstack) return;
    try {
      const result = vivaldi.tabsPrivate.unstack(groupId);
      if (result && typeof result.then === "function") await result;
    } catch (_) { /* non-critical */ }
  }

  const togglePinTabStack = async (tabId, pinBtn) => {
    const stackIds = await getStackTabIds(tabId);
    if (stackIds.length === 0) return;
    const tab = await getTab(tabId);
    const isPinned = tab?.pinned;
    const groupId = tab?.vivExtData?.group;
    const stackName = tab?.vivExtData?.fixedGroupTitle || "";
    const isSuggestedPin = SUGGESTED_PIN_NAMES.includes(stackName);
    const newPinned = !isPinned;

    await Promise.all(stackIds.map((id) =>
      new Promise((r) => chrome.tabs.update(id, { pinned: newPinned }, r))
    ));

    if (newPinned) {
      if (isSuggestedPin) await _unstackGroup(groupId);
      showToast(`📌 Pinned ${stackIds.length} tabs${isSuggestedPin ? "" : " (stack kept)"}`, { type: "success" });
    } else {
      showToast(`Unpinned ${stackIds.length} tabs`, { type: "success" });
    }

    // Update button visual state directly — no DOM query needed
    if (pinBtn) {
      pinBtn.classList.toggle("is-pinned", newPinned);
      pinBtn.title = newPinned ? "Unpin tab stack" : "Pin tab stack";
    }
  };

  const closeEntireStack = async (tabId) => {
    const stackIds = await getStackTabIds(tabId);
    if (stackIds.length === 0) return;
    await new Promise((r) => chrome.tabs.remove(stackIds, r));
    showToast(`Closed ${stackIds.length} tabs`, { type: "success" });
  };

  const unstackTabStack = async (tabId) => {
    const tab = await getTab(tabId);
    const groupId = tab?.vivExtData?.group;
    if (!groupId) return;
    const freed = await dismantleStack(groupId);
    showToast(`Dissolved stack, ${freed.length} tabs kept`, { type: "success" });
  };

  const editStackProperties = (groupId) => {
    // Walk React fiber tree from .tab-strip to trigger Vivaldi's native StackEditor
    if (!groupId) return;
    const tabStrip = document.querySelector(".tab-strip");
    if (!tabStrip) return;
    const fiberKey = Object.keys(tabStrip).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (!fiberKey) return;

    let fiber = tabStrip[fiberKey];
    for (let depth = 0; fiber && depth < 50; depth++, fiber = fiber.return) {
      if (fiber.stateNode && typeof fiber.stateNode.setAwaitingEdit === "function") {
        fiber.stateNode.setAwaitingEdit(groupId, true);
        return;
      }
    }
  };

  const injectStackActionButtons = async () => {
    const stackEls = document.querySelectorAll(`${SELECTORS.SUBSTACK}`);
    debugLog("[TidyTabs] [buttons] injectStackActionButtons: found", stackEls.length, "stack elements");
    if (!stackEls.length) return;

    // Pre-fetch all tabs once to map ext_id → tab.id for stack elements
    const allTabs = await new Promise((r) => chrome.tabs.query({ currentWindow: true }, r));
    const extIdToTabId = new Map();
    const groupToTabMap = new Map(); // group → first tab.id
    for (const t of allTabs) {
      try {
        const viv = parseVivExtData(t);
        if (viv.ext_id) extIdToTabId.set(viv.ext_id, t.id);
        if (viv.group && !groupToTabMap.has(viv.group)) groupToTabMap.set(viv.group, t.id);
      } catch (_) { /* skip */ }
    }
    debugLog("[TidyTabs] [buttons] extIdToTabId map size:", extIdToTabId.size, "groupToTabMap size:", groupToTabMap.size);

    for (const stackEl of stackEls) {
      if (stackEl.querySelector(`.${STACK_BTN.PIN}`)) continue;

      const tabWrapper = stackEl.querySelector(SELECTORS.TAB_WRAPPER);
      if (!tabWrapper) continue;
      const dataId = tabWrapper.getAttribute("data-id")?.replace("tab-", "");
      const elementId = tabWrapper.getAttribute("id")?.replace("tab-", "");
      if (!dataId && !elementId) continue;

      const uuid = dataId || elementId;
      let tabId = Number(uuid);
      if (!Number.isFinite(tabId) || tabId <= 0) {
        tabId = extIdToTabId.get(uuid);
        if (!tabId) {
          for (const t of allTabs) {
            try {
              const viv = parseVivExtData(t);
              if (viv.ext_id === uuid || viv.group === uuid) { tabId = t.id; break; }
            } catch (_) { /* skip */ }
          }
        }
      }
      if (!Number.isFinite(tabId) || tabId <= 0) continue;

      const isPinned = allTabs.find((t) => t.id === tabId)?.pinned || false;
      const tabData = allTabs.find((t) => t.id === tabId);
      const groupId = tabData ? parseVivExtData(tabData).group : null;
      const tabHeader = stackEl.querySelector(".tab-header");
      const stackCounter = stackEl.querySelector(SELECTORS.STACK_COUNTER);
      if (!tabHeader) continue;

      const block = (e) => { e.stopPropagation(); e.preventDefault(); };
      const btnContainer = document.createElement("span");
      btnContainer.className = "tidy-stack-actions";

      const PIN_ICON = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAABGUlEQVR4nO2UvWoCURCFvxDskk4X0scmVYpg5wNY2fsCYl4ghdhYWecN8gDxCezyBP6AnaCNTSQRLIKQKANHGJZNXPenigeW3b137jecmeHCf1YLCPKCPwI7YJxXkgCY5ZXkAngCvpXAnilwkwX8CngV1BJ0Bc/Eya0gBlsDda0bdJLEiZ+SGvAhiMHKodi2K1csJ35Kuq7efeA6FFsFtsAPMFecnf9TgSvHTgk6arCXlWOpmJ7OmfNY8kk+gfvQfgF40/4AuCSBSsBIEOvBg9t71vpCcYl153rwLicN/X8BlTTwIjB0fbD3Ctjou5kVfCgnvvEvaeClELwY0ZPE18Nv8KjpOjrvp8IPOmnevUYx4KmUK/wsorQHoDJfgvBzBQEAAAAASUVORK5CYII=" alt="pin" width="12" height="12">';
      const UNSTACK_ICON = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABVklEQVR4nO2YQWrCQBiFX8xBWvQOehM9SjcW3Nmd1k1X9Qz2GvEK3SoeoJUuhMiUP/CTjjKx8zJE/g8GEknemy8xIQlgGK3QA7AC8AXgVdY705EBeANQqrGOLJGxOnzBsSUyVse14FgSGasjJPi/ErQOt+F7LSBkvYkEtWN5YUf9m28CiwYC1I7jBWsd5DuK3w0EqB0vAH7EVp+yenhVsJDt5w0E2uj4gy88NiWzwwQCKE3gCiYQQGkC9yxwUuE5IT9X+a4rOntV0CfkD1T+jpCPD1UwJeQ/q/wNIR+T2kPVMGL2SDKr/DEIuIeqbU1iKqf+lmvC7TOQI68nX5A+GvzyCODgeWOKNQ4AHliT1xIFYfKFZLdCT66Jjdwx9C02dLh9dpIxZv5tbmWmJuuWO8fMBBJjAqkxgdSYQGpMIDUmkBoTSM2TEnDLnaMP4FMG4zOMYSACZ6f6URZiN6bcAAAAAElFTkSuQmCC" alt="split" width="12" height="12">';
      const EDIT_ICON = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABVUlEQVR4nO2ZMU7DMBSGvwzkGOUa7GUAJi6DYIIJDkBRVS4Ct2CDsYXCiih7pYcieTIJJH7PMUjvk96UyP4/x44jBxzHcZzvVMAF8AE8AXso2QUWwCuwBURZK+Dwh/A30f2PmvD7wKdB6LiawegTvql3zcjnCN8mUAGzjnvPUwUWmcIvgYOe4WfhehLrqLETYAdbqlzhaVmwNf8oPC2NWtKEu+4If2sRPqfAKOFzCYwWPofAqOGtBYYs2CPgLVTXjj2qwNCRX0V7RlGBlGkjVk9e21DqnJe/IKBZsFJaQPu2kdICx8rPAyktcKV8z0tpgXvlJiWlBR6AO+AyTKehO6yUFtAiLhBwgUTEBQIukIi4wEjHKm3UUZ9NBqwOtk4zS9TAWdTns6bBXEeLQ2quEch5uNunNsAEJdNCEpvQtwmT8ChfjH5wdNU29DG3GHnHcRyH3/gCgfr8P+7Sf1YAAAAASUVORK5CYII=" alt="edit" width="12" height="12">';
      const CLOSE_ICON = '<svg width="10" height="10" viewBox="0 0 16 16"><path d="M2.146 2.854a.5.5 0 11.708-.708L8 7.293l5.146-5.147a.5.5 0 01.708.708L8.707 8l5.147 5.146a.5.5 0 01-.708.708L8 8.707l-5.146 5.147a.5.5 0 01-.708-.708L7.293 8 2.146 2.854z" fill="currentColor"/></svg>';

      // Button factory — data-driven to avoid copy-paste
      const makeBtn = (cls, title, html, handler) => {
        const btn = document.createElement("span");
        btn.className = cls;
        btn.title = title;
        btn.innerHTML = html;
        btn.addEventListener("mousedown", block);
        btn.addEventListener("click", (e) => { block(e); handler(); });
        return btn;
      };

      let pinBtn;
      const buttons = [
        makeBtn(STACK_BTN.EDIT, "Edit stack name / color", EDIT_ICON, () => editStackProperties(groupId)),
        makeBtn(STACK_BTN.UNSTACK, "Dissolve tab stack", UNSTACK_ICON, () => unstackTabStack(tabId)),
      ];
      // Pin button needs special handling (toggle state, pass ref for live update)
      pinBtn = document.createElement("span");
      pinBtn.className = STACK_BTN.PIN;
      pinBtn.title = isPinned ? "Unpin tab stack" : "Pin tab stack";
      if (isPinned) pinBtn.classList.add("is-pinned");
      pinBtn.innerHTML = PIN_ICON;
      pinBtn.addEventListener("mousedown", block);
      pinBtn.addEventListener("click", (e) => { block(e); togglePinTabStack(tabId, pinBtn); });
      buttons.push(pinBtn);
      buttons.push(makeBtn(STACK_BTN.CLOSE, "Close tab stack", CLOSE_ICON, () => closeEntireStack(tabId)));

      btnContainer.append(...buttons);
      if (stackCounter) stackCounter.before(btnContainer);
      else tabHeader.appendChild(btnContainer);
    }
  };

  // ==================== Core ====================

  const buildSpecialGroups = (pinTabs, closeTabs) => {
    const groups = [];
    if (pinTabs.length > 0) {
      groups.push({ name: getSuggestedPinName(), tabs: pinTabs, stackId: crypto.randomUUID(), isExisting: false, isSpecial: true });
    }
    if (closeTabs.length > 0) {
      groups.push({ name: getSuggestedCloseName(), tabs: closeTabs, stackId: crypto.randomUUID(), isExisting: false, isSpecial: true });
    }
    return groups;
  };

  const autoStackWorkspace = async (workspaceId) => {
    if (!(await isAutoStackAllowed(workspaceId))) return;
    const tabs = await getTabsByWorkspace(workspaceId);
    if (tabs.length < 2) return;

    await configReady;
    console.log("[TidyTabs] [decision] autoStackWorkspace — enableAIGrouping:", CONFIG.enableAIGrouping, "apiKey:", !!VividAI.config.apiKey, "tabs:", tabs.length);

    // Step 1: Extract special stacks — Close first, then Pin from remaining
    const ageData = await loadTabAgeData();
    const frequentUrls = await getFrequentUrls();
    const suggestedCloseTabs = await findSuggestedCloseTabs(tabs);
    const remainingAfterClose = suggestedCloseTabs.length
      ? tabs.filter((t) => !suggestedCloseTabs.find((c) => c.id === t.id))
      : tabs;
    const suggestedPinTabs = await findSuggestedPinTabs(remainingAfterClose, ageData, frequentUrls);
    const remainingTabs = suggestedPinTabs.length
      ? remainingAfterClose.filter((t) => !suggestedPinTabs.find((p) => p.id === t.id))
      : remainingAfterClose;

    // Step 2: Build special groups
    const specialGroups = buildSpecialGroups(suggestedPinTabs, suggestedCloseTabs);

    // Step 3: AI-group remaining tabs
    let aiGroups = null;
    let usedAI = false;
    if (remainingTabs.length >= 2) {
      aiGroups =
        CONFIG.enableAIGrouping && VividAI.config.apiKey
          ? (await getAIGrouping(remainingTabs))
          : null;
    }
    if (!aiGroups) {
      if (remainingTabs.length >= 2) {
        aiGroups = groupByDomain(remainingTabs);
        handleOrphanTabs(aiGroups, remainingTabs);
      } else {
        // Single remaining tab — put it in Others
        aiGroups = [];
        if (remainingTabs.length === 1) {
          aiGroups.push({ name: getOthersName(), tabs: remainingTabs, stackId: crypto.randomUUID(), isExisting: false });
        }
      }
    } else {
      usedAI = true;
      handleOrphanTabs(aiGroups, remainingTabs);
    }

    // Step 4: Create stacks, then move special stacks to bottom
    const othersGroup = aiGroups.find((g) => OTHERS_NAMES.includes(g.name));
    const normalGroups = aiGroups.filter((g) => !OTHERS_NAMES.includes(g.name));
    const allGroups = [...normalGroups, ...specialGroups, ...(othersGroup ? [othersGroup] : [])];
    if (allGroups.length > 0) {
      await createTabStacks(allGroups);
      for (const g of [...specialGroups].reverse()) {
        await moveGroupToEnd(g);
      }
      if (othersGroup) await moveGroupToEnd(othersGroup);
      showToast(`Successfully grouped ${allGroups.length} stacks`, { type: "success" });
      // Orphan tab toast — explain why a single tab ended up alone
      if (othersGroup && othersGroup.tabs.length === 1) {
        const orphan = othersGroup.tabs[0];
        const title = truncateTitle(orphan.title || orphan.url || "Untitled", 25);
        const reason = usedAI ? "AI 未分配到组" : "唯一域名，无法配对";
        showToast(`🏷️ "${title}" — ${reason}`, { type: "info", duration: 6000 });
      }
    }
  };

  const tidyTabsBelow = async (separator) => {
    // Re-entrancy guard: reject if this separator is already being processed
    const existingKey = separator?.dataset?.tidyKey;
    if (existingKey && processingSeparators.has(existingKey)) {
      console.log("[TidyTabs] [guard] Tidy already in progress for this separator, skipping");
      return;
    }

    // Assign a stable UUID key that survives DOM index shifts
    const separatorKey = existingKey || `tidy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    separator.dataset.tidyKey = separatorKey;

    const tabsInfo = await collectTabsFromSeparator(separator);
    if (tabsInfo.length < 2) {
      delete separator.dataset.tidyKey;
      return;
    }

    processingSeparators.add(separatorKey);
    setSeparatorLoadingState(separatorKey, true);

    try {
      const tabs = (
        await Promise.all(tabsInfo.map((t) => getTab(t.id)))
      ).filter(Boolean);
      if (tabs.length < 1) return;

      await configReady;
      console.log("[TidyTabs] [decision] tidyTabsBelow — enableAIGrouping:", CONFIG.enableAIGrouping, "apiKey:", !!VividAI.config.apiKey, "tabs:", tabs.length);

      // Step 0: Handle existing stacks — dismantle unnamed, preserve named
      let namedStacks = detectNamedStacks(tabs);
      const unnamedIds = findUnnamedStackIds(tabs);
      let pool = tabs;
      if (unnamedIds.length > 0) {
        console.log("[TidyTabs] [stacks] Dismantling", unnamedIds.length, "unnamed stack(s)");
        for (const gid of unnamedIds) await dismantleStack(gid);
        // Re-fetch tabs after dismantling (vivExtData.group may be cleared)
        const refreshed = (await Promise.all(pool.map((t) => getTab(t.id)))).filter(Boolean);
        pool = refreshed;
      }
      // Exclude tabs in named stacks from the grouping pool
      if (namedStacks.length > 0) {
        const namedTabIds = new Set(namedStacks.flatMap((s) => s.tabIds));
        pool = pool.filter((t) => !namedTabIds.has(t.id));
        console.log("[TidyTabs] [stacks] Preserving", namedStacks.length, "named stack(s), excluding", namedTabIds.size, "tabs from pool. Pool size:", pool.length);
        for (const s of namedStacks) {
          console.log(`[TidyTabs] [stacks]   Named stack "${s.name}": tabs [${s.tabIds.join(",")}]`);
        }
      }

      // Step 1: Extract special stacks from pool AND from inside named stacks
      const ageData = await loadTabAgeData();
      const frequentUrls = await getFrequentUrls();

      // Scan pool tabs — CLOSE first, then PIN from remaining
      const suggestedCloseTabs = await findSuggestedCloseTabs(pool);
      const remainingAfterClose = suggestedCloseTabs.length
        ? pool.filter((t) => !suggestedCloseTabs.find((c) => c.id === t.id))
        : pool;
      const suggestedPinTabs = await findSuggestedPinTabs(remainingAfterClose, ageData, frequentUrls);
      let remainingTabs = suggestedPinTabs.length
        ? remainingAfterClose.filter((t) => !suggestedPinTabs.find((p) => p.id === t.id))
        : remainingAfterClose;

      // Extract internal browser pages (vivaldi://, chrome://, about:, etc.)
      const isInternalPage = (url) => /^(vivaldi|chrome|chrome-extension|about|edge|brave):/.test(url || "");
      const internalTabs = remainingTabs.filter((t) => isInternalPage(t.url));
      if (internalTabs.length > 0) {
        remainingTabs = remainingTabs.filter((t) => !isInternalPage(t.url));
        console.log("[TidyTabs] [stacks] Extracted", internalTabs.length, "internal page(s) (vivaldi://, chrome://, etc.)");
      }

      // Scan inside named stacks — extract tabs that should be closed or pinned
      if (namedStacks.length > 0) {
        const allNamedTabIds = new Set(namedStacks.flatMap((s) => s.tabIds));
        const namedTabs = tabs.filter((t) => allNamedTabIds.has(t.id));
        if (namedTabs.length > 0) {
          console.log("[TidyTabs] [stacks] Scanning", namedTabs.length, "tabs inside named stacks for close/pin suggestions...");
          const namedClose = await findSuggestedCloseTabs(namedTabs);
          const namedPin = await findSuggestedPinTabs(
            namedTabs.filter((t) => !namedClose.find((c) => c.id === t.id)),
            ageData, frequentUrls
          );

          // Track which named stacks had tabs extracted
          const extractedIds = new Set([...namedPin.map((t) => t.id), ...namedClose.map((t) => t.id)]);
          const modifiedStackIds = new Set();

          for (const s of namedStacks) {
            const before = s.tabIds.length;
            s.tabIds = s.tabIds.filter((id) => !extractedIds.has(id));
            if (s.tabIds.length !== before) {
              modifiedStackIds.add(s.id);
              console.log(`[TidyTabs] [stacks]   "${s.name}": extracted ${before - s.tabIds.length} tabs, ${s.tabIds.length} remain`);
            }
          }

          // Dismantle modified stacks — put remaining tabs back in the pool
          for (const s of namedStacks) {
            if (!modifiedStackIds.has(s.id)) continue;
            await dismantleStack(s.id);
            for (const tabId of s.tabIds) {
              const t = namedTabs.find((nt) => nt.id === tabId);
              if (t && !remainingTabs.find((rt) => rt.id === t.id)) {
                remainingTabs.push(t);
              }
            }
          }

          // Remove dismantled stacks from namedStacks
          namedStacks = namedStacks.filter((s) => !modifiedStackIds.has(s.id));

          // Add extracted tabs to special categories
          if (namedPin.length > 0) {
            console.log("[TidyTabs] [stacks]   →", namedPin.length, "tabs moved to Pin Me");
            suggestedPinTabs.push(...namedPin);
          }
          if (namedClose.length > 0) {
            console.log("[TidyTabs] [stacks]   →", namedClose.length, "tabs moved to Close Me");
            suggestedCloseTabs.push(...namedClose);
          }
          console.log("[TidyTabs] [stacks] After scanning,", namedStacks.length, "named stacks remain, pool size:", remainingTabs.length + suggestedPinTabs.length + suggestedCloseTabs.length - namedPin.length - namedClose.length);
        }
      }

      // Step 2: Build special groups
      const specialGroups = buildSpecialGroups(suggestedPinTabs, suggestedCloseTabs);

      // Build Internal Page group if any internal pages exist
      let internalGroup = null;
      if (internalTabs.length > 0) {
        internalGroup = { name: "Internal Page", tabs: internalTabs, stackId: crypto.randomUUID(), isExisting: false, isSpecial: true };
      }

      // Step 3: AI-group remaining tabs, passing named stacks so AI can add tabs to them
      // Build existingStacks for AI with existingTabIds for prompt
      const aiExistingStacks = namedStacks.map((s) => ({ id: s.id, name: s.name, existingTabIds: s.tabIds }));
      let aiGroups = null;
      let usedAI = false;
      if (remainingTabs.length >= 2) {
        aiGroups =
          CONFIG.enableAIGrouping && VividAI.config.apiKey
            ? (await getAIGrouping(remainingTabs, aiExistingStacks))
            : null;
      }
      if (!aiGroups) {
        if (remainingTabs.length >= 2) {
          console.log("[TidyTabs] [decision] AI grouping returned null, falling back to groupByDomain");
          aiGroups = groupByDomain(remainingTabs);
          handleOrphanTabs(aiGroups, remainingTabs, []);
        } else {
          aiGroups = [];
          if (remainingTabs.length === 1) {
            aiGroups.push({ name: getOthersName(), tabs: remainingTabs, stackId: crypto.randomUUID(), isExisting: false });
          }
        }
      } else {
        usedAI = true;
        handleOrphanTabs(aiGroups, remainingTabs, aiExistingStacks);
        console.log("[TidyTabs] [decision] Using AI-generated groups:", aiGroups.map(g => g.name));
      }

      // Step 4: Combine — AI groups → Internal Page → Pin Me → Close Me → Others
      // Handle named stack groups: they need to merge into existing stacks, not create new ones
      const newAiGroups = [];
      for (const g of aiGroups) {
        if (g.isExisting) {
          console.log("[TidyTabs] [stacks] Adding", g.tabs.length, "tabs to existing stack:", g.name);
          await addTabsToExistingStack(g.stackId, g.name, g.tabs);
        } else {
          newAiGroups.push(g);
        }
      }

      // Create all stacks — "其它" always exists (AI-created or empty placeholder)
      const othersGroup = newAiGroups.find((g) => OTHERS_NAMES.includes(g.name))
        || { name: getOthersName(), tabs: [], stackId: crypto.randomUUID(), isExisting: false };
      const normalGroups = newAiGroups.filter((g) => !OTHERS_NAMES.includes(g.name));
      const allGroups = [...normalGroups, ...(internalGroup ? [internalGroup] : []), ...specialGroups, othersGroup];
      if (allGroups.length > 0) {
        await createTabStacks(allGroups);
        // Move to bottom in order: Internal Page → Pin Me → Close Me → Others
        if (internalGroup) await moveGroupToEnd(internalGroup);
        for (const g of specialGroups) {
          await moveGroupToEnd(g);
        }
        if (othersGroup) await moveGroupToEnd(othersGroup);
        showToast(`Successfully grouped ${allGroups.length} stacks`, { type: "success" });
        if (othersGroup && othersGroup.tabs.length === 1) {
          const orphan = othersGroup.tabs[0];
          const title = truncateTitle(orphan.title || orphan.url || "Untitled", 25);
          const reason = usedAI
            ? "AI 未分配到组"
            : "唯一域名，无法配对";
          showToast(`🏷️ "${title}" — ${reason}`, { type: "info", duration: 6000 });
        }
      }

      // Name any existing stacks that lack fixedGroupTitle
      await renameUnnamedStacks();
      // Color any existing stacks that lack groupColor
      await colorUncoloredStacks();
    } finally {
      processingSeparators.delete(separatorKey);
      setSeparatorLoadingState(separatorKey, false);
      delete separator.dataset.tidyKey;
      scheduleAttachButtons(CONFIG.delays.reattach);
    }
  };

  // ==================== Event Listeners ====================

  const setupAutoStackListener = () => {
    if (!chrome.webNavigation) return;
    chrome.webNavigation.onCommitted.addListener(async (details) => {
      if (details.tabId !== -1 && details.frameType === "outermost_frame") {
        const tab = await getTab(details.tabId);
        if (tab && !tab.pinned && tab.vivExtData && !tab.vivExtData.panelId) {
          setTimeout(
            () => autoStackWorkspace(tab.vivExtData.workspaceId),
            CONFIG.delays.autoStack
          );
        }
      }
    });
  };

  // ==================== DOM Observers ====================

  let observedTabStrip = null;
  let tabStripObserver = null;

  // Listen to inner changes of .tab-strip (tab additions/deletions, workspace switching)
  const observeTabStripInner = (tabStrip) => {
    if (tabStripObserver) tabStripObserver.disconnect();
    observedTabStrip = tabStrip;

    tabStripObserver = new MutationObserver((mutations) => {
      let changed = false,
        wsSwitch = false,
        classMutated = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length > 0) {
          for (const n of m.addedNodes) {
            if (n.nodeType === Node.ELEMENT_NODE && n.tagName === "SPAN") {
              changed = true;
              break;
            }
          }
        }
        if (m.type === "attributes" && m.attributeName === "aria-owns")
          wsSwitch = true;
        if (
          m.type === "attributes" &&
          m.attributeName === "class" &&
          m.target?.classList?.contains("separator")
        ) {
          const key = getSeparatorKey(m.target);
          if (
            key &&
            processingSeparators.has(key) &&
            !m.target.classList.contains(CLASSES.LOADING)
          ) {
            m.target.classList.add(CLASSES.LOADING);
          }
        }
        if (m.type === "attributes" && m.attributeName === "class") classMutated = true;
        if (changed && wsSwitch) break;
      }
      // Keep the armed label honest: tab additions/removals, focus moves, and
      // workspace switches can all break (or restore) the clean state.
      if (changed || wsSwitch || classMutated) {
        scheduleClearArmUpdate();
      }
      if (changed || wsSwitch) {
        // Auto-hide toggle or tab-strip rebuild may replace separator DOM,
        // dropping dataset.tidyKey. Transfer orphaned processing keys before
        // re-scheduling button attach so LOADING state persists.
        if (changed && processingSeparators.size > 0) {
          const allSeps = tabStrip.querySelectorAll(":scope > .separator");
          for (const sep of allSeps) {
            if (!sep.dataset.tidyKey && !sep.classList.contains(CLASSES.LOADING)) {
              for (const key of processingSeparators) {
                const existing = tabStrip.querySelector(`[data-tidy-key="${key}"]`);
                if (!existing) {
                  sep.dataset.tidyKey = key;
                  sep.classList.add(CLASSES.LOADING);
                  console.log("[TidyTabs] [recovery] Transferred tidy key to rebuilt separator:", key);
                  break;
                }
              }
            }
          }
        }
        scheduleAttachButtons(
          wsSwitch ? CONFIG.delays.workspaceSwitch : CONFIG.delays.mutation
        );
      }
    });

    tabStripObserver.observe(tabStrip, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-owns", "class"],
      attributeOldValue: true,
    });
  };

  // Listen to subtree changes of #browser to detect if .tab-strip is destroyed and rebuilt
  const observeStructure = () => {
    const root = document.getElementById("browser") || document.body;

    new MutationObserver(() => {
      const tabStrip = document.querySelector(SELECTORS.TAB_STRIP);
      if (!tabStrip) return;

      // .tab-strip changed (rebuilt), rebind
      if (tabStrip !== observedTabStrip) {
        console.log("[TidyTabs] .tab-strip rebuilt, reattaching");
        observeTabStripInner(tabStrip);
        scheduleAttachButtons(CONFIG.delays.init);
        reapplyLoadingStates();
        return;
      }

      // Buttons lost, reattach
      const seps = tabStrip.querySelectorAll(".separator");
      const tidyButtons = tabStrip.querySelectorAll(`.${CLASSES.TIDY_BUTTON}`);
      const clearButtons = tabStrip.querySelectorAll(`.${CLASSES.CLEAR_BUTTON}`);
      if (
        seps.length > 0 &&
        (tidyButtons.length < seps.length || clearButtons.length < seps.length)
      ) {
        scheduleAttachButtons(200);
      }
    }).observe(root, { childList: true, subtree: true });
  };

  // Periodic refresh of tab age data (every 5 minutes)
  setInterval(recordTabActivation, 5 * 60 * 1000);

  const init = () => {
    console.log("[TidyTabs] ✓ Initialization complete");
    // Initial tab age snapshot
    recordTabActivation();
    setTimeout(attachButtons, CONFIG.delays.init);

    // Try binding current .tab-strip first
    const tabStrip = document.querySelector(SELECTORS.TAB_STRIP);
    if (tabStrip) observeTabStripInner(tabStrip);

    // Listen for structural changes (e.g. auto-hide toggle causing .tab-strip rebuild)
    observeStructure();
    setupAutoStackListener();
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", init);
  else init();
})();
