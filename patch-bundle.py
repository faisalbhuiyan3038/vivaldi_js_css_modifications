#!/usr/bin/env python3
"""
Vivaldi bundle.js Patcher (Cross-Platform: Linux, macOS, Windows, FreeBSD):
1. Expands maximum panel width drag limit from Golden Ratio (0.618 / 61.8%) to 0.880 (88%).
2. Expands container max-width CSS from 65vw to 88vw.
3. Enables native Vivaldi Close (X) button even with Floating & Auto-Close enabled.
4. Hooks Rge (WebPanel) close button directly to home() reset and edge-panel-mod discard.
5. Fixes Web Panel Shortcut Interception:
   - Adds "ctrl+enter", "meta+enter", "ctrl+shift+enter", "meta+shift+enter", "alt+enter"
     to the text editing passthrough set (f) so web apps (Twitter/X tweet submit, ChatGPT,
     Claude, Discord, Slack, GitHub comments) receive instant submit shortcuts instead of
     being swallowed by Vivaldi's browser command dispatcher.
   - Fixes Web Panel webview focus blindspot in handleShortcut so typing inside web panels
     is never treated as an unfocused background tab.
6. Connects Rge componentDidUpdate to trigger native this._createRelatedTab() and this.home()
   on reopen when closed via (X).
"""

import os
import sys
import glob
import shutil

CANDIDATE_PATHS = [
    # Windows
    "M:/Vivaldi/Application/8.2.4133.47/resources/vivaldi/bundle.js"
    # Linux / BSD / Flatpak
    "/opt/vivaldi/resources/vivaldi/bundle.js",
    "/opt/vivaldi-snapshot/resources/vivaldi/bundle.js",
    "/usr/share/vivaldi/resources/vivaldi/bundle.js",
    "/usr/local/share/vivaldi/resources/vivaldi/bundle.js",
    "/app/vivaldi/resources/vivaldi/bundle.js",
    # macOS
    "/Applications/Vivaldi.app/Contents/Frameworks/Vivaldi Framework.framework/Resources/vivaldi/bundle.js",
    "/Applications/Vivaldi.app/Contents/Resources/vivaldi/bundle.js",
    "/Applications/Vivaldi Snapshot.app/Contents/Frameworks/Vivaldi Framework.framework/Resources/vivaldi/bundle.js",
    "/Applications/Vivaldi Snapshot.app/Contents/Resources/vivaldi/bundle.js",
]

def find_bundle_path():
    for p in CANDIDATE_PATHS:
        if os.path.isfile(p):
            return p

    win_roots = []
    for env_var in ["LOCALAPPDATA", "ProgramFiles", "ProgramFiles(x86)"]:
        val = os.environ.get(env_var)
        if val:
            win_roots.append(val)

    for root in win_roots:
        patterns = [
            os.path.join(root, "Vivaldi", "Application", "*", "resources", "vivaldi", "bundle.js"),
            os.path.join(root, "Vivaldi Snapshot", "Application", "*", "resources", "vivaldi", "bundle.js"),
        ]
        for pat in patterns:
            matches = glob.glob(pat)
            if matches:
                matches.sort(reverse=True)
                return matches[0]

    return None

