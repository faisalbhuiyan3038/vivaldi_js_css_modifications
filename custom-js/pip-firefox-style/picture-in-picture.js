// Firefox-style Picture-in-Picture for Vivaldi  v1.0.0
//
// Drop-in replacement for Vivaldi's internal component script:
//   <Vivaldi>\Application\<version>\resources\vivaldi\components\picture-in-picture\picture-in-picture.js
//
// What it does
//  - Hover button on videos (like stock Vivaldi) that opens an enhanced PiP window.
//  - The PiP window is a Document Picture-in-Picture window (not Chromium's native video PiP),
//    so Vivaldi's "title stuck on top of the PiP window" bug does not occur.
//  - Own controls inside PiP: play/pause, seek, progress, volume, captions (CC) toggle,
//    fullscreen / maximize toggle, back-to-tab, close. Keyboard shortcuts too.
//  - Captions: native <track> captions, and mirrored site captions (YouTube, Netflix, Prime Video,
//    Disney+, Twitch, Vimeo) like Firefox's PiP does.
//  - Auto-PiP when switching tabs (Firefox / Yandex behaviour), closes again when you come back.
//  - Right-click the hover button for settings. Alt+P toggles PiP for the best video on the page.
//
// See README.md next to this file for install steps and the required vivaldi://flags.

'use strict';

