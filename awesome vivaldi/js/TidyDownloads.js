// ==UserScript==
// @name         TidyDownloads
// @description  Uses chrome.downloads.onDeterminingFilename to dynamically rename downloads.
// @version      2026.7.25
// @author       PaRr0tBoY
// ==/UserScript==

/*
 * Usage:
 * 1. Adjust CONFIG if needed (AI config is managed by VividAI.js / ModConfig)
 * 2. Copy to <Vivaldi Dir>/Application/<Version>/resources/vivaldi/
 * 3. Include in window.html: <script src="TidyDownloads.js"></script>
 * 4. Restart Vivaldi
 */

(() => {
  "use strict";

  // ==================== AI Configuration ====================
  // Depends on VividAI.js — shared AI config and API caller
  VividAI.loadConfig({ modKey: "tidyDownloads" }).then(() => logStartupInfo());
  window.addEventListener("vivaldi-mod-ai-config-updated", (event) => {
    VividAI.applyConfig(event.detail || {});
    logStartupInfo();
  });

  function logStartupInfo() {
    log.info(`========== TidyDownloads Module Starting ==========`);
    log.info(`API: ${VividAI.config.apiEndpoint}`);
    log.info(`Model: ${VividAI.config.model}`);
    log.info(`Enabled: ${CONFIG.enabled}`);
    log.info(`Prefer focused tab context: ${CONFIG.preferFocusedTabContext}`);
    log.info(`Skip keywords: ${CONFIG.skipKeywords.join(", ")}`);
    log.info(`Skip extensions: ${CONFIG.skipExtensions.join(", ")}`);
    if (!VividAI.config.apiKey) {
      log.warn(`Please set VividAI API key in ModConfig.`);
    }
  }

  const showToast = (message, options = {}) => {
    window.VModToast?.show(message, { module: "TidyDownloads", ...options });
  };

  const isEnglishUi = () => {
    const lang = chrome.i18n?.getUILanguage?.() || navigator.language || "";
    return String(lang).toLowerCase().startsWith("en");
  };

  const toastText = (key, data = {}) => {
    const en = isEnglishUi();
    const text = {
      renamed: en
        ? `Renamed: ${data.newName}`
        : `已重命名: ${data.newName}`,
    };
    return text[key] || key;
  };

  // ==================== Script Configuration ====================
  const CONFIG = {
    // Enable AI renaming (false = use original filename)
    enabled: true,

    // Prefer the currently focused tab as rename context.
    // Useful when downloads come from CDNs or blob/object URLs.
    preferFocusedTabContext: true,

    // Skip keywords whitelist (skip rename if URL or filename contains these)
    skipKeywords: ["localhost", "127.0.0.1", "file://"],

    // Skip file extensions
    skipExtensions: [],
  };
  // ============================

  const LOG_PREFIX = "[TidyDownloads]";

  // ---------- Logging utilities ----------
  const log = {
    info: (...args) => console.log(`${LOG_PREFIX} [INFO]`, ...args),
    warn: (...args) => console.warn(`${LOG_PREFIX} [WARN]`, ...args),
    error: (...args) => console.error(`${LOG_PREFIX} [ERROR]`, ...args),
    debug: (...args) => console.log(`${LOG_PREFIX} [DEBUG]`, ...args),
  };

  // ---------- Utilities ----------
  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  function getExtension(filename) {
    const m = /\.([^.]+)$/.exec(filename);
    return m ? m[1] : "";
  }

  function extractTabTitle(tabUrl, tabTitle) {
    // Strip common suffixes
    return (tabTitle || "")
      .replace(
        /\s*[-_|]\s*(YouTube|Gmail|Google|Twitter|Facebook|GitHub|LinkedIn|Notion| Slack|Discord|Telegram|WeChat|WhatsApp).*$/i,
        ""
      )
      .trim();
  }

  function buildUserMessage({ filename, tabTitle, hostname }) {
    // Arc-style: concise metadata
    const lines = [`Original filename: '${filename}'`];
    if (hostname) lines.push(`Source domain: '${hostname}'`);
    if (tabTitle) lines.push(`Source tab title: '${tabTitle}'`);
    return lines.join("\n");
  }

  // Arc system prompt (keep in English for AI comprehension)
 const SYSTEM_PROMPT = `I am downloading a file. Rename its filename to be helpful, concise and readable. 2-4 words.
 - IMPORTANT: If the original filename is already clear, descriptive, and human-readable, KEEP IT AS-IS. Only rename files that are messy, cryptic, or meaningless.
 - IMPORTANT: When the name contains multiple words, ALWAYS use hyphens (-) or underscores (_) as word separators, NEVER use spaces. Examples: 'Tidy-Downloads' or 'Tidy_Downloads', NOT 'Tidy Downloads'.
 - For non-informative or messy names, add context from the tab title or website.
 - Remove machine-generated cruft like IDs, (1), (copy), timestamps with seconds, etc.
- Clean up text casing and letter spacing to make it easier to read.
 - Preserve original case style for proper nouns and product names.

Some examples, in the form "original name, tab title, domain -> new name"
- 'document.pdf', 'Q3 Financial Report - Company', 'company.com' -> 'Q3-Financial-Report.pdf' (generic name, add context from tab, use hyphens)
- 'My-Project-Report-v2.docx', 'Some Random Page', 'example.com' -> 'My-Project-Report-v2.docx' (already clear, keep as-is)
- 'TidyDownloads.js', 'GitHub - repo', 'github.com' -> 'TidyDownloads.js' (already clear, keep as-is)
- 'image.png', 'Feedback: Card border radius - nateparro2t@gmail.com - Gmail', 'mail.google.com' -> 'Card-Border-Radius-Feedback.png' (remove generic 'image', add context from tab, use hyphens)
- 'folio_option3_6691488.PDF', 'Your Guest Stay Folio from the LINE LA 08-14-23', 'mail.google.com' -> 'Line-LA-Folio-Aug14.pdf' (remove ID, make readable, use hyphens)
- 'Brooklyn_Bridge_September_2022_008.jpg', 'nyc bridges - Google Images', 'images.google.com' -> 'Brooklyn-Bridge-Sept-2022.jpg' (keep useful info, clean up, remove ID, use hyphens)
- 'AdobeStock_184679416.jpg', 'ladybug - Google Images', 'images.google.com' -> 'Ladybug.jpg' (remove cruft, add info from title)
- 'CleanShot 2023-08-17 at 19.51.05@2x.png', 'dogfooding - The Browser Company - Slack', 'app.slack.com' -> 'CleanShot-Aug17-Dogfooding.png' (keep useful info, trim date, add source, use hyphens)
- 'Screenshot 2023-09-26 at 11.12.18 PM', 'DM with Nate - Twitter', 'twitter.com' -> 'Sept26-Screenshot-Nate.png' (keep useful info, trim date, add source, use hyphens)
- 'image0.png', 'Nate - Slack', 'files.slack.com' -> 'Image-Nate-Slack.png' (add info from title, add context, use hyphens)
- 'Arc-1.6.0-41215.dmg', 'Arc from The Browser Company', 'arc.net' -> 'Arc-1.6.0-41215.dmg' (already readable, keep as-is)
- 'swift-chat-main.zip', 'huggingface/swift-chat: Mac app to demonstrate swift-transformers', 'github.com' -> 'swift-chat-main.zip' (already readable, keep as-is)

Return a response using JSON, according to this schema:
\`\`\`
{
    newName: string // The new filename
}
\`\`\`
Write responses (but not JSON keys) in English.`;

  // ---------- AI Request ----------
  async function fetchAiRename({ filename, tabTitle, hostname }) {
    if (!CONFIG.enabled || !VividAI.config.apiKey) return null;
    if (
      CONFIG.skipKeywords.some(
        (kw) => filename.includes(kw) || hostname?.includes(kw)
      )
    ) {
      log.debug(`Skipping whitelist: ${filename}`);
      return null;
    }

    const userMsg = buildUserMessage({ filename, tabTitle, hostname });

    log.debug(`AI request: ${filename} → ${tabTitle} (${hostname})`);

    try {
      const { text } = await VividAI.streamChat({
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
        temperature: VividAI.config.temperature,
        maxTokens: VividAI.config.maxTokens,
        timeout: VividAI.config.timeout,
        extra: {
          response_format: { type: "text" },
          stream_options: { include_usage: true },
          thinking: { type: "disabled" },
        },
      });

      log.debug(`AI raw response: ${text}`);

      // Extract newName
      const match = /"newName"\s*:\s*"([^"]+)"/.exec(text);
      if (match) {
        const newName = match[1].trim();
        // Preserve original extension
        const ext = getExtension(filename);
        const aiExt = getExtension(newName);
        if (ext && !aiExt) {
          return `${newName}.${ext}`;
        }
        return newName;
      }

      log.warn(`Could not extract newName from AI response: ${text}`);
      return null;
    } catch (err) {
      if (err.name === "AbortError") {
        log.error(`AI request timeout (${VividAI.config.timeout}ms)`);
        showToast(`AI request timeout (${VividAI.config.timeout}ms)`, { type: "warning" });
      } else {
        log.error(`AI request failed: ${err.message}`);
        showToast(`AI request failed: ${err.message}`, {
          type: "error",
          copyText: err.message,
        });
      }
      return null;
    }
  }

  // ---------- Tab Info Fetch ----------
  function getTabInfo(tabId) {
    return new Promise((resolve) => {
      if (!tabId) return resolve({ title: null, url: null });
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resolve({ title: null, url: null });
        } else {
          resolve({ title: tab.title || null, url: tab.url || null });
        }
      });
    });
  }

  function getFocusedActiveTabInfo() {
    return new Promise((resolve) => {
      chrome.tabs.query(
        { active: true, lastFocusedWindow: true },
        (tabs = []) => {
          if (chrome.runtime.lastError || !tabs.length) {
            resolve({ title: null, url: null, id: null });
            return;
          }

          const tab = tabs[0];
          resolve({
            title: tab.title || null,
            url: tab.url || null,
            id: tab.id || null,
          });
        }
      );
    });
  }

  async function getRenameContext(downloadItem) {
    const downloadTab = await getTabInfo(downloadItem.tabId);
    const focusedTab = CONFIG.preferFocusedTabContext
      ? await getFocusedActiveTabInfo()
      : { title: null, url: null, id: null };

    const preferredTitle = focusedTab.title || downloadTab.title || null;
    const preferredUrl =
      focusedTab.url ||
      downloadTab.url ||
      downloadItem.url ||
      downloadItem.referrer ||
      "";

    return {
      hostname: getHostname(preferredUrl),
      tabTitle: extractTabTitle(preferredUrl, preferredTitle),
      contextSource: focusedTab.url
        ? `focused-tab${focusedTab.id ? `#${focusedTab.id}` : ""}`
        : downloadItem.tabId
          ? `download-tab#${downloadItem.tabId}`
          : downloadItem.url
            ? "download-url"
            : downloadItem.referrer
              ? "referrer"
              : "none",
      debug: {
        focusedTabTitle: focusedTab.title || "",
        focusedTabUrl: focusedTab.url || "",
        downloadTabTitle: downloadTab.title || "",
        downloadTabUrl: downloadTab.url || "",
      },
    };
  }

  // ---------- Core: Download Interception ----------
  // Prevent same downloadId from being processed twice
  const pendingDownloads = new Set();

  function handleDeterminingFilename(downloadItem, suggest) {
    // Prevent duplicate processing
    if (pendingDownloads.has(downloadItem.id)) {
      log.debug(`ID:${downloadItem.id} already processing, skip`);
      return false;
    }
    pendingDownloads.add(downloadItem.id);

    log.info(
      `[onDeterminingFilename] ID:${downloadItem.id} "${downloadItem.filename}"`
    );
    log.debug(
      `  URL: ${downloadItem.url}, tabId: ${downloadItem.tabId}, MIME: ${downloadItem.mime}`
    );

    // Async processing, outer sync return true tells Chrome to wait for suggest
    (async () => {
      try {
        // Skip specified extensions
        const skipExt = CONFIG.skipExtensions.map((e) => e.toLowerCase());
        const ext = getExtension(downloadItem.filename).toLowerCase();
        if (skipExt.includes(ext)) {
          log.info(`Skipping extension: .${ext}, using default name`);
          suggest({ filename: null });
          return;
        }

        const { hostname, tabTitle, contextSource, debug } =
          await getRenameContext(downloadItem);
        log.debug(
          `Metadata — source: ${contextSource}, hostname: ${hostname}, tabTitle: ${tabTitle}`
        );
        log.debug(
          `Context details — focusedTabUrl: ${debug.focusedTabUrl}, focusedTabTitle: ${debug.focusedTabTitle}, downloadTabUrl: ${debug.downloadTabUrl}, downloadTabTitle: ${debug.downloadTabTitle}`
        );

        // Request AI
        const newName = await fetchAiRename({
          filename: downloadItem.filename,
          tabTitle,
          hostname,
        });

        if (newName) {
          log.info(`AI rename: "${downloadItem.filename}" -> "${newName}"`);
          suggest({ filename: newName, conflictAction: "uniquify" });
          showToast(toastText("renamed", {
            oldName: downloadItem.filename,
            newName,
          }), { type: "success" });
        } else {
          suggest({ filename: null });
        }
      } catch (err) {
        log.error(`Processing error: ${err.message}`);
        suggest({ filename: null });
      } finally {
        pendingDownloads.delete(downloadItem.id);
      }
    })();

    // Critical: return true synchronously, Chrome waits for suggest to be called
    return true;
  }

  // ---------- Event Registration (Idempotent) ----------
  let initialized = false;
  function init() {
    if (initialized) {
      log.debug(`Already registered, skip duplicate init`);
      return;
    }
    initialized = true;

    if (typeof chrome.downloads.onDeterminingFilename !== "object") {
      log.error(`chrome.downloads.onDeterminingFilename not available`);
      return;
    }

    chrome.downloads.onDeterminingFilename.addListener(
      handleDeterminingFilename
    );
    log.info(`Registered onDeterminingFilename listener`);
  }

  // ---------- Startup ----------
  init();
})();
