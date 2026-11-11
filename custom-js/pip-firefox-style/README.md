# Firefox-style Picture-in-Picture for Vivaldi

Firefox / Yandex-style picture-in-picture for Vivaldi:

- **Keeps videos playing in PiP when you switch tabs**, and closes PiP when you come back. This is on by default, like in Yandex.
- **No stuck title.** Vivaldi's native video PiP shows the video title at the top until you hover over it and move away. This mod opens a *Document Picture-in-Picture* window instead, so that overlay is gone.
- **Captions toggle (CC)** inside the PiP window:
  - The video's own subtitle tracks (WebVTT `<track>`, HLS subtitles) are shown and hidden directly. This covers kisskh, Vimeo and most HTML5 players. If a site keeps empty placeholder tracks, the mod picks a track that actually has subtitles, in your browser's language when there is one. When PiP closes, the tracks go back to how the site had them.
  - Sites that draw captions as page text and have no subtitle tracks get that text mirrored into the PiP window, the way Firefox does it: YouTube, Netflix, Prime Video and Disney+. On YouTube, CC also turns YouTube's own captions on, and turns them off again when PiP closes.
- **Fullscreen on the PiP's monitor** (button, `F` or double-click), like Firefox and Yandex. Move the PiP window to your second monitor, press F, and the video goes fullscreen *on that monitor*; your browsing window on the other monitor isn't touched. You get the same controls and captions as in PiP.
  - Chromium can't make a PiP window fullscreen, so the UI helper (`pip-window-helper.js`, see Install) moves the video's tab into its own fullscreen window on that monitor.
  - **F**, **Esc** or a double-click puts the tab back in its original place and the video drops back into PiP.
  - **Back to tab** returns the tab and switches to it. **X** returns it and pauses the video.
  - Without the helper, F only maximizes the PiP window, which Chromium caps at about half the screen.
- **Opens where you last left it, on any monitor**, like Firefox. Drag a PiP window to your second monitor once, and every later PiP opens there, on every site. This includes automatic ones on tab switch and the one that comes back after fullscreen. The helper remembers the monitor, the nearest corner and the size. If that monitor isn't connected, PiP stays on a screen that is. Chromium itself always opens PiP bottom-right on the primary monitor, so the window shows up there for a moment and then jumps to its place. Needs the UI helper; it can be turned off in the settings.
- Its own controls: play/pause, ±seek, progress bar, volume, back to tab and close. The controls hide automatically.
- A hover button on videos, like stock Vivaldi. **Right-click it for settings.** `Alt+P` toggles PiP for the best video on the page.

## Install

1. Close Vivaldi.
2. Go to `<Vivaldi>\Application\<version>\resources\vivaldi\components\picture-in-picture\`
   (for example `%LOCALAPPDATA%\Vivaldi\Application\7.x.xxxx.xx\resources\vivaldi\components\picture-in-picture\`).
3. **Back up** the original `picture-in-picture.js`.
4. Replace it with `picture-in-picture.js` from this folder.
5. **UI helper, needed for fullscreen on another monitor and for remembering the PiP position:** add `pip-window-helper.js` to Vivaldi's UI like your other `window.html` mods. Copy it next to your other custom JS mods (e.g. `resources\vivaldi\custom-js\`), then add `<script src="custom-js/pip-window-helper.js"></script>` before `</body>` in `window.html`. You can also add it with your mod manager.
6. Start Vivaldi.

Vivaldi updates overwrite both files, so copy them in again after each update.

## Flags for automatic PiP on tab switch

The automatic part uses Chromium's auto-PiP media-session hook, the same one *Better Auto PiP* needs. Open `vivaldi://flags`, search for **picture-in-picture**, and enable:

- **Auto picture-in-picture for video playback** (`#auto-picture-in-picture-for-video-playback`)
- **Document Picture-in-Picture API** (`#document-picture-in-picture-api`), if it is listed and not already on

Leave **browser-initiated automatic picture-in-picture** **disabled**. Otherwise Chromium may open its own native PiP window, which has the title bug.

If a site asks about "Automatic picture-in-picture", allow it. You can also set it in the site's settings.

