# Vivaldi Mods Collection

A collection of custom CSS and JavaScript modifications to enhance the Vivaldi browser UI and functionality.

## Vivaldi Mod Managers
1. If you're on windows, use [Vivaldi Mod Manager](https://github.com/eximido/vivaldimodmanager)
2. If you're on linux, see [Vivaldi-Autoinject-Custom-js-ui](https://aur.archlinux.org/vivaldi-autoinject-custom-js-ui.git) for more info
3. See also [Patching Vivaldi with batch scripts](https://forum.vivaldi.net/topic/10592/patching-vivaldi-with-batch-scripts/21?page=2) for all platform
4. If you're on macOS use [macOS_Patch_Scripts | upviv](https://github.com/PaRr0tBoY/Vivaldi-Mods/blob/8a1e9f8a63f195f67f27ab2e5b86c4aff0081096/macOS_Patch_Scripts/upviv) as a reference for patchscript

## Full Width VIvaldi mod
1. Open `Application\*\resources\vivaldi\bundle.js` from the Vivaldi installation directory in a text editor.
1. Find the line that a constant declaration with the value `180,`, which is the default maximum tab width. The name of the constant can change across different Vivaldi releases when the file is minified.
1. Replace `180` with the number of pixels that you want tabs to expand horizontally to, like `4000`.
1. Restart Vivaldi for the change to take effect.

See [Aldaviva/Vivaldi customizations.md](https://gist.github.com/Aldaviva/9fbe321331b7f80786a371e0fd4bcfaf#file-bundle-js-md) for more details.

## Hints
- Allow the Developer Tools to inspect the browser chrome using the `chrome://flags/#debug-packed-apps` flag.
- The constant is used by the `getTabConfig` method from the `TabStrip.jsx` file included in `bundle.js`.
- `bundle.js` will be overwritten during upgrades, so you may want to develop a [program that can automatically patch this file](https://github.com/Aldaviva/VivaldiCustomLauncher).

## ✨ Features

### Functional Enhancements (JavaScript)
- **🚀 Easy Files**: Supercharge your file uploads! Quickly pick files from your recent downloads or clipboard directly from the file upload dialog.
- **🎬 Advanced Picture-in-Picture**: Powerful PiP mode with auto-activation when switching tabs, customizable shortcuts (Boss Key), and seek controls.
- **🎵 Global Media Controls**: A dedicated panel to manage all your media playback across all tabs in one place.
- **📸 Element Capture**: Precision screenshot tool that allows you to capture specific UI elements or webpage components easily.
- **🎨 Colorful Loading Bar**: A sleek, animated progress bar at the top of the window that indicates page loading status with vibrant colors.
- **🔍 Yandex-Style Address Bar**: Modernizes the address bar to show the domain prominently and the page title in the center, inspired by Yandex Browser.
- **🤖 AI Tab Stack**: Intelligently groups tabs using AI (GLM API) to keep your workspace tidy.
- **🔒 Browser Lock**: Password-protects your browser session with a secure, full-screen overlay, blocking all interaction until unlocked.
- **💬 Link Dialog**: Opens links in a convenient popup dialog via middle-click or context menu, saving tab space.

### UI Improvements (CSS)
- **🛠️ Vertical Extension Menu**: Reorganizes the extension dropdown into a clean vertical list, making it easier to manage many extensions.
- **🖼️ Enhanced Dialogs**: Beautifully styled dialog containers with smooth animations and backdrop blur effects.

---

## 🛠️ Installation Guide

### 1. CSS Modifications (Easy)
Vivaldi has built-in support for custom CSS.

1.  Open Vivaldi and go to `vivaldi://experiments/`.
2.  Enable **"Allow for using CSS modifications"**.
3.  Go to **Settings > Appearance > Custom UI Modifications**.
4.  Click **"Select Folder"** and choose the `css` folder from this repository.
5.  **Restart Vivaldi** to apply changes.

### 2. JavaScript Modifications (Advanced)
JS mods require modifying Vivaldi's core UI file. **Note:** These changes must be re-applied after Vivaldi updates.

1.  Locate your Vivaldi application directory:
    - `C:\Users\<YourUsername>\AppData\Local\Vivaldi\Application\<Version>\resources\vivaldi\`
2.  **Backup** `window.html` before proceeding.
3.  Open `window.html` in a text editor.
4.  Before the closing `</body>` tag, add script tags for the mods you want to use:
    ```html
    <script src="custom-js/colorful-loading-bar.js"></script>
    <script src="custom-js/yandex-browser-title-bar.js"></script>
    <!-- Add others as needed -->
    ```
5.  Place the `custom-js` folder into the same directory as `window.html`.
6.  **Restart Vivaldi**.

---

## 👨‍💻 Credits
Many of these high-quality modifications were originally written by **Tam710562**, a prominent member of the Vivaldi modding community.
The **AI Tab Stack** and **Browser Lock** mods were personally developed by me.

---

> [!NOTE]
> For the best experience, ensure your Vivaldi browser is up to date. Some JavaScript mods utilize private Vivaldi APIs that may change between versions.
