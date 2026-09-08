// ==UserScript==
// @name         VividAI
// @description  Shared AI configuration loader and OpenAI-compatible API caller.
//               Provides config merging from OPFS, SSE streaming, and JSON requests.
// @version      1.0.0
// @author       PaRr0tBoY
// @website      https://github.com/PaRr0tBoY/Awesome-Vivaldi
// ==/UserScript==

/**
 * Usage:
 *   <script src="VividAI.js"></script>
 *   // window.VividAI is now available
 *
 *   // 1. Load shared config from OPFS
 *   await VividAI.loadConfig({ modKey: "askOnPage" });
 *
 *   // 2. Listen for external config updates
 *   window.addEventListener("vivaldi-mod-ai-config-updated", (e) => {
 *     VividAI.applyConfig(e.detail || {});
 *   });
 *
 *   // 3. Stream chat (SSE)
 *   const abortCtrl = new AbortController();
 *   const result = await VividAI.streamChat({
 *     messages: [{ role: "user", content: "Hello" }],
 *     signal: abortCtrl.signal,
 *     onDelta: (chunk, full) => { ... },
 *   });
 *
 *   // 4. Simple JSON request (non-streaming)
 *   const data = await VividAI.fetchJSON({
 *     messages: [{ role: "user", content: "Summarize" }],
 *     temperature: 0.2,
 *     maxTokens: 100,
 *   });
 */