def patch_bundle(bundle_path):
    print(f"Target bundle: {bundle_path}")

    if not os.path.exists(bundle_path):
        print(f"Error: {bundle_path} does not exist.")
        return False

    orig_backup = bundle_path + ".orig"
    if not os.path.exists(orig_backup):
        print(f"Creating pristine backup: {orig_backup}")
        shutil.copy2(bundle_path, orig_backup)
    else:
        print(f"Pristine backup already exists at {orig_backup}")

    with open(bundle_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    changes = 0

    # 1. Expand Math.clamp drag limiter (.618 / 0.618 -> .880 / 0.880 [88% width])
    if ".618*this.context.innerWidth" in content:
        content = content.replace(".618*this.context.innerWidth", ".880*this.context.innerWidth")
        print(" -> Patched width clamp factor (.618 -> .880 [88% width])")
        changes += 1
    elif "0.618" in content:
        content = content.replace("0.618", "0.880")
        print(" -> Patched width clamp factor (0.618 -> 0.880 [88% width])")
        changes += 1
    elif ".880*this.context.innerWidth" in content or "0.880" in content:
        print(" -> Drag clamp factor already set to 0.880 (88% width)")
    else:
        print(" -> Note: 0.618 clamp pattern not matched")

    # 2. Expand CSS container max-width clamp (65vw -> 88vw)
    if "65vw" in content:
        content = content.replace("65vw", "88vw")
        print(" -> Patched container max-width (65vw -> 88vw)")
        changes += 1
    elif "88vw" in content:
        print(" -> Container max-width already set to 88vw")
    else:
        print(" -> Note: 65vw pattern not matched")

    # 3. Enable native Vivaldi Close (X) button even with Floating & Auto-Close
    old_close = "shouldShowCloseButton=e=>this.props.prefValues[D.kPanelsShowCloseButton]&&!((si.ZP.getSeparateFloating(e,this.winId)||this.props.prefValues[D.kPanelsAsOverlayEnabled])&&this.props.prefValues[D.kPanelsAsOverlayAutoClose]);"
    if old_close in content:
        base = "shouldShowCloseButton=e=>Boolean(this.props.prefValues[D.kPanelsShowCloseButton]);/*"
        padding = len(old_close) - len(base) - len("*/;")
        new_close = base + " " * padding + "*/;"
        content = content.replace(old_close, new_close, 1)
        print(" -> Enabled native Vivaldi close button in bundle.js")
        changes += 1
    elif "shouldShowCloseButton=e=>Boolean(this.props.prefValues[D.kPanelsShowCloseButton]);" in content:
        print(" -> Native close button already enabled in bundle.js")

    # 4. Patch Rge (WebPanel) close button to trigger __edgeCloseWebPanel or native home() + closePanel
    old_rge_close = 'this.props.showCloseButton&&(0,Fi.jsx)("button",{className:"close transparent",onClick:()=>ii.Z.closePanel(this.winId),title:(0,k.Z)("Close Panel"),children:Wge})'
    new_rge_close = 'this.props.showCloseButton&&(0,Fi.jsx)("button",{className:"close transparent",onClick:()=>{(window.__edgeCloseWebPanel?window.__edgeCloseWebPanel(this):(this.home(),ii.Z.closePanel(this.winId)))},title:(0,k.Z)("Close Panel"),children:Wge})'
    if old_rge_close in content:
        content = content.replace(old_rge_close, new_rge_close, 1)
        print(" -> Connected native Rge close button to Edge reset & discard handler")
        changes += 1
    elif '__edgeCloseWebPanel' in content:
        print(" -> Native Rge close button already connected to Edge reset handler")

    # 5. Patch text editing shortcut passthrough set (f) to include Ctrl+Enter / Meta+Enter
    target_f = 'let f=new Set(["left","right","shift+left","shift+right","shift+up","shift+down","enter","shift+enter"]);f=new Set([...f,"ctrl+a","ctrl+z","ctrl+y","ctrl+u","ctrl+left","ctrl+right","ctrl+backspace","ctrl+delete","ctrl+home","ctrl+end","ctrl+shift+left","ctrl+shift+right","shift+home","shift+end"]);'
    new_f = 'let f=new Set(["left","right","shift+left","shift+right","shift+up","shift+down","enter","shift+enter","ctrl+enter","meta+enter","ctrl+shift+enter","meta+shift+enter","alt+enter"]);f=new Set([...f,"ctrl+a","ctrl+z","ctrl+y","ctrl+u","ctrl+left","ctrl+right","ctrl+backspace","ctrl+delete","ctrl+home","ctrl+end","ctrl+shift+left","ctrl+shift+right","shift+home","shift+end"]);'
    if target_f in content:
        content = content.replace(target_f, new_f, 1)
        print(" -> Added Ctrl+Enter / Meta+Enter / Alt+Enter to text editing passthrough set (f)")
        changes += 1
    elif 'ctrl+enter' in content and 'shift+enter","ctrl+enter"' in content:
        print(" -> Shortcut passthrough set (f) already includes Ctrl+Enter")

    # 6. Patch Web Panel webview focus check in handleShortcut
    target_webview_shortcut = '"WEBVIEW"===m?l.Z.windowPrivate.getFocusedElementInfo(h).then((({tagName:n,editable:i,role:s})=>{if(!i||S(r)){const i="SELECT"===n,o="SPAN"===n&&"spinbutton"===s;(!i&&!o||i&&S(r))&&v(e,h,O(r),t)}})):v(e,h,O(r),t)'
    new_webview_shortcut = '"WEBVIEW"===m?(p?.closest?.("#panels")?S(r)&&v(e,h,O(r),t):l.Z.windowPrivate.getFocusedElementInfo(h).then((({tagName:n,editable:i,role:s})=>{if(!i||S(r)){const i="SELECT"===n,o="SPAN"===n&&"spinbutton"===s;(!i&&!o||i&&S(r))&&v(e,h,O(r),t)}}))):v(e,h,O(r),t)'
    if target_webview_shortcut in content:
        content = content.replace(target_webview_shortcut, new_webview_shortcut, 1)
        print(" -> Patched web panel webview shortcut dispatcher in handleShortcut")
        changes += 1
    elif 'p?.closest?.("#panels")?S(r)&&v(e,h,O(r),t)' in content:
        print(" -> Web panel webview shortcut dispatcher already patched")

    # 7. Patch Rge componentDidUpdate to trigger this._createRelatedTab() & this.home() on reopen
    target_cdu = 'e.isVisible===this.props.isVisible&&e.focusContent===this.props.focusContent||this.#wn(i)'
    new_cdu = '(!e.isVisible&&this.props.isVisible&&window.__edgeShouldReset?.(this.props.webPanel?.id)&&(this._createRelatedTab(),this.home())),e.isVisible===this.props.isVisible&&e.focusContent===this.props.focusContent||this.#wn(i)'
    if target_cdu in content:
        content = content.replace(target_cdu, new_cdu, 1)
        print(" -> Patched Rge componentDidUpdate for instant home reset & tab recreation on reopen")
        changes += 1
    elif '__edgeShouldReset' in content:
        print(" -> Rge componentDidUpdate already patched for home reset")

    if changes > 0:
        with open(bundle_path, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully applied {changes} patch(es) to {bundle_path}")
        return True
    else:
        print("No modifications needed or already up to date.")
        return True

def main():
    if len(sys.argv) > 1:
        target = sys.argv[1]
    else:
        target = find_bundle_path()

    if not target:
        print("Error: Could not locate Vivaldi bundle.js automatically.")
        print("Usage: python3 patch-bundle.py [path_to_bundle.js]")
        sys.exit(1)

    success = patch_bundle(target)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