(() => {
  if (window.__vivaldiFirefoxPip) return;
  window.__vivaldiFirefoxPip = true;

  const VERSION = '1.0.0';
  const LOG = (...a) => console.debug('[FPiP]', ...a);

  // —— Constants ——
  const Z_MAX = 2147483647;
  const BUTTON_SIZE = 38;
  const BUTTON_MARGIN = 12;
  const HOVER_HIDE_MS = 2200;
  const CONTROLS_HIDE_MS = 2500;
  const SETTINGS_KEY = 'vivaldi.fpip.settings';
  const SIZE_KEY = 'vivaldi.fpip.size';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const POSITIONS = [
    'top-left', 'top-center', 'top-right',
    'mid-left', 'mid-right',
    'bot-left', 'bot-center', 'bot-right'
  ];

  // —— Settings schema (defaults + validation) ——
  const SCHEMA = {
    autoPip:             { type: 'bool', def: true },
    exitOnReturn:        { type: 'bool', def: true },
    requireAudio:        { type: 'bool', def: true },
    autoDelay:           { type: 'num', min: 0, max: 10000, step: 100, def: 300 },
    preferDocumentPip:   { type: 'bool', def: true },
    rememberPlacement:   { type: 'bool', def: true },
    pauseOnClose:        { type: 'bool', def: true },
    captionsOnByDefault: { type: 'bool', def: false },
    captionScale:        { type: 'num', min: 0.5, max: 3, step: 0.1, def: 1, range: true },
    seekInterval:        { type: 'num', min: 1, max: 120, step: 1, def: 10 },
    minDuration:         { type: 'num', min: 0, max: 86400, step: 1, def: 10 },
    minWidth:            { type: 'num', min: 50, max: 2000, step: 10, def: 200 },
    minHeight:           { type: 'num', min: 50, max: 2000, step: 10, def: 150 },
    position:            { type: 'enum', values: POSITIONS, def: 'top-right' },
    opacity:             { type: 'num', min: 0.1, max: 1, step: 0.05, def: 0.8, range: true },
    shortcut:            { type: 'str', max: 40, def: 'Alt+P' },
    blacklist:           { type: 'str', max: 10000, def: 'tiktok.com\nyoutube.com/shorts' }
  };

  function normalize(raw) {
    const out = {};
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const [k, s] of Object.entries(SCHEMA)) {
      const has = Object.prototype.hasOwnProperty.call(src, k);
      const v = has ? src[k] : undefined;
      switch (s.type) {
        case 'bool':
          out[k] = typeof v === 'boolean' ? v : s.def;
          break;
        case 'num': {
          const n = Number(v);
          out[k] = v !== undefined && v !== null && v !== '' && Number.isFinite(n)
            ? Math.min(s.max, Math.max(s.min, n)) : s.def;
          break;
        }
        case 'enum':
          out[k] = s.values.includes(v) ? v : s.def;
          break;
        case 'str':
          out[k] = typeof v === 'string' ? v.slice(0, s.max) : s.def;
          break;
      }
    }
    return out;
  }

  let S = normalize(null);
  let sizeCache = null;

  // —— Storage: chrome.storage.local (shared by all sites) → localStorage (per site) → memory ——
  const Store = {
    backend: 'memory',
    mem: {},
    chromeArea() {
      try {
        return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
      } catch (_) { return null; }
    },
    call(area, method, arg) {
      return new Promise((resolve, reject) => {
        try {
          const p = area[method](arg, (r) => {
            const err = chrome.runtime && chrome.runtime.lastError;
            err ? reject(err) : resolve(r);
          });
          if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) { reject(e); }
      });
    },
    async get(key) {
      const area = this.chromeArea();
      if (area) {
        try {
          const r = await this.call(area, 'get', key);
          this.backend = 'chrome';
          return r && r[key] !== undefined ? r[key] : null;
        } catch (_) { /* fall through */ }
      }
      try {
        const s = localStorage.getItem(key);
        this.backend = 'local';
        return s ? JSON.parse(s) : null;
      } catch (_) { /* fall through */ }
      this.backend = 'memory';
      return this.mem[key] ?? null;
    },
    async set(key, val) {
      if (this.backend === 'chrome') {
        try { await this.call(this.chromeArea(), 'set', { [key]: val }); return; } catch (_) { /* fall through */ }
      }
      if (this.backend !== 'memory') {
        try { localStorage.setItem(key, JSON.stringify(val)); return; } catch (_) { /* fall through */ }
      }
      this.mem[key] = val;
    }
  };

  function validSize(v) {
    if (!v || typeof v !== 'object') return null;
    const w = Number(v.w), h = Number(v.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (w < 150 || h < 90 || w > 5000 || h > 5000) return null;
    return { w: Math.round(w), h: Math.round(h) };
  }

  // —— Icons (Material icon paths; built with createElementNS — no innerHTML, Trusted-Types safe) ——
  const ICONS = {
    pip: 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    rewind: 'M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z',
    forward: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
    volume: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    muted: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
    cc: 'M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z',
    fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
    fullscreenExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
    backToTab: 'M21 3.01H3c-1.1 0-2 .9-2 2V9h2V4.99h18v14.03H3V15H1v4.01c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98v-14a2 2 0 0 0-2-2zM11 16l4-4-4-4v3H1v2h10v3z',
    close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
  };

  function icon(doc, name) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function setIcon(button, name) {
    const path = button.querySelector('path');
    if (path) path.setAttribute('d', ICONS[name]);
  }

  // Tiny DOM builder (no innerHTML).
  function h(doc, tag, props, ...kids) {
    const el = doc.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'object' ? c : doc.createTextNode(String(c)));
    }
    return el;
  }

  // —— Helpers ——
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  function fmtTime(t) {
    if (!Number.isFinite(t)) return '--:--';
    t = Math.max(0, Math.floor(t));
    const hh = Math.floor(t / 3600);
    const mm = Math.floor((t % 3600) / 60);
    const ss = String(t % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }

  function isBlacklisted() {
    const here = (location.hostname + location.pathname).toLowerCase();
    return S.blacklist.split('\n')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .some((entry) => here.includes(entry));
  }

  function comboFromEvent(e) {
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return null;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    let key;
    if (e.code && e.code.startsWith('Key')) key = e.code.slice(3);
    else if (e.code && e.code.startsWith('Digit')) key = e.code.slice(5);
    else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(key);
    return parts.join('+');
  }

  // —— Video discovery ——
  const getVideos = () => Array.from(document.querySelectorAll('video'));
  const area = (v) => { const r = v.getBoundingClientRect(); return r.width * r.height; };

  function isEligible(v, { forAuto = false } = {}) {
    if (!v || !v.isConnected || v.readyState < 1) return false;
    const d = v.duration;
    if (Number.isFinite(d) && d > 0 && d < S.minDuration) return false;
    const r = v.getBoundingClientRect();
    if (r.width < S.minWidth || r.height < S.minHeight) return false;
    if (forAuto) {
      if (v.paused || v.ended) return false;
      if (S.requireAudio && (v.muted || v.volume === 0)) return false;
    }
    return true;
  }

  function isOnScreen(v) {
    const r = v.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < window.innerHeight && r.left < window.innerWidth;
  }

  const largest = (list) => list.sort((a, b) => area(b) - area(a))[0] || null;

  function findVideoAt(x, y) {
    return largest(getVideos().filter((v) => {
      const r = v.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && isEligible(v);
    }));
  }

  function findAutoVideo() {
    return largest(getVideos().filter((v) => isEligible(v, { forAuto: true })));
  }

  function findBestVideo() {
    const videos = getVideos().filter((v) => isEligible(v));
    const playing = videos.filter((v) => !v.paused && !v.ended);
    if (playing.length) return largest(playing);
    if (Hover.video && Hover.video.isConnected) return Hover.video;
    return largest(videos.filter(isOnScreen));
  }

  // —— Site caption mirroring rules (like Firefox's per-site PiP wrappers) ——
  //  root:   player container to observe (scoped to the video when possible)
  //  lines:  elements whose text is one or more caption lines
  //  toggle: the site's own CC button (aria-pressed="true|false"), clicked to turn captions on/off
  const SITE_CAPTIONS = [
    {
      host: /(^|\.)youtube(-nocookie)?\.com$/,
      root: '#movie_player, .html5-video-player',
      lines: '.ytp-caption-window-container .caption-visual-line',
      toggle: '.ytp-subtitles-button'
    },
    {
      host: /(^|\.)netflix\.com$/,
      root: '.watch-video, .NFPlayer',
      lines: '.player-timedtext-text-container'
    },
    {
      host: /(^|\.)(primevideo\.com|amazon\.[a-z.]+)$/,
      root: '.webPlayerSDKContainer, .webPlayerUIContainer',
      lines: '.atvwebplayersdk-captions-text'
    },
    {
      host: /(^|\.)disneyplus\.com$/,
      root: null,
      lines: '.dss-subtitle-renderer-line'
    },
    {
      host: /(^|\.)twitch\.tv$/,
      root: '.video-player',
      lines: '[data-a-target="player-captions-text"]'
    },
    {
      host: /(^|\.)vimeo\.com$/,
      root: '.vp-player-layout, .player',
      lines: '.vp-captions > span, .vp-captions-line'
    }
  ];

  class Captions {
    constructor(session, video) {
      this.s = session;
      this.video = video;
      this.on = false;
      this.rule = SITE_CAPTIONS.find((r) => r.host.test(location.hostname)) || null;
      // Resolve the root *before* the video is moved into the PiP window.
      this.root = (this.rule && this.rule.root && (video.closest(this.rule.root) || document.querySelector(this.rule.root))) ||
        document.body;
      this.weEnabledSite = false;
      this.mo = null;
      this.pending = false;
      this.lastKey = '';
      this.track = null;
    }

    nativeTracks() {
      return Array.from(this.video.textTracks || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
    }

    siteToggle() {
      if (!this.rule || !this.rule.toggle) return null;
      return this.root.querySelector(this.rule.toggle) || document.querySelector(this.rule.toggle);
    }

    sitePressed() {
      const b = this.siteToggle();
      return !!b && b.getAttribute('aria-pressed') === 'true';
    }

    readLines() {
      if (!this.rule) return [];
      const out = [];
      this.root.querySelectorAll(this.rule.lines).forEach((el) => {
        (el.innerText || el.textContent || '').split('\n').forEach((line) => {
          line = line.trim();
          if (line) out.push(line);
        });
      });
      return out;
    }

    available() {
      return !!this.rule || this.nativeTracks().length > 0;
    }

    // 'site'  → copy the site's own caption text (YouTube has a CC button we can press; Netflix & co. have no
    //           native tracks at all).
    // 'native'→ show the video's own text tracks (Vimeo, Twitch, kisskh and generic players keep their subtitles
    //           as native tracks, often in "hidden" mode while the site draws them itself).
    source() {
      const hasTracks = this.nativeTracks().length > 0;
      if (this.rule && (this.rule.toggle || !hasTracks)) return 'site';
      if (hasTracks) return 'native';
      return this.rule ? 'site' : 'none';
    }

    initialState() {
      if (this.rule && (this.sitePressed() || this.readLines().length)) return true;
      if (this.nativeTracks().some((t) => t.mode === 'showing')) return true;
      return S.captionsOnByDefault;
    }

    // Prefer a track that actually has cues, then one backed by a <track> element (its VTT loads once the
    // track is enabled), then anything else; within each group prefer the browser's language.
    // (Vimeo keeps empty "hidden" placeholder tracks next to the real, disabled <track> subtitles.)
    pickTrack(tracks) {
      const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
      const byLang = (t) => (t.language || '').toLowerCase().startsWith(lang);
      const hasCues = (t) => !!(t.cues && t.cues.length);
      const elementTracks = new Set(Array.from(this.video.querySelectorAll('track')).map((el) => el.track));
      const backed = (t) => elementTracks.has(t);
      const showing = tracks.find((t) => t.mode === 'showing' && hasCues(t));
      if (showing) return showing;
      if (this.track && (hasCues(this.track) || backed(this.track))) return this.track;
      for (const ok of [hasCues, backed, () => true]) {
        const group = tracks.filter(ok);
        const pick = group.find(byLang) || group[0];
        if (pick) return pick;
      }
      return tracks[0];
    }

    set(on) {
      this.on = on;
      const source = this.source();
      if (source === 'native') {
        const tracks = this.nativeTracks();
        if (!this.savedModes) this.savedModes = new Map(tracks.map((t) => [t, t.mode]));
        if (on) {
          const pick = this.pickTrack(tracks);
          tracks.forEach((t) => { if (t !== pick && t.mode === 'showing') t.mode = 'hidden'; });
          pick.mode = 'showing';
          this.track = pick;
        } else {
          tracks.forEach((t) => { if (t.mode === 'showing') { this.track = t; t.mode = 'hidden'; } });
        }
      } else if (source === 'site') {
        const b = this.siteToggle();
        if (b && b.getAttribute('aria-disabled') !== 'true') {
          const pressed = b.getAttribute('aria-pressed') === 'true';
          if (on && !pressed) { b.click(); this.weEnabledSite = true; }
          else if (!on && pressed && this.weEnabledSite) { b.click(); this.weEnabledSite = false; }
        }
        if (on) {
          this.startMirror();
          this.s.win.setTimeout(() => {
            if (!this.on || this.lastKey) return;
            if (this.siteToggle() && !this.sitePressed()) this.s.toast('No captions available for this video');
            else if (!this.siteToggle()) this.s.toast('No captions showing — turn them on in the site\'s player');
          }, 1500);
        } else {
          this.stopMirror();
        }
      } else if (on) {
        this.on = false;
        this.s.toast('No captions found for this video');
      }
      this.s.updateCC();
    }

    startMirror() {
      if (this.mo) return;
      this.mo = new MutationObserver(() => this.schedule());
      this.mo.observe(this.root, { childList: true, subtree: true, characterData: true });
      this.render();
    }

    stopMirror() {
      if (this.mo) this.mo.disconnect();
      this.mo = null;
      this.lastKey = '';
      if (this.s.capEl) this.s.capEl.replaceChildren();
    }

    schedule() {
      if (this.pending) return;
      this.pending = true;
      // The PiP window stays visible (and its rAF keeps running) while the source tab is hidden.
      this.s.win.requestAnimationFrame(() => { this.pending = false; this.render(); });
    }

    render() {
      if (!this.on || !this.s.capEl) return;
      const lines = this.readLines();
      const key = lines.join('\n');
      if (key === this.lastKey) return;
      this.lastKey = key;
      const d = this.s.doc;
      this.s.capEl.replaceChildren(...lines.map((l) => h(d, 'div', null, h(d, 'span', { text: l }))));
    }

    teardown() {
      this.stopMirror();
      // Put the site's own caption setting back the way the user had it.
      if (this.weEnabledSite && this.sitePressed()) {
        try { this.siteToggle().click(); } catch (_) { /* ignore */ }
      }
      this.weEnabledSite = false;
      // Native tracks go back to the modes the site had set (sites that draw captions themselves keep them
      // "hidden"; leaving them "showing" would double the captions in the page).
      if (this.savedModes) {
        this.savedModes.forEach((mode, t) => { try { t.mode = mode; } catch (_) { /* ignore */ } });
        this.savedModes = null;
      }
    }
  }

  // —— Player stylesheet (PiP window document, or the fullscreen-window overlay's shadow root) ——
  // Everything hangs off .fp-root: the PiP window's <body>, or a <div> inside the overlay.
  const PIP_CSS = `
    *{box-sizing:border-box}
    html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
    .fp-root{color:#fff;font:13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;user-select:none}
    .fp-root:not(.show-ui){cursor:none}
    .stage{position:fixed;inset:0;background:#000}
    .stage video{position:absolute!important;inset:0!important;left:0!important;top:0!important;
      width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;
      margin:0!important;padding:0!important;transform:none!important;object-fit:contain!important;
      display:block!important;visibility:visible!important;opacity:1!important;background:#000}
    video::cue{font-size:calc(var(--cap-scale,1) * clamp(12px,5.2vh,64px));background:rgba(8,8,8,.78)}
    video::-webkit-media-text-track-container{transition:transform .2s ease}
    .fp-root.show-ui video::-webkit-media-text-track-container{transform:translateY(-74px)}
    .ui{position:fixed;inset:0;opacity:0;transition:opacity .2s ease;pointer-events:none}
    .fp-root.show-ui .ui{opacity:1}
    .fp-root.show-ui .ui button, .fp-root.show-ui .ui input{pointer-events:auto}
    .shade-top{position:absolute;top:0;left:0;right:0;height:60px;background:linear-gradient(rgba(0,0,0,.55),transparent)}
    .shade-bottom{position:absolute;bottom:0;left:0;right:0;height:96px;background:linear-gradient(transparent,rgba(0,0,0,.7))}
    .top{position:absolute;top:6px;right:6px;display:flex;gap:4px}
    .center{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:flex;gap:18px;align-items:center}
    .bottom{position:absolute;left:8px;right:8px;bottom:6px;display:flex;flex-direction:column;gap:2px}
    .row{display:flex;align-items:center;gap:4px}
    .spacer{flex:1}
    button{all:unset;position:relative;cursor:pointer;width:32px;height:32px;flex:none;display:inline-flex;
      align-items:center;justify-content:center;border-radius:50%;color:#fff;transition:background .15s}
    button:hover{background:rgba(255,255,255,.18)}
    button:focus-visible{outline:2px solid #ef3939}
    button svg{width:22px;height:22px;fill:currentColor;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))}
    button.big{width:54px;height:54px;background:rgba(0,0,0,.45)}
    button.big svg{width:34px;height:34px}
    button.med{width:42px;height:42px;background:rgba(0,0,0,.35)}
    button.med svg{width:26px;height:26px}
    button.cc.on::after{content:"";position:absolute;left:8px;right:8px;bottom:4px;height:2px;border-radius:1px;background:#ef3939}
    button.unavailable{opacity:.4}
    input[type=range]{accent-color:#ef3939;margin:0;cursor:pointer;height:16px}
    .progress{width:100%}
    .progress[hidden]{display:none}
    .vol{width:72px}
    .time{font-variant-numeric:tabular-nums;font-size:12px;opacity:.92;padding:0 6px;white-space:nowrap;
      text-shadow:0 1px 2px rgba(0,0,0,.8)}
    .fp-root.compact .vol, .fp-root.compact .center .med{display:none}
    .fp-root.tiny .time{display:none}
    .captions{position:fixed;left:4%;right:4%;bottom:5%;display:flex;flex-direction:column;align-items:center;gap:.12em;
      pointer-events:none;text-align:center;line-height:1.25;transition:bottom .2s ease;
      font-size:calc(var(--cap-scale,1) * clamp(12px,5.2vh,64px))}
    .fp-root.show-ui .captions{bottom:78px}
    .captions span{background:rgba(8,8,8,.78);padding:.05em .35em;border-radius:3px;white-space:pre-wrap;
      -webkit-box-decoration-break:clone;box-decoration-break:clone}
    .toast{position:fixed;top:10px;left:50%;transform:translateX(-50%);background:rgba(20,20,20,.9);padding:6px 12px;
      border-radius:4px;border-left:3px solid #ef3939;opacity:0;transition:opacity .2s;pointer-events:none;white-space:nowrap}
    .toast.show{opacity:1}
  `;

  // Extra rules for the fullscreen-window overlay (shadow root inside the page).
  const WINDOW_CSS = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:${Z_MAX}!important;display:block!important}
    .fp-root{position:fixed;inset:0;background:#000}
    .fp-root .stage{z-index:0}
    .fp-root .top, .fp-root .center, .fp-root .bottom, .fp-root .toast{zoom:1.4}
    .fp-root .shade-bottom{height:140px}
    .fp-root.show-ui .captions{bottom:120px}
    .fp-root.show-ui video::-webkit-media-text-track-container{transform:translateY(-110px)}
  `;

  // —— Bridge to the Vivaldi UI helper (pip-window-helper.js in window.html) ——
  // The PiP component is its own internal extension; Vivaldi's UI is another one. Cross-extension messaging
  // (sendMessage(UI id) → onMessageExternal) reaches the helper, which can move tabs/windows between monitors.
  const UI_EXT_ID = 'mpognobbkildjkofajifpdfhcoklimli';
  const Helper = {
    present: null,
    ask(msg, timeout = 4000) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
        const t = setTimeout(() => finish(null), timeout);
        try {
          chrome.runtime.sendMessage(UI_EXT_ID, msg, (reply) => {
            void (chrome.runtime && chrome.runtime.lastError);
            finish(reply || null);
          });
        } catch (_) { finish(null); }
      });
    },
    async available() {
      if (this.present === true) return true;
      const r = await this.ask({ fpip: 'ping' }, 800);
      this.present = !!(r && r.ok);
      if (!this.present) LOG('UI helper not found (install pip-window-helper.js for fullscreen on any monitor)');
      return this.present;
    }
  };

  // —— Player session: the PiP window ('pip') or the fullscreen browser window ('window') ——
  let session = null;
  let opening = false;

  class PlayerSession {
    static async open(video, auto) {
      const size = sizeCache || PlayerSession.defaultSize(video);
      const win = await window.documentPictureInPicture.requestWindow({ width: size.w, height: size.h });
      const s = new PlayerSession('pip', win, video, auto);
      session = s;
      s.mount();
      return s;
    }

    // Move the tab into its own fullscreen window on the given screen (via the UI helper) and show the video
    // there with the same controls as the PiP window.
    static async openFullWindow(video, screenRect) {
      const s = new PlayerSession('window', window, video, false);
      session = s;
      s.mount();
      const r = await Helper.ask({ fpip: 'enterFullscreen', screen: screenRect });
      if (!r || !r.ok) {
        LOG('UI helper could not open the fullscreen window:', r && r.error);
        s.close('error');
        Hover.toast('Could not open a fullscreen window');
        return null;
      }
      s.uiState = { origWindowId: r.origWindowId, origIndex: r.origIndex };
      LOG('Fullscreen window opened on screen', JSON.stringify(screenRect));
      return s;
    }

    static defaultSize(video) {
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const w = 480;
      return { w, h: clamp(Math.round((w * vh) / vw), 150, 900) };
    }

    constructor(mode, win, video, auto) {
      this.mode = mode;
      this.win = win;
      this.doc = win.document;
      this.video = video;
      this.uiState = null;
      this.auto = auto;
      this.closeReason = null;
      this.restored = false;
      this.maximized = false;
      this.prevSize = null;
      this.seeking = false;
      this.cleanup = [];
      this.captions = new Captions(this, video);
    }

    on(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      this.cleanup.push(() => target.removeEventListener(type, fn, opts));
    }

    mount() {
      const { win, doc, video } = this;
      const wasPlaying = !video.paused;

      // Leave a placeholder where the video was, so we can put it back exactly.
      const r = video.getBoundingClientRect();
      const cs = getComputedStyle(video);
      const ph = this.placeholder = document.createElement('div');
      ph.className = 'vivaldi-fpip-placeholder';
      ph.style.cssText =
        `width:${r.width || video.offsetWidth}px;height:${r.height || video.offsetHeight}px;` +
        `position:${cs.position === 'absolute' ? 'absolute' : 'relative'};top:${cs.top};left:${cs.left};` +
        'background:#000;display:flex;align-items:center;justify-content:center;' +
        'color:#bbb;font:14px system-ui,sans-serif;';
      ph.textContent = this.mode === 'pip' ? 'This video is playing in picture-in-picture' : '';
      ph.addEventListener('click', () => this.close('back'));
      this.parent = video.parentNode;
      this.next = video.nextSibling;
      if (this.parent) this.parent.insertBefore(ph, video);

      // Build the player UI: in the PiP document, or in a full-viewport overlay (shadow DOM) in the page.
      const style = doc.createElement('style');
      if (this.mode === 'pip') {
        doc.title = document.title || location.hostname;
        style.textContent = PIP_CSS;
        doc.head.appendChild(style);
        this.root = doc.body;
        this.scope = doc;
      } else {
        this.host = doc.createElement('div');
        this.host.id = 'vivaldi-fpip-fullwindow';
        const shadow = this.host.attachShadow({ mode: 'closed' });
        style.textContent = PIP_CSS + WINDOW_CSS;
        shadow.appendChild(style);
        this.root = doc.createElement('div');
        shadow.appendChild(this.root);
        this.scope = shadow;
        doc.documentElement.appendChild(this.host);
        // A fixed overlay can't cover the page's scrollbar: hide page scrolling while fullscreen.
        this.prevOverflow = doc.documentElement.style.getPropertyValue('overflow');
        this.prevOverflowPrio = doc.documentElement.style.getPropertyPriority('overflow');
        doc.documentElement.style.setProperty('overflow', 'hidden', 'important');
      }
      this.root.classList.add('fp-root');
      this.root.style.setProperty('--cap-scale', String(S.captionScale));

      const btn = (name, title, cls, onClick) =>
        h(doc, 'button', { class: cls || null, title, 'aria-label': title, onclick: (e) => { e.stopPropagation(); e.currentTarget.blur(); onClick(); } },
          icon(doc, name));

      this.stage = h(doc, 'div', { class: 'stage' });
      this.capEl = h(doc, 'div', { class: 'captions', 'aria-live': 'polite' });
      this.toastEl = h(doc, 'div', { class: 'toast' });

      this.btnBigPlay = btn('play', 'Play / pause (Space)', 'big', () => this.togglePlay());
      this.btnPlay = btn('play', 'Play / pause (Space)', null, () => this.togglePlay());
      this.btnMute = btn('volume', 'Mute (M)', null, () => this.toggleMute());
      this.btnCC = btn('cc', 'Captions (C)', 'cc', () => this.toggleCaptions());
      this.btnFs = btn('fullscreen', 'Fullscreen (F / double-click)', null, () => this.toggleFullscreen());
      this.progress = h(doc, 'input', { class: 'progress', type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Seek' });
      this.volume = h(doc, 'input', { class: 'vol', type: 'range', min: 0, max: 1, step: 0.05, 'aria-label': 'Volume' });
      this.timeEl = h(doc, 'span', { class: 'time' });

      const ui = h(doc, 'div', { class: 'ui' },
        h(doc, 'div', { class: 'shade-top' }),
        h(doc, 'div', { class: 'shade-bottom' }),
        h(doc, 'div', { class: 'top' },
          btn('backToTab', 'Back to tab', null, () => this.close('back')),
          btn('close', 'Close', null, () => this.close('close'))),
        h(doc, 'div', { class: 'center' },
          btn('rewind', `Back ${S.seekInterval}s (←)`, 'med', () => this.seek(-S.seekInterval)),
          this.btnBigPlay,
          btn('forward', `Forward ${S.seekInterval}s (→)`, 'med', () => this.seek(S.seekInterval))),
        h(doc, 'div', { class: 'bottom' },
          h(doc, 'div', { class: 'row' }, this.progress),
          h(doc, 'div', { class: 'row' },
            this.btnPlay, this.timeEl, h(doc, 'span', { class: 'spacer' }),
            this.btnMute, this.volume, this.btnCC, this.btnFs)));

      this.root.append(this.stage, this.capEl, ui, this.toastEl);

      // Move the real video element into the player.
      this.stage.appendChild(video);
      if (wasPlaying && video.paused) video.play().catch(() => {});

      this.bindEvents();
      this.updateAll();
      this.onResize();
      this.captions.set(this.captions.initialState());
      this.showUi();
      if (this.mode === 'pip') {
        LOG('Document PiP opened', this.auto ? '(auto)' : '');
        this.trackPlacement();
      }
    }

    // Placement memory (UI helper): move this PiP window to where the user last left one, and keep track of the
    // monitor it's on so the helper can remember it when the window closes.
    screenRect() {
      try {
        const s = this.win.screen;
        return { left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight };
      } catch (_) { return this.lastScreen || null; }
    }

    async trackPlacement() {
      const { win } = this;
      this.lastScreen = this.screenRect();
      this.screenTimer = win.setInterval(() => { this.lastScreen = this.screenRect(); }, 1000);
      const r = await Helper.ask({ fpip: 'pipOpened', remember: S.rememberPlacement }, 3000);
      if (!r || !r.moved || this.restored) return;
      // If the remembered monitor is gone, the window ends up on some other screen: put it bottom-right there.
      // The window's screen info updates a little after the move, so give it up to ~2 s to arrive.
      const want = r.screen;
      const same = (a) => a && Math.abs(a.left - want.left) < 2 && Math.abs(a.top - want.top) < 2 &&
        Math.abs(a.width - want.width) < 2;
      let tries = 0;
      const check = () => {
        if (this.restored) return;
        const now = this.screenRect();
        if (same(now)) return;
        if (++tries < 8) { win.setTimeout(check, 250); return; }
        LOG('Remembered monitor not available, resetting PiP position');
        Helper.ask({ fpip: 'pipReset', screen: now });
      };
      win.setTimeout(check, 250);
    }

    bindEvents() {
      const { win, doc, video } = this;
      const isPip = this.mode === 'pip';

      if (isPip) {
        this.on(win, 'pagehide', () => this.restore());
      } else {
        this.on(win, 'pagehide', () => this.close('navigate'));
      }
      this.on(win, 'resize', () => this.onResize());

      ['play', 'pause', 'ended'].forEach((t) => this.on(video, t, () => this.updatePlay()));
      ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked'].forEach((t) => this.on(video, t, () => this.updateTime()));
      this.on(video, 'volumechange', () => this.updateVolume());
      if (video.textTracks) {
        this.on(video.textTracks, 'addtrack', () => this.updateCC());
        this.on(video.textTracks, 'removetrack', () => this.updateCC());
      }

      this.on(this.progress, 'input', () => {
        this.seeking = true;
        const d = video.duration;
        if (Number.isFinite(d)) video.currentTime = (this.progress.value / 1000) * d;
        this.timeEl.textContent = `${fmtTime(video.currentTime)} / ${fmtTime(video.duration)}`;
      });
      this.on(this.progress, 'change', () => { this.seeking = false; this.progress.blur(); });
      this.on(this.volume, 'input', () => {
        video.volume = Number(this.volume.value);
        video.muted = video.volume === 0;
      });
      this.on(this.volume, 'change', () => this.volume.blur());

      // Single click = play/pause, double click = fullscreen/maximize.
      this.clickTimer = 0;
      this.on(this.stage, 'click', () => {
        if (this.clickTimer) {
          win.clearTimeout(this.clickTimer);
          this.clickTimer = 0;
          this.toggleFullscreen();
          return;
        }
        this.clickTimer = win.setTimeout(() => { this.clickTimer = 0; this.togglePlay(); }, 230);
      });

      this.on(doc, 'mousemove', () => this.showUi(), true);
      this.on(doc.documentElement, 'mouseleave', () => {
        win.clearTimeout(this.hideTimer);
        this.hideTimer = win.setTimeout(() => this.hideUi(), 400);
      });
      this.on(doc, 'fullscreenchange', () => this.updateFs());
      // In the page overlay, catch keys before the site's own player shortcuts do.
      this.on(isPip ? doc : win, 'keydown', (e) => this.onKey(e), !isPip);
      this.on(isPip ? doc : this.root, 'wheel', (e) => {
        e.preventDefault();
        this.setVolume(video.volume + (e.deltaY < 0 ? 0.05 : -0.05));
      }, { passive: false });
    }

    onKey(e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const v = this.video;
      if (this.mode === 'window' && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close('pip');
        return;
      }
      switch (e.key) {
        case ' ': case 'k': case 'K': this.togglePlay(); break;
        case 'ArrowLeft': this.seek(-S.seekInterval); break;
        case 'ArrowRight': this.seek(S.seekInterval); break;
        case 'ArrowUp': this.setVolume(v.volume + 0.1); break;
        case 'ArrowDown': this.setVolume(v.volume - 0.1); break;
        case 'm': case 'M': this.toggleMute(); break;
        case 'c': case 'C': this.toggleCaptions(); break;
        case 'f': case 'F': this.toggleFullscreen(); break;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.showUi();
    }

    // —— Actions ——
    togglePlay() {
      const v = this.video;
      if (v.paused || v.ended) v.play().catch(() => {});
      else v.pause();
    }

    seek(delta) {
      const v = this.video;
      let t = v.currentTime + delta;
      if (Number.isFinite(v.duration)) t = clamp(t, 0, v.duration);
      else if (v.seekable && v.seekable.length) t = clamp(t, v.seekable.start(0), v.seekable.end(v.seekable.length - 1));
      v.currentTime = Math.max(0, t);
      this.toast(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}s`);
    }

    setVolume(val) {
      const v = this.video;
      v.volume = clamp(Math.round(val * 100) / 100, 0, 1);
      v.muted = v.volume === 0;
      this.toast(`Volume ${Math.round(v.volume * 100)}%`);
    }

    toggleMute() {
      const v = this.video;
      if (v.muted || v.volume === 0) {
        v.muted = false;
        if (v.volume === 0) v.volume = 0.5;
      } else {
        v.muted = true;
      }
    }

    toggleCaptions() {
      this.captions.set(!this.captions.on);
      this.toast(this.captions.on ? 'Captions on' : 'Captions off');
    }

    // Chromium refuses fullscreen inside a document PiP window ("Fullscreen is not supported"), even via
    // chrome.windows, and caps the window at roughly half the screen. So, like Firefox/Yandex, "fullscreen" opens
    // the video fullscreen on the monitor the PiP window is on: the UI helper moves the tab into its own
    // fullscreen window there, and the video fills it with these same controls. Pressing it again (or Esc)
    // sends the tab back where it was and the video drops back into PiP.
    // Without the helper: maximize the PiP window as far as the browser allows.
    async toggleFullscreen() {
      const { doc, win } = this;
      if (this.mode === 'window') return this.close('pip');
      if (doc.fullscreenElement) {
        await doc.exitFullscreen().catch(() => {});
        return this.updateFs();
      }
      if (this.maximized) return this.restoreSize();

      if (await Helper.available()) {
        const sc = win.screen;
        const rect = { left: sc.availLeft, top: sc.availTop, width: sc.availWidth, height: sc.availHeight };
        const v = this.video;
        this.close('fullscreen');
        PlayerSession.openFullWindow(v, rect);
        return;
      }

      this.prevSize = { w: win.outerWidth, h: win.outerHeight };
      try {
        win.resizeTo(win.screen.availWidth, win.screen.availHeight);
        this.maximized = true;
        this.toast('Maximized — install the UI helper for real fullscreen');
      } catch (e) {
        this.prevSize = null;
        this.toast('Could not resize the PiP window');
        LOG('resizeTo failed:', e && e.message);
      }
      this.updateFs();
    }

    restoreSize() {
      if (this.prevSize) {
        try { this.win.resizeTo(this.prevSize.w, this.prevSize.h); } catch (_) { /* ignore */ }
      }
      this.prevSize = null;
      this.maximized = false;
      this.updateFs();
    }

    // —— UI state ——
    showUi() {
      const { win } = this;
      this.root.classList.add('show-ui');
      win.clearTimeout(this.hideTimer);
      this.hideTimer = win.setTimeout(() => this.hideUi(), CONTROLS_HIDE_MS);
    }

    hideUi() {
      if (this.video.paused) return;
      if (this.scope.querySelector('.top:hover, .bottom:hover, .center button:hover')) {
        this.hideTimer = this.win.setTimeout(() => this.hideUi(), CONTROLS_HIDE_MS);
        return;
      }
      this.root.classList.remove('show-ui');
    }

    toast(text) {
      if (!this.toastEl) return;
      this.toastEl.textContent = text;
      this.toastEl.classList.add('show');
      this.win.clearTimeout(this.toastTimer);
      this.toastTimer = this.win.setTimeout(() => this.toastEl.classList.remove('show'), 1300);
    }

    updateAll() {
      this.updatePlay();
      this.updateTime();
      this.updateVolume();
      this.updateCC();
      this.updateFs();
    }

    updatePlay() {
      const paused = this.video.paused || this.video.ended;
      setIcon(this.btnPlay, paused ? 'play' : 'pause');
      setIcon(this.btnBigPlay, paused ? 'play' : 'pause');
      if (paused) {
        this.root.classList.add('show-ui');
        this.win.clearTimeout(this.hideTimer);
      } else {
        this.showUi();
      }
    }

    updateTime() {
      const v = this.video;
      const live = !Number.isFinite(v.duration);
      this.progress.hidden = live;
      if (!live && !this.seeking) {
        this.progress.value = v.duration ? String(Math.round((v.currentTime / v.duration) * 1000)) : '0';
      }
      this.timeEl.textContent = live ? 'LIVE' : `${fmtTime(v.currentTime)} / ${fmtTime(v.duration)}`;
    }

    updateVolume() {
      const v = this.video;
      const silent = v.muted || v.volume === 0;
      setIcon(this.btnMute, silent ? 'muted' : 'volume');
      this.volume.value = String(silent ? 0 : v.volume);
    }

    updateCC() {
      if (!this.btnCC) return;
      const avail = this.captions.available();
      this.btnCC.classList.toggle('on', this.captions.on);
      this.btnCC.classList.toggle('unavailable', !avail);
      this.btnCC.title = avail ? `Captions ${this.captions.on ? 'on' : 'off'} (C)` : 'No captions found (C)';
    }

    updateFs() {
      const active = this.mode === 'window' || !!this.doc.fullscreenElement || this.maximized;
      setIcon(this.btnFs, active ? 'fullscreenExit' : 'fullscreen');
      this.btnFs.title = this.mode === 'window' ? 'Back to picture-in-picture (F / Esc / double-click)'
        : active ? 'Restore size (F / double-click)' : 'Fullscreen on this monitor (F / double-click)';
    }

    onResize() {
      const { win, doc } = this;
      this.root.classList.toggle('compact', win.innerWidth < 340);
      this.root.classList.toggle('tiny', win.innerWidth < 240);
      if (this.mode !== 'pip') return;
      win.clearTimeout(this.sizeTimer);
      this.sizeTimer = win.setTimeout(() => {
        if (this.restored || this.maximized || doc.fullscreenElement) return;
        const sz = validSize({ w: win.innerWidth, h: win.innerHeight });
        if (sz) { sizeCache = sz; Store.set(SIZE_KEY, sz); }
      }, 500);
    }

    // —— Closing ——
    close(reason) {
      if (this.closeReason === null) this.closeReason = reason;
      if (this.mode === 'window') {
        if (this.restored) return;
        this.restore();
        // Send the tab back to where it came from. Unless it's "back to tab", it returns as a background tab, so
        // Chromium's auto-PiP picks the (still playing) video up again.
        if (this.uiState) {
          const back = reason === 'back';
          if (back) Auto.suppressUntil = Date.now() + 2500; // don't flash PiP up while the tab is being activated
          Helper.ask({ fpip: 'exitFullscreen', ...this.uiState }).then((r) => {
            if (!r || !r.ok) LOG('UI helper could not move the tab back:', r && r.error);
            if (back) setTimeout(() => Helper.ask({ fpip: 'activateTab' }), 300);
          });
        }
        return;
      }
      if (reason === 'back') { try { window.focus(); } catch (_) { /* ignore */ } }
      try { this.win.close(); } catch (_) { /* ignore */ }
      this.restore();
    }

    restore() {
      if (this.restored) return;
      this.restored = true;
      const v = this.video;
      const playing = !v.paused && !v.ended;
      if (this.mode === 'pip') {
        if (this.screenTimer) { try { this.win.clearInterval(this.screenTimer); } catch (_) { /* window gone */ } }
        const cur = this.screenRect();
        const scr = cur && cur.width > 100 ? cur : this.lastScreen;
        Helper.ask({ fpip: 'pipClosed', remember: S.rememberPlacement, screen: scr }, 3000);
      }

      this.captions.teardown();
      this.cleanup.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
      this.cleanup = [];

      if (this.placeholder.isConnected) {
        this.placeholder.replaceWith(v);
      } else if (this.parent && this.parent.isConnected) {
        this.parent.insertBefore(v, this.next && this.next.parentNode === this.parent ? this.next : null);
      } else {
        try { v.pause(); } catch (_) { /* ignore */ }
      }
      this.placeholder.remove();
      if (this.host) {
        this.host.remove();
        const de = document.documentElement.style;
        if (this.prevOverflow) de.setProperty('overflow', this.prevOverflow, this.prevOverflowPrio);
        else de.removeProperty('overflow');
      }
      if (playing && v.paused && v.isConnected) v.play().catch(() => {});

      if (session === this) session = null;

      const reason = this.closeReason;
      if (S.pauseOnClose) {
        if (reason === 'close' || reason === 'replace') {
          try { v.pause(); } catch (_) { /* ignore */ }
        } else if (reason === null) {
          // Closed with the window's own X or "back to tab" button: pause only if the tab stayed hidden.
          setTimeout(() => { if (document.hidden) { try { v.pause(); } catch (_) { /* ignore */ } } }, 300);
        }
      }
      LOG(this.mode === 'pip' ? 'Document PiP closed' : 'Fullscreen window closed', reason || '(window)');
    }
  }

  // —— Opening PiP (document PiP first, native video PiP as fallback) ——
  async function openNativePip(video) {
    try {
      video.removeAttribute('disablepictureinpicture');
      video.disablePictureInPicture = false;
    } catch (_) { /* ignore */ }
    try {
      await video.requestPictureInPicture();
      return true;
    } catch (e) {
      LOG('Native PiP failed:', e && e.name, e && e.message);
      return false;
    }
  }

  async function openPip(video, { auto = false } = {}) {
    if (!video || opening) return false;
    opening = true;
    try {
      if (session) {
        if (session.video === video) { session.close('toggle'); return true; }
        session.close('replace');
      }
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture().catch(() => {});
        return true;
      }
      Hover.hide();
      if (S.preferDocumentPip && 'documentPictureInPicture' in window) {
        try {
          await PlayerSession.open(video, auto);
          return true;
        } catch (e) {
          LOG('Document PiP failed, trying native PiP:', e && e.name, e && e.message);
        }
      }
      const ok = await openNativePip(video);
      if (ok && auto) Auto.nativeAuto = true;
      return ok;
    } finally {
      opening = false;
    }
  }

  function togglePipForPage() {
    if (session) { session.close('toggle'); return; }
    if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return; }
    const v = findBestVideo();
    if (v) openPip(v);
    else Hover.toast('No video found on this page');
  }

  // —— Auto-PiP when switching tabs ——
  const Auto = {
    registered: false,
    unsupported: false,
    nativeAuto: false,
    suppressUntil: 0,
    suppressed() { return Date.now() < this.suppressUntil; },

    register() {
      if (this.registered || this.unsupported || !S.autoPip || isBlacklisted()) return;
      if (!navigator.mediaSession) { this.unsupported = true; return; }
      try {
        // Chromium calls this when the tab is hidden while media plays (needs the auto-PiP flag),
        // and grants the user activation needed to open a document PiP window.
        navigator.mediaSession.setActionHandler('enterpictureinpicture', () => this.onEnter());
        this.registered = true;
        LOG('Auto-PiP handler registered');
      } catch (e) {
        this.unsupported = true;
        LOG('enterpictureinpicture not supported (enable the auto-PiP flag); using visibilitychange fallback');
      }
    },

    unregister() {
      if (!this.registered) return;
      try { navigator.mediaSession.setActionHandler('enterpictureinpicture', null); } catch (_) { /* ignore */ }
      this.registered = false;
    },

    onEnter() {
      LOG('Auto-PiP: browser asked (enterpictureinpicture)');
      if (!S.autoPip || this.suppressed() || isBlacklisted() || session || document.pictureInPictureElement) return;
      const v = findAutoVideo();
      if (v) openPip(v, { auto: true });
    },

    // Chromium only offers auto-PiP when the tab stops being the active tab. If the tab got hidden some other way
    // (e.g. it came back from the fullscreen window as a background tab) and there's no user gesture for the
    // fallback, the UI helper flips the tabs once so Chromium sees a real tab switch. At most once per 10 s.
    lastNudge: 0,
    nudgeUseless: false,
    async nudge() {
      if (!this.registered || this.nudgeUseless || Date.now() - this.lastNudge < 10000) return;
      if (!(await Helper.available())) return;
      this.lastNudge = Date.now();
      const r = await Helper.ask({ fpip: 'nudgeAutoPip' });
      LOG('Auto-PiP: asked the UI helper for a tab flip:', r && r.ok ? 'done' : (r && r.error) || 'no answer');
      if (!r || !r.ok) return;
      // If even a real tab switch doesn't get Chromium to offer PiP (e.g. auto-PiP blocked for this site), stop
      // flipping on this page; otherwise every switch away would flash the tab for nothing.
      setTimeout(() => {
        if (!session && !document.pictureInPictureElement) {
          this.nudgeUseless = true;
          LOG('Auto-PiP: tab flip did not help on this page; not flipping again');
        }
      }, 2000);
    },

    onVisibility() {
      if (document.hidden) {
        if (!S.autoPip || isBlacklisted()) return;
        const v = findAutoVideo();
        if (!v) return;
        // Fallback for when the mediaSession route is not available. Usually needs a recent user gesture.
        const delay = Math.max(S.autoDelay, this.registered ? 400 : 0);
        setTimeout(async () => {
          if (document.hidden && !session && !opening && !this.suppressed() && !document.pictureInPictureElement && !v.paused) {
            LOG('Auto-PiP: browser did not ask; trying visibilitychange fallback');
            const ok = await openPip(v, { auto: true });
            if (!ok) this.nudge();
          }
        }, delay);
      } else if (S.exitOnReturn) {
        if (session && session.auto) session.close('return');
        else if (this.nativeAuto && document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
        this.nativeAuto = false;
      }
    }
  };

  // —— Hover button + settings + page toast (Shadow DOM) ——
  const Hover = {
    host: null,
    root: null,
    box: null,
    btn: null,
    video: null,
    hideTimer: 0,
    hovering: false,

    ensure() {
      if (this.host) return;
      const host = this.host = document.createElement('div');
      host.id = 'vivaldi-fpip-host';
      this.root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = HOST_CSS;
      this.root.appendChild(style);

      this.btn = h(document, 'button', {
        class: 'btn',
        title: `Picture-in-picture${S.shortcut ? ` (${S.shortcut})` : ''} — right-click for settings`,
        'aria-label': 'Picture-in-picture'
      }, icon(document, 'pip'));
      this.box = h(document, 'div', { class: 'box' }, this.btn);
      this.root.appendChild(this.box);

      this.btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const v = (this.video && this.video.isConnected) ? this.video : findBestVideo();
        if (v) openPip(v);
      });
      this.btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Settings.open();
      });
      this.box.addEventListener('mouseenter', () => {
        this.hovering = true;
        clearTimeout(this.hideTimer);
        this.box.style.opacity = '1';
      });
      this.box.addEventListener('mouseleave', () => {
        this.hovering = false;
        this.scheduleHide(600);
      });
      document.documentElement.appendChild(host);
    },

    onMouseMove(e) {
      if (document.fullscreenElement) { this.hide(); return; }
      if (isBlacklisted()) return;
      if (e.composedPath && this.host && e.composedPath().includes(this.host)) return;
      const v = findVideoAt(e.clientX, e.clientY);
      if (!v) { if (!this.hovering) this.scheduleHide(400); return; }
      this.show(v);
    },

    show(v) {
      this.ensure();
      this.video = v;
      const r = v.getBoundingClientRect();
      const [yPos, xPos] = S.position.split('-');
      let top;
      let left;
      if (yPos === 'top') top = r.top + BUTTON_MARGIN;
      else if (yPos === 'mid') top = r.top + r.height / 2 - BUTTON_SIZE / 2;
      else top = r.bottom - BUTTON_SIZE - BUTTON_MARGIN;
      if (xPos === 'left') left = r.left + BUTTON_MARGIN;
      else if (xPos === 'center') left = r.left + r.width / 2 - BUTTON_SIZE / 2;
      else left = r.right - BUTTON_SIZE - BUTTON_MARGIN;
      if (!Number.isFinite(top) || !Number.isFinite(left)) return;

      this.box.style.left = `${Math.round(left)}px`;
      this.box.style.top = `${Math.round(top)}px`;
      this.box.style.opacity = this.hovering ? '1' : String(S.opacity);
      this.box.classList.add('visible');
      this.scheduleHide(HOVER_HIDE_MS);
    },

    scheduleHide(ms) {
      clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => { if (!this.hovering) this.hide(); }, ms);
    },

    hide() {
      if (!this.box) return;
      clearTimeout(this.hideTimer);
      this.box.classList.remove('visible');
      this.box.style.opacity = '0';
    },

    toast(message) {
      this.ensure();
      const t = h(document, 'div', { class: 'toast', text: message });
      this.root.appendChild(t);
      setTimeout(() => t.classList.add('show'), 10);
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2000);
    }
  };

  const Settings = {
    open() {
      Hover.ensure();
      const root = Hover.root;
      const old = root.querySelector('.modal');
      if (old) old.remove();

      const d = document;
      const getters = {};

      const check = (key, label) => {
        const inp = h(d, 'input', { type: 'checkbox' });
        inp.checked = S[key];
        getters[key] = () => inp.checked;
        return h(d, 'label', { class: 'row' }, inp, h(d, 'span', { text: label }));
      };

      const num = (key, label) => {
        const s = SCHEMA[key];
        const inp = h(d, 'input', { type: s.range ? 'range' : 'number', min: s.min, max: s.max, step: s.step });
        inp.value = String(S[key]);
        getters[key] = () => inp.value;
        if (s.range) {
          const out = h(d, 'span', { class: 'val', text: String(S[key]) });
          inp.addEventListener('input', () => { out.textContent = inp.value; });
          return h(d, 'label', { class: 'field slider' }, h(d, 'span', { text: label }), inp, out);
        }
        return h(d, 'label', { class: 'field' }, h(d, 'span', { text: label }), inp);
      };

      // Position grid
      let selectedPos = S.position;
      const cells = [];
      const grid = h(d, 'div', { class: 'grid' });
      ['top-left', 'top-center', 'top-right', 'mid-left', null, 'mid-right', 'bot-left', 'bot-center', 'bot-right']
        .forEach((pos) => {
          if (!pos) { grid.appendChild(h(d, 'div', { class: 'spacer' })); return; }
          const c = h(d, 'div', { class: `cell${pos === selectedPos ? ' active' : ''}`, title: pos.replace('-', ' ') });
          c.addEventListener('click', () => {
            cells.forEach((x) => x.classList.remove('active'));
            c.classList.add('active');
            selectedPos = pos;
          });
          cells.push(c);
          grid.appendChild(c);
        });

      // Shortcut recorder
      const shortcut = h(d, 'input', { type: 'text', class: 'shortcut', readonly: true, placeholder: 'Click, then press keys' });
      shortcut.value = S.shortcut;
      let recorded = S.shortcut;
      shortcut.addEventListener('focus', () => { shortcut.classList.add('recording'); shortcut.value = 'Press keys… (Backspace clears)'; });
      shortcut.addEventListener('blur', () => { shortcut.classList.remove('recording'); shortcut.value = recorded; });
      shortcut.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Backspace' || e.key === 'Delete') { recorded = ''; shortcut.blur(); return; }
        if (e.key === 'Escape') { shortcut.blur(); return; }
        const combo = comboFromEvent(e);
        if (!combo) return;
        recorded = combo;
        shortcut.blur();
      });

      const blacklist = h(d, 'textarea', { rows: 4, maxlength: 10000, placeholder: 'tiktok.com\nyoutube.com/shorts' });
      blacklist.value = S.blacklist;

      const storageNote = {
        chrome: 'Settings are shared by all sites.',
        local: 'Settings are saved for this site only (chrome.storage is not available to this script).',
        memory: 'Storage unavailable — settings last until the page is reloaded.'
      }[Store.backend];

      const close = () => modal.remove();
      const save = async () => {
        const raw = { ...S };
        for (const [k, get] of Object.entries(getters)) raw[k] = get();
        raw.position = selectedPos;
        raw.shortcut = recorded;
        raw.blacklist = blacklist.value;
        S = normalize(raw);
        await Store.set(SETTINGS_KEY, S);
        applySettings();
        close();
        Hover.toast('Picture-in-picture settings saved');
      };

      const modal = h(d, 'div', { class: 'modal' },
        h(d, 'div', { class: 'overlay', onclick: close }),
        h(d, 'div', { class: 'dialog', role: 'dialog', 'aria-label': 'Picture-in-picture settings' },
          h(d, 'div', { class: 'head' },
            h(d, 'h3', { text: 'Picture-in-Picture' }),
            h(d, 'button', { class: 'x', title: 'Close', onclick: close }, icon(d, 'close'))),
          h(d, 'div', { class: 'body' },
            h(d, 'div', { class: 'cols' },
              h(d, 'div', { class: 'col' },
                h(d, 'div', { class: 'title', text: 'Switching tabs' }),
                check('autoPip', 'Open PiP automatically when switching tabs'),
                check('exitOnReturn', 'Close it again when returning to the tab'),
                check('requireAudio', 'Only for videos playing with sound'),
                num('autoDelay', 'Fallback delay (ms)'),
                h(d, 'div', { class: 'title', text: 'PiP window' }),
                check('preferDocumentPip', 'Enhanced window (captions & fullscreen controls)'),
                check('rememberPlacement', 'Open PiP where I last left it (any monitor; needs UI helper)'),
                check('pauseOnClose', 'Pause the video when the PiP window is closed'),
                check('captionsOnByDefault', 'Turn captions on by default'),
                num('captionScale', 'Caption size'),
                num('seekInterval', 'Seek step (s)')),
              h(d, 'div', { class: 'col' },
                h(d, 'div', { class: 'title', text: 'Only offer PiP for videos' }),
                num('minDuration', 'Longer than (s)'),
                num('minWidth', 'Wider than (px)'),
                num('minHeight', 'Taller than (px)'),
                h(d, 'div', { class: 'title', text: 'Hover button' }),
                grid,
                num('opacity', 'Opacity'),
                h(d, 'label', { class: 'field' }, h(d, 'span', { text: 'Toggle shortcut' }), shortcut))),
            h(d, 'div', { class: 'title', text: 'Never on these sites (one per line, matches domain or path)' }),
            blacklist,
            h(d, 'p', { class: 'note', text: storageNote })),
          h(d, 'div', { class: 'foot' },
            h(d, 'span', { class: 'ver', text: `v${VERSION}` }),
            h(d, 'button', { class: 'cancel', text: 'Cancel', onclick: close }),
            h(d, 'button', { class: 'save', text: 'Save', onclick: save }))));

      modal.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
      });
      root.appendChild(modal);
    }
  };

  const HOST_CSS = `
    :host{all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;
      z-index:${Z_MAX}!important;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif!important}
    .box{position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:${Z_MAX}}
    .box.visible{pointer-events:auto}
    .btn{all:unset;box-sizing:border-box;width:${BUTTON_SIZE}px;height:${BUTTON_SIZE}px;display:flex;align-items:center;justify-content:center;
      border-radius:8px;background:rgba(15,15,15,.85);border:1px solid rgba(255,255,255,.15);color:#fff;cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,.4);transition:background .15s,transform .15s,border-color .15s}
    .btn:hover{background:#ef3939;border-color:#ef3939;transform:scale(1.05)}
    .btn svg{width:20px;height:20px;fill:currentColor}
    .toast{position:fixed;bottom:40px;left:50%;transform:translate(-50%,20px);background:#222;color:#fff;padding:10px 20px;border-radius:4px;
      border-left:4px solid #ef3939;opacity:0;transition:all .3s;pointer-events:none;box-shadow:0 5px 20px rgba(0,0,0,.4);
      font-size:14px;z-index:${Z_MAX}}
    .toast.show{opacity:1;transform:translate(-50%,0)}
    .modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:${Z_MAX};font-size:13px;color:#e0e0e0}
    .overlay{position:absolute;inset:0;background:rgba(0,0,0,.65);backdrop-filter:blur(3px)}
    .dialog{position:relative;width:640px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);display:flex;flex-direction:column;
      background:#1a1a1a;border:1px solid #333;border-radius:8px;box-shadow:0 20px 50px rgba(0,0,0,.6);overflow:hidden}
    .head,.foot{display:flex;align-items:center;gap:10px;padding:12px 20px;background:#222}
    .head{justify-content:space-between;border-bottom:1px solid #333}
    .head h3{margin:0;font-size:15px;font-weight:600;color:#fff}
    .x{all:unset;cursor:pointer;color:#888;display:flex}
    .x:hover{color:#fff}
    .x svg{width:20px;height:20px;fill:currentColor}
    .body{padding:16px 20px;overflow-y:auto}
    .cols{display:flex;flex-wrap:wrap;gap:24px}
    .col{flex:1 1 240px;min-width:0}
    .title{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:700;border-bottom:1px solid #333;
      padding-bottom:4px;margin:14px 0 10px}
    .col .title:first-child{margin-top:0}
    .row{display:flex;align-items:center;gap:8px;margin-bottom:10px;cursor:pointer}
    .field{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
    .field > span:first-child{color:#ccc}
    .slider input{flex:1;min-width:80px}
    .val{width:32px;text-align:right;color:#aaa;font-variant-numeric:tabular-nums}
    input[type=checkbox]{width:15px;height:15px;margin:0;accent-color:#ef3939;cursor:pointer;flex:none}
    input[type=range]{accent-color:#ef3939}
    input[type=number],input[type=text],textarea{background:#2a2a2a;border:1px solid #444;color:#fff;padding:6px 8px;border-radius:4px;
      font:inherit;box-sizing:border-box}
    input[type=number]{width:90px}
    input[type=text]{width:150px}
    textarea{width:100%;resize:vertical;font-family:ui-monospace,Consolas,monospace}
    input:focus,textarea:focus{outline:none;border-color:#ef3939}
    .shortcut{text-align:center;font-weight:600;color:#ef3939;cursor:pointer}
    .shortcut.recording{background:#ef3939;color:#fff;border-color:#ef3939}
    .grid{display:grid;grid-template-columns:repeat(3,26px);grid-template-rows:repeat(3,18px);gap:5px;background:#2a2a2a;padding:8px;
      border:1px solid #444;border-radius:6px;width:max-content;margin-bottom:12px}
    .cell{background:#444;border-radius:3px;cursor:pointer}
    .cell:hover{background:#666}
    .cell.active{background:#ef3939}
    .note{color:#888;font-size:12px;margin:10px 0 0}
    .foot{justify-content:flex-end;border-top:1px solid #333}
    .ver{margin-right:auto;color:#666;font-size:12px}
    .foot button{all:unset;cursor:pointer;padding:7px 18px;border-radius:4px;font-weight:600}
    .cancel{color:#aaa;border:1px solid #444}
    .cancel:hover{color:#fff;border-color:#666}
    .save{background:#ef3939;color:#fff}
    .save:hover{background:#d63030}
  `;

  function applySettings() {
    if (S.autoPip) {
      if (getVideos().some((v) => !v.paused)) Auto.register();
    } else {
      Auto.unregister();
    }
    if (Hover.btn) Hover.btn.title = `Picture-in-picture${S.shortcut ? ` (${S.shortcut})` : ''} — right-click for settings`;
  }

  // —— Init ——
  async function init() {
    S = normalize(await Store.get(SETTINGS_KEY));
    sizeCache = validSize(await Store.get(SIZE_KEY));

    let lastMove = 0;
    document.addEventListener('mousemove', (e) => {
      const now = Date.now();
      if (now - lastMove < 80) return;
      lastMove = now;
      Hover.onMouseMove(e);
    }, { passive: true, capture: true });

    document.addEventListener('keydown', (e) => {
      if (!S.shortcut) return;
      if (Hover.host && e.composedPath().includes(Hover.host)) return;
      if (comboFromEvent(e) !== S.shortcut) return;
      e.preventDefault();
      e.stopPropagation();
      togglePipForPage();
    }, true);

    // Media events don't bubble, but capture listeners on document still see them.
    document.addEventListener('play', (e) => {
      if (e.target && e.target.tagName === 'VIDEO') Auto.register();
    }, true);
    document.addEventListener('visibilitychange', () => Auto.onVisibility());
    document.addEventListener('fullscreenchange', () => Hover.hide());
    document.addEventListener('scroll', () => Hover.hide(), { passive: true, capture: true });

    // SPA navigation (YouTube): put the video back before the page swaps content.
    document.addEventListener('yt-navigate-start', () => { if (session) session.close('navigate'); });
    window.addEventListener('pagehide', () => { if (session) session.close('navigate'); });

    if (typeof chrome !== 'undefined' && Store.backend === 'chrome') {
      try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local' && changes[SETTINGS_KEY]) {
            S = normalize(changes[SETTINGS_KEY].newValue);
            applySettings();
          }
        });
      } catch (_) { /* ignore */ }
    }

    applySettings();
    LOG(`Firefox-style PiP v${VERSION} loaded (storage: ${Store.backend}, document PiP: ${'documentPictureInPicture' in window})`);
  }

  init().catch((e) => console.error('[FPiP] init failed', e));
})();