(() => {
  'use strict';

  if (window.VividAI) return;

  // ── Default config ──────────────────────────────────────────
  const config = {
    apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: '',
    model: 'openrouter/free',
    fallbackModel: '',
    temperature: 0.7,
    maxTokens: 4096,
    timeout: 60000,
  };

  const DEFAULT_DIR = '.askonpage';
  const DEFAULT_FILE = 'config.json';

  let _modKey = '';

  // ── Config merge from shared OPFS JSON ─────────────────────
  // Supports: { ai: { default: {...}, overrides: { modKey: {...} } } }
  // Also supports flat: { apiEndpoint: ..., apiKey: ... }
  function applyConfig(raw) {
    if (!raw || typeof raw !== 'object') return;
    const aiRoot = raw.ai && typeof raw.ai === 'object' ? raw.ai : raw;

    // v4 schema: resolve provider by moduleProviderIds → defaultProviderId → providers[0]
    let source;
    if (aiRoot.default && typeof aiRoot.default === 'object') {
      // Legacy: { ai: { default: { apiKey, ... }, overrides: { modKey: {...} } } }
      const base = aiRoot.default;
      const override = aiRoot.overrides?.[_modKey] && typeof aiRoot.overrides[_modKey] === 'object'
        ? aiRoot.overrides[_modKey] : {};
      source = Object.assign({}, base, override);
    } else if (Array.isArray(aiRoot.providers)) {
      // v4 schema: providers[] + moduleProviderIds
      const providerId = aiRoot.moduleProviderIds?.[_modKey]
        || aiRoot.defaultProviderId
        || aiRoot.providers[0]?.id;
      source = aiRoot.providers.find(p => p.id === providerId) || aiRoot.providers[0] || {};
    } else {
      // Flat: { apiEndpoint, apiKey, ... }
      source = aiRoot;
    }

    if (typeof source.apiEndpoint === 'string') config.apiEndpoint = source.apiEndpoint.trim();
    if (typeof source.apiKey === 'string')       config.apiKey = source.apiKey.trim();
    if (typeof source.model === 'string')        config.model = source.model.trim();
    if (typeof source.fallbackModel === 'string') config.fallbackModel = source.fallbackModel.trim();
    if (typeof source.temperature === 'number')  config.temperature = source.temperature;
    if (typeof source.maxTokens === 'number')    config.maxTokens = source.maxTokens;
    if (typeof source.timeout === 'number')      config.timeout = source.timeout;
  }

  // ── Load from OPFS ─────────────────────────────────────────
  async function loadConfig(opts) {
    const dir  = opts?.dir  || DEFAULT_DIR;
    const file = opts?.file || DEFAULT_FILE;
    _modKey    = opts?.modKey || '';
    try {
      const root = await navigator.storage.getDirectory();
      const dh   = await root.getDirectoryHandle(dir, { create: true });
      const fh   = await dh.getFileHandle(file, { create: false });
      applyConfig(JSON.parse(await (await fh.getFile()).text()));
    } catch (e) { console.warn("[VividAI] loadConfig — OPFS read failed:", e?.message); }
  }

  // ── Build request headers ──────────────────────────────────
  function buildHeaders(extra) {
    return Object.assign({
      'Authorization': 'Bearer ' + config.apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/PaRr0tBoY/Awesome-Vivaldi',
      'X-Title': 'Awesome Vivaldi',
    }, extra || {});
  }

  // ── Build chat body ────────────────────────────────────────
  function buildBody(opts) {
    const body = {
      model:       opts?.model || config.model,
      stream:      Boolean(opts?.stream),
      messages:    opts?.messages || [],
    };
    const temp = opts?.temperature ?? config.temperature;
    if (temp != null) body.temperature = temp;
    const max = opts?.maxTokens ?? config.maxTokens;
    if (max != null) body.max_tokens = max;
    // Pass-through for extra fields (e.g. response_format, thinking)
    if (opts?.extra) Object.assign(body, opts.extra);
    return body;
  }

  // ── SSE stream parser ──────────────────────────────────────
  // Reads a streaming Response, calls onDelta(chunk, fullText) per content delta.
  // Returns the accumulated full text.
  async function streamSSE(response, onDelta) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let output = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data:')) continue;
        const d = t.slice(5).trim();
        if (d === '[DONE]') continue;
        try {
          const delta = JSON.parse(d).choices?.[0]?.delta?.content;
          if (delta) {
            output += delta;
            if (typeof onDelta === 'function') onDelta(delta, output);
          }
        } catch (_) { /* skip malformed */ }
      }
    }
    return output;
  }

  // ── Stream chat (SSE) ──────────────────────────────────────
  // Returns { text, response } on success, or throws.
  async function streamChat(opts) {
    if (!config.apiKey) throw new Error('AI API key not configured');

    const controller = opts?.signal ? null : new AbortController();
    const signal = opts?.signal || controller.signal;
    const timeout = opts?.timeout ?? config.timeout;
    const timer = timeout > 0 ? setTimeout(() => {
      if (controller) controller.abort();
      else if (signal.throwIfAborted) signal.throwIfAborted();
    }, timeout) : 0;

    try {
      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: buildHeaders(opts?.headers),
        body: JSON.stringify(buildBody({ ...opts, stream: true })),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error('HTTP ' + response.status + (errText ? ' — ' + errText.slice(0, 200) : ''));
      }

      const text = await streamSSE(response, opts?.onDelta);
      return { text, response };
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Non-streaming JSON request ─────────────────────────────
  // Returns the parsed JSON response (full choices object).
  async function fetchJSON(opts) {
    if (!config.apiKey) throw new Error('AI API key not configured');

    const controller = opts?.signal ? null : new AbortController();
    const signal = opts?.signal || controller.signal;
    const timeout = opts?.timeout ?? config.timeout;
    const timer = timeout > 0 ? setTimeout(() => {
      if (controller) controller.abort();
    }, timeout) : 0;

    try {
      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: buildHeaders(opts?.headers),
        body: JSON.stringify(buildBody({ ...opts, stream: false })),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error('HTTP ' + response.status + (errText ? ' — ' + errText.slice(0, 200) : ''));
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ── Public API ─────────────────────────────────────────────
  window.VividAI = Object.freeze({
    config,
    applyConfig,
    loadConfig,
    buildHeaders,
    buildBody,
    streamSSE,
    streamChat,
    fetchJSON,
  });
})();
