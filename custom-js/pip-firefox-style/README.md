# Firefox-style Picture-in-Picture for Vivaldi

Firefox / Yandex-style picture-in-picture for Vivaldi:

- **Keeps videos playing in PiP when you switch tabs**, and closes PiP when you come back. This is on by default, like in Yandex.
- **No stuck title.** Vivaldi's native video PiP shows the video title at the top until you hover over it and move away. This mod opens a *Document Picture-in-Picture* window instead, so that overlay is gone.
- **Captions toggle (CC)** inside the PiP window:
  - The video's own subtitle tracks (WebVTT `<track>`, HLS subtitles) are shown and hidden directly. This covers kisskh, Vimeo and most HTML5 players. If a site keeps empty placeholder tracks, the mod picks a track that actually has subtitles, in your browser's language when there is one. When PiP closes, the tracks go back to how the site had them.
  - Sites that draw captions as page text and have no subtitle tracks get that text mirrored into the PiP window, the way Firefox does it: YouTube, Netflix, Prime Video and Disney+. On YouTube, CC also turns YouTube's own captions on, and turns them off again when PiP closes.
- **Fullscreen toggle** (button, `F` or double-click). Chromium doesn't allow fullscreen inside a PiP window ("Fullscreen is not supported") and caps the window at about half the screen, so:
  - **If you're on the video's tab:** the video goes back into the site's player and that player goes **truly fullscreen**, with the site's own subtitles. Esc leaves fullscreen as usual.
  - **If you're on another tab:** the PiP window is **maximized** as far as the browser allows (about half the screen). Press `F` or double-click again to restore the size.
- Its own controls: play/pause, ±seek, progress bar, volume, back to tab and close. The controls hide automatically.
- A hover button on videos, like stock Vivaldi. **Right-click it for settings.** `Alt+P` toggles PiP for the best video on the page.

## Install

1. Close Vivaldi.
2. Go to `<Vivaldi>\Application\<version>\resources\vivaldi\components\picture-in-picture\`
   (for example `%LOCALAPPDATA%\Vivaldi\Application\7.x.xxxx.xx\resources\vivaldi\components\picture-in-picture\`).
3. **Back up** the original `picture-in-picture.js`.
4. Replace it with `picture-in-picture.js` from this folder.
5. Start Vivaldi.

The file gets overwritten when Vivaldi updates, so copy it in again after each update.

## Flags for automatic PiP on tab switch

The automatic part uses Chromium's auto-PiP media-session hook, the same one *Better Auto PiP* needs. Open `vivaldi://flags`, search for **picture-in-picture**, and enable:

- **Auto picture-in-picture for video playback** (`#auto-picture-in-picture-for-video-playback`)
- **Document Picture-in-Picture API** (`#document-picture-in-picture-api`), if it is listed and not already on

Leave **browser-initiated automatic picture-in-picture** **disabled**. Otherwise Chromium may open its own native PiP window, which has the title bug.

If a site asks about "Automatic picture-in-picture", allow it. You can also set it in the site's settings.

Without the flag, the mod falls back to trying PiP on `visibilitychange`. That only works if you interacted with the page within the last few seconds, which is a browser restriction.

## Keys inside the PiP window

| Key | Action |
| --- | --- |
| Space / K / click | Play / pause |
| ← / → | Seek back / forward (step set in settings) |
| ↑ / ↓ / mouse wheel | Volume |
| M | Mute |
| C | Captions on/off |
| F / double-click | Real fullscreen in the tab (if the tab is visible), otherwise maximize / restore the PiP window |

## Settings (right-click the hover button)

- Auto-PiP on tab switch, close on return, only for videos with sound, fallback delay
- Enhanced window on/off. Off means native PiP, as before.
- Pause when the PiP window is closed, captions on by default, caption size, seek step
- Minimum video duration and size for the button and auto-PiP
- Button position (grid), opacity and toggle shortcut
- Blacklist: one entry per line, matched against the domain and path, e.g. `youtube.com/shorts`

Settings are stored in `chrome.storage` when this script can use it, which shares them across all sites. Otherwise they go in each site's `localStorage`, so they are per site. The settings dialog tells you which one is in use.

## Tested

Tested on Vivaldi 8.3.4191.35 (Chromium 156), November 2026:

| Site | Manual PiP | Auto-PiP on tab switch / close on return | Captions in PiP | Fullscreen |
| --- | --- | --- | --- | --- |
| kisskh.co | ✅ | ✅ | ✅ native subtitles | ✅ real fullscreen in tab; maximize when tab hidden |
| Vimeo | ✅ | ✅ | ✅ picks the real `<track>` subtitles | ✅ |
| Twitch (live) | ✅ shows LIVE, no progress bar | ✅ | – stream had no captions | ✅ |
| Plain HTML5 + WebVTT `<track>` | ✅ | ✅ | ✅ | ✅ |
| Dailymotion | not tested: the player is behind a sign-up wall in a fresh profile | | | |

Vivaldi only injects this script into a page once the page creates a `<video>`. On sites like archive.org, which create the player after you click play, the hover button and Alt+P appear after playback starts.

## Notes and limitations

- Chromium always draws a thin title bar on document PiP windows, showing the site's origin and Chromium's own back-to-tab button. It sits above the video and doesn't cover it.
- The mod's own "Back to tab" button puts the video back, switches to its tab and closes PiP.
- Caption mirroring depends on each site's markup. YouTube is the most reliable. The other sites are best effort and may break when a site changes its player. Crunchyroll draws subtitles on a canvas, so they can't be mirrored.
- Videos inside closed shadow DOMs or cross-origin iframes are only handled when the script runs in that frame.
- Uninstall: put your backed-up original `picture-in-picture.js` back.
