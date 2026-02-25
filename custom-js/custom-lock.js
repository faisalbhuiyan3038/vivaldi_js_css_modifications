// custom-lock.js — Vivaldi Lock Mod (RAM Only / No Crash)
// Version: 3.0 (Bulletproof)
// Features:
// - No localStorage dependency (fixes the crash).
// - Unlocks all windows via BroadcastChannel.
// - Re-locks on browser restart (secure).

const PASSWORD = "yourSecretPassword123"; // ← CHANGE THIS
const CHANNEL_NAME = "vivaldi_lock_ram_sync";

(function () {
  "use strict";

  // 🛡️ Safety Wrap: Prevents the script from breaking Vivaldi if something fails
  try {
    console.log("🔒 Lock Mod v3: Initializing...");

    // ── Communication Channel (RAM only) ──
    const channel = new BroadcastChannel(CHANNEL_NAME);

    // ── State ──
    let locked = true;
    let failCount = 0;
    let lockoutUntil = 0;
    const MAX_FAILS = 5;
    const LOCKOUT_MS = 30000;

    // ── UI Construction ──
    const overlay = document.createElement("div");
    overlay.id = "viv-lock-overlay-v3";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      // Changed background slightly to confirm new script loaded
      background: "linear-gradient(135deg, #05070a 0%, #0b0e14 100%)",
      contain: "strict"
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      position: "relative",
      background: "rgba(20, 25, 35, 0.98)", // Slightly darker
      border: "1px solid rgba(255,255,255,0.08)",
      padding: "48px",
      borderRadius: "12px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
      textAlign: "center",
      minWidth: "320px",
      animation: "lockFadeIn 0.3s ease-out forwards",
    });

    // Inject Styles
    const style = document.createElement("style");
    style.textContent = `
      @keyframes lockFadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      @keyframes shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
      #viv-lock-input:focus { outline: none; border-color: #64b5f6; box-shadow: 0 0 0 2px rgba(100, 181, 246, 0.2); }
    `;
    document.head.appendChild(style);

    // Build Internal HTML
    card.innerHTML = `
      <div style="margin-bottom:20px; opacity:0.9">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#64b5f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </div>
      <div style="font-family:'Segoe UI', sans-serif; font-size:18px; color:white; margin-bottom:8px; font-weight:600">Secure Browser</div>
      <div style="font-family:'Segoe UI', sans-serif; font-size:13px; color:#ffffff66; margin-bottom:24px">Session Locked</div>
    `;

    const input = document.createElement("input");
    input.id = "viv-lock-input";
    input.type = "password";
    input.placeholder = "Enter Password";
    Object.assign(input.style, {
      display: "block", width: "100%", padding: "10px", borderRadius: "6px",
      border: "1px solid #ffffff22", background: "#00000033", color: "white",
      marginBottom: "16px", fontSize: "14px", fontFamily: "monospace", textAlign: "center"
    });

    const btn = document.createElement("button");
    btn.textContent = "Unlock Session";
    Object.assign(btn.style, {
      display: "block", width: "100%", padding: "10px", borderRadius: "6px",
      border: "none", background: "#2563eb", color: "white", fontSize: "14px",
      fontWeight: "600", cursor: "pointer"
    });

    const msg = document.createElement("div");
    msg.style.cssText = "color:#ff6b6b; margin-top:12px; font-family:sans-serif; font-size:12px; min-height:16px";

    card.appendChild(input);
    card.appendChild(btn);
    card.appendChild(msg);
    overlay.appendChild(card);

    // ── Core Functions ──

    function performUnlock(broadcast) {
      if (!locked) return;
      locked = false;

      // Tell other windows
      if (broadcast) channel.postMessage({ type: "UNLOCK_ALL" });

      overlay.style.opacity = "0";
      overlay.style.transition = "opacity 0.25s";
      setTimeout(() => overlay.remove(), 250);
      removeBlockers();
    }

    function checkPassword() {
      // Simple lockout timer check
      if (Date.now() < lockoutUntil) {
        msg.textContent = "Locked out. Please wait.";
        return;
      }

      if (input.value === PASSWORD) {
        performUnlock(true);
      } else {
        failCount++;
        input.value = "";
        card.style.animation = "none";
        card.offsetHeight; // reflow
        card.style.animation = "shake 0.4s";

        if (failCount >= MAX_FAILS) {
          lockoutUntil = Date.now() + LOCKOUT_MS;
          msg.textContent = "Too many attempts. Wait 30s.";
        } else {
          msg.textContent = "Incorrect password";
        }
        input.focus();
      }
    }

    // ── Event Handlers ──
    btn.onclick = checkPassword;
    input.onkeydown = (e) => { if (e.key === "Enter") checkPassword(); };

    // Sync Listener
    channel.onmessage = (e) => {
      if (e.data.type === "UNLOCK_ALL") performUnlock(false);
      if (e.data.type === "CHECK_STATUS" && !locked) channel.postMessage({ type: "I_AM_UNLOCKED" });
      if (e.data.type === "I_AM_UNLOCKED") performUnlock(false);
    };

    // ── Input Blocking ──
    function block(e) {
      if (!locked) return;
      if (overlay.contains(e.target)) return;
      e.stopPropagation();
      e.preventDefault();
    }

    function removeBlockers() {
      window.removeEventListener("keydown", keyBlock, true);
      ["mousedown", "contextmenu", "wheel"].forEach(ev => window.removeEventListener(ev, block, true));
    }

    function keyBlock(e) {
      if (!locked) return;
      if (overlay.contains(e.target)) return;
      // Allow F12/DevTools for safety
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }

    // ── Polling Loader ──
    // Waits for #browser element to exist before locking
    const initInterval = setInterval(() => {
      const browserRoot = document.getElementById("browser") || document.getElementById("app");

      if (browserRoot) {
        console.log("🔒 Lock Mod v3: UI found. Locking.");
        clearInterval(initInterval);

        // Check if another window is already open & unlocked
        channel.postMessage({ type: "CHECK_STATUS" });

        browserRoot.appendChild(overlay);

        // Aggressive Focus Logic
        input.focus();
        setTimeout(() => input.focus(), 100);
        setTimeout(() => input.focus(), 500);

        // Attach blockers
        ["mousedown", "contextmenu", "wheel", "dragstart"].forEach(ev => window.addEventListener(ev, block, true));
        window.addEventListener("keydown", keyBlock, true);

      }
    }, 50); // Checks 20 times per second

  } catch (err) {
    console.error("🔒 Lock Mod FATAL ERROR:", err);
  }
})();
