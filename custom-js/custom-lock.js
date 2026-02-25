// custom-lock.js — Vivaldi Browser Password Lock Mod
// Blocks all interaction outside the unlock form.
// Place in your Vivaldi mod folder and reference from browser.html or custom.js

const PASSWORD = "yourSecretPassword123"; // ← change this!

(function () {
  "use strict";

  // ── State ──
  let locked = true;
  let failCount = 0;
  let lockoutUntil = 0;
  const MAX_FAILS = 5;
  const LOCKOUT_MS = 30000; // 30s lockout after too many fails

  // ── Overlay ──
  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483647", // max z-index
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    userSelect: "none",
    webkitUserSelect: "none",
    // Subtle animated gradient background
    background: "linear-gradient(135deg, #0d0f14 0%, #111318 50%, #0a0c10 100%)",
  });

  // Noise texture overlay for depth
  const noise = document.createElement("div");
  Object.assign(noise.style, {
    position: "absolute",
    inset: "0",
    opacity: "0.04",
    backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
    backgroundRepeat: "repeat",
    pointerEvents: "none",
  });
  overlay.appendChild(noise);

  // ── Card ──
  const card = document.createElement("div");
  Object.assign(card.style, {
    position: "relative",
    background: "rgba(20, 22, 28, 0.95)",
    border: "1px solid rgba(255,255,255,0.07)",
    padding: "52px 56px",
    borderRadius: "16px",
    boxShadow: "0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.03)",
    textAlign: "center",
    minWidth: "360px",
    maxWidth: "400px",
    width: "90vw",
    animation: "lockFadeIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
  });

  // ── CSS Animations ──
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');

    @keyframes lockFadeIn {
      from { opacity: 0; transform: translateY(12px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0)   scale(1); }
    }
    @keyframes shake {
      0%,100% { transform: translateX(0); }
      15%      { transform: translateX(-8px); }
      30%      { transform: translateX(7px); }
      45%      { transform: translateX(-6px); }
      60%      { transform: translateX(5px); }
      75%      { transform: translateX(-4px); }
      90%      { transform: translateX(3px); }
    }
    @keyframes lockoutPulse {
      0%,100% { opacity: 1; }
      50%      { opacity: 0.5; }
    }
    #viv-lock-input:focus {
      outline: none;
      border-color: rgba(100, 160, 255, 0.6) !important;
      box-shadow: 0 0 0 3px rgba(80, 140, 255, 0.12) !important;
    }
    #viv-lock-btn:hover:not(:disabled) {
      background: #4a7de8 !important;
    }
    #viv-lock-btn:active:not(:disabled) {
      transform: scale(0.98);
    }
    #viv-lock-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  `;
  document.head.appendChild(style);

  // ── Lock icon ──
  const icon = document.createElement("div");
  icon.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>`;
  icon.style.marginBottom = "24px";

  // ── Title ──
  const title = document.createElement("div");
  title.textContent = "Browser Locked";
  Object.assign(title.style, {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "20px",
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
    marginBottom: "6px",
    letterSpacing: "-0.01em",
  });

  const subtitle = document.createElement("div");
  subtitle.textContent = "Enter your password to continue";
  Object.assign(subtitle.style, {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "13px",
    fontWeight: "300",
    color: "rgba(255,255,255,0.3)",
    marginBottom: "32px",
    letterSpacing: "0.01em",
  });

  // ── Input ──
  const input = document.createElement("input");
  input.id = "viv-lock-input";
  input.type = "password";
  input.placeholder = "Password";
  input.autocomplete = "off";
  input.spellcheck = false;
  Object.assign(input.style, {
    fontFamily: "'DM Mono', monospace",
    fontSize: "15px",
    padding: "13px 16px",
    width: "100%",
    boxSizing: "border-box",
    marginBottom: "14px",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.85)",
    transition: "border-color 0.2s, box-shadow 0.2s",
    letterSpacing: "0.05em",
  });

  // ── Button ──
  const btn = document.createElement("button");
  btn.id = "viv-lock-btn";
  btn.textContent = "Unlock";
  Object.assign(btn.style, {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "15px",
    fontWeight: "500",
    padding: "13px",
    width: "100%",
    border: "none",
    borderRadius: "8px",
    background: "#3a6fd8",
    color: "white",
    cursor: "pointer",
    transition: "background 0.2s, transform 0.1s",
    letterSpacing: "0.01em",
  });

  // ── Error / status message ──
  const msg = document.createElement("div");
  Object.assign(msg.style, {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: "13px",
    color: "#ff6b6b",
    marginTop: "16px",
    minHeight: "20px",
    transition: "opacity 0.2s",
  });

  // ── Assemble ──
  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(subtitle);
  card.appendChild(input);
  card.appendChild(btn);
  card.appendChild(msg);
  overlay.appendChild(card);

  // Insert as first child so it's above everything
  if (document.body) {
    document.body.insertBefore(overlay, document.body.firstChild);
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.insertBefore(overlay, document.body.firstChild);
    });
  }

  setTimeout(() => input.focus(), 120);

  // ── Unlock logic ──
  function unlock() {
    locked = false;
    overlay.style.transition = "opacity 0.3s";
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 300);
    removeAllBlockers();
  }

  function shakeCard() {
    card.style.animation = "none";
    card.offsetHeight; // reflow
    card.style.animation = "shake 0.45s ease forwards";
  }

  function checkPassword() {
    const now = Date.now();

    // Lockout check
    if (now < lockoutUntil) {
      const secs = Math.ceil((lockoutUntil - now) / 1000);
      msg.textContent = `Too many attempts. Wait ${secs}s.`;
      shakeCard();
      return;
    }

    if (input.value === PASSWORD) {
      msg.textContent = "";
      unlock();
    } else {
      failCount++;
      input.value = "";
      shakeCard();

      if (failCount >= MAX_FAILS) {
        lockoutUntil = Date.now() + LOCKOUT_MS;
        failCount = 0;
        btn.disabled = true;
        input.disabled = true;
        msg.style.color = "#ffaa44";
        msg.textContent = `Locked out for ${LOCKOUT_MS / 1000}s after repeated failures.`;
        msg.style.animation = "lockoutPulse 1.2s ease infinite";

        const interval = setInterval(() => {
          const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
          if (remaining <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            input.disabled = false;
            msg.style.animation = "none";
            msg.style.color = "#ff6b6b";
            msg.textContent = "";
            input.focus();
          } else {
            msg.textContent = `Locked out for ${remaining}s after repeated failures.`;
          }
        }, 500);
      } else {
        msg.style.color = "#ff6b6b";
        msg.style.animation = "none";
        msg.textContent = `Wrong password. ${MAX_FAILS - failCount} attempt${MAX_FAILS - failCount !== 1 ? "s" : ""} remaining.`;
      }

      input.focus();
    }
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      checkPassword();
    }
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    checkPassword();
  });

  // ── Global blockers ──

  // Block all keyboard events except those targeting our own input/button
  const blockKeyboard = (e) => {
    if (!locked) return;
    if (e.target === input || e.target === btn) {
      // Only allow keys needed for password entry
      const allowed = [
        "Backspace", "Delete", "ArrowLeft", "ArrowRight",
        "Home", "End", "Enter", "Shift", "CapsLock"
      ];
      if (!e.ctrlKey && !e.altKey && !e.metaKey) return; // normal typing
      if (allowed.includes(e.key)) return;
    }
    // Block everything else
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // Block all mouse/pointer events not inside our card
  const blockPointer = (e) => {
    if (!locked) return;
    if (card.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // Block scroll / wheel
  const blockScroll = (e) => {
    if (!locked) return;
    if (card.contains(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // Block drag
  const blockDrag = (e) => {
    if (!locked) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  // Pointer events (covers touch too)
  const pointerEvents = ["mousedown", "mouseup", "click", "dblclick",
                          "pointerdown", "pointerup", "touchstart", "touchend"];
  pointerEvents.forEach((ev) =>
    window.addEventListener(ev, blockPointer, { capture: true, passive: false })
  );

  // Keyboard
  ["keydown", "keyup", "keypress"].forEach((ev) =>
    window.addEventListener(ev, blockKeyboard, { capture: true, passive: false })
  );

  // Scroll / wheel
  ["wheel", "scroll"].forEach((ev) =>
    window.addEventListener(ev, blockScroll, { capture: true, passive: false })
  );

  // Drag
  ["dragstart", "drop"].forEach((ev) =>
    window.addEventListener(ev, blockDrag, { capture: true, passive: false })
  );

  // Context menu
  const blockContext = (e) => {
    if (!locked) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener("contextmenu", blockContext, { capture: true });

  // Re-focus input if focus escapes (e.g. user tabs to address bar and comes back)
  const refocusInput = () => {
    if (locked && document.activeElement !== input && document.activeElement !== btn) {
      // Small delay to avoid fighting the browser
      setTimeout(() => {
        if (locked) input.focus();
      }, 50);
    }
  };

  window.addEventListener("blur", refocusInput);
  document.addEventListener("focusin", (e) => {
    if (!locked) return;
    if (!card.contains(e.target)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      input.focus();
    }
  }, true);

  // Re-focus when tab becomes visible again
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && locked) {
      setTimeout(() => input.focus(), 80);
    }
  });

  // ── Cleanup on unlock ──
  function removeAllBlockers() {
    pointerEvents.forEach((ev) =>
      window.removeEventListener(ev, blockPointer, { capture: true })
    );
    ["keydown", "keyup", "keypress"].forEach((ev) =>
      window.removeEventListener(ev, blockKeyboard, { capture: true })
    );
    ["wheel", "scroll"].forEach((ev) =>
      window.removeEventListener(ev, blockScroll, { capture: true })
    );
    ["dragstart", "drop"].forEach((ev) =>
      window.removeEventListener(ev, blockDrag, { capture: true })
    );
    window.removeEventListener("contextmenu", blockContext, { capture: true });
    window.removeEventListener("blur", refocusInput);
  }

  // ── MutationObserver: re-add overlay if something removes it ──
  const observer = new MutationObserver(() => {
    if (locked && !document.body.contains(overlay)) {
      document.body.insertBefore(overlay, document.body.firstChild);
      input.focus();
    }
  });
  observer.observe(document.body, { childList: true, subtree: false });

  // Stop observing on unlock
  const _origUnlock = unlock;

})();