Without the flag, the mod falls back to trying PiP on `visibilitychange`. That only works if you interacted with the page within the last few seconds, which is a browser restriction.

Chromium only offers auto-PiP when a tab **stops being the active tab**. If the video's tab gets hidden some other way, Chromium stays silent. One example is the tab coming back from the fullscreen window as a background tab. The UI helper covers this:
- It makes the video tab active for a split second, then hands the active spot back to the tab you're on.
- Chromium sees a normal tab switch and offers PiP. You may notice a brief flash of the video tab.
- It happens at most once every 10 seconds.
- If it doesn't help on a page, for example because auto-PiP is blocked for that site, the mod stops trying there.

The page's DevTools console, with Verbose shown, logs which route was used: `browser asked`, `visibilitychange fallback` or `tab flip`.

## Keys inside the PiP window

| Key | Action |
| --- | --- |
| Space / K / click | Play / pause |
| ← / → | Seek back / forward (step set in settings) |
| ↑ / ↓ / mouse wheel | Volume |
| M | Mute |
| C | Captions on/off |
| F / double-click | Fullscreen on the monitor the PiP window is on; press again to go back to PiP |
| Esc (in fullscreen) | Back to PiP |

## Settings (right-click the hover button)

- Auto-PiP on tab switch, close on return, only for videos with sound, fallback delay
- Enhanced window on/off. Off means native PiP, as before.
- Open PiP where you last left it (on by default; needs the UI helper)
- Pause when the PiP window is closed, captions on by default, caption size, seek step
- Minimum video duration and size for the button and auto-PiP
- Button position (grid), opacity and toggle shortcut
- Blacklist: one entry per line, matched against the domain and path, e.g. `youtube.com/shorts`

Settings are stored in `chrome.storage` when this script can use it, which shares them across all sites. Otherwise they go in each site's `localStorage`, so they are per site. The settings dialog tells you which one is in use.

## Tested

Tested on Vivaldi 8.3.4191.35 (Chromium 156), November 2026:

| Site | Manual PiP | Auto-PiP on tab switch / close on return | Captions in PiP | Fullscreen |
| --- | --- | --- | --- | --- |
| kisskh.co | ✅ | ✅ | ✅ native subtitles | ✅ fullscreen on monitor 2 from a PiP placed there; keys, captions and all four exits (F, Esc, Back to tab, X) |
| Vimeo | ✅ | ✅ | ✅ picks the real `<track>` subtitles | ✅ |
| Twitch (live) | ✅ shows LIVE, no progress bar | ✅ | – stream had no captions | ✅ |
| Plain HTML5 + WebVTT `<track>` | ✅ | ✅ | ✅ | ✅ |
| Dailymotion | not tested: the player is behind a sign-up wall in a fresh profile | | | |

Remembered position, tested on two monitors with different scaling: after the PiP was dragged to monitor 2 (a real OS-level window move), it opened there again when reopened manually, from auto-PiP on tab switch, on a different site, and when coming back from fullscreen. Four open/close cycles in a row didn't shift it. A saved position on a monitor that doesn't exist left the PiP on a visible screen.

Vivaldi only injects this script into a page once the page creates a `<video>`. On sites like archive.org, which create the player after you click play, the hover button and Alt+P appear after playback starts.

## Notes and limitations

- Chromium always draws a thin title bar on document PiP windows, showing the site's origin and Chromium's own back-to-tab button. It sits above the video and doesn't cover it.
- The mod's own "Back to tab" button puts the video back, switches to its tab and closes PiP.
- While a video is fullscreen on another monitor, its tab lives in that fullscreen window. Leave with F, Esc or the buttons. Closing that window with Alt+F4 closes the tab, just like closing any window.
- Caption mirroring depends on each site's markup. YouTube is the most reliable. The other sites are best effort and may break when a site changes its player. Crunchyroll draws subtitles on a canvas, so they can't be mirrored.
- Videos inside closed shadow DOMs or cross-origin iframes are only handled when the script runs in that frame.
- Uninstall: put your backed-up original `picture-in-picture.js` back.
