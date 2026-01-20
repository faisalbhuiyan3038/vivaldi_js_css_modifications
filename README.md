# Vivaldi Mods Collection

A collection of custom CSS and JavaScript modifications to enhance the Vivaldi browser UI and functionality.

## ✨ Features

### Functional Enhancements (JavaScript)
- **🚀 Easy Files**: Supercharge your file uploads! Quickly pick files from your recent downloads or clipboard directly from the file upload dialog.
- **🎬 Advanced Picture-in-Picture**: Powerful PiP mode with auto-activation when switching tabs, customizable shortcuts (Boss Key), and seek controls.
- **🎵 Global Media Controls**: A dedicated panel to manage all your media playback across all tabs in one place.
- **📸 Element Capture**: Precision screenshot tool that allows you to capture specific UI elements or webpage components easily.
- **🎨 Colorful Loading Bar**: A sleek, animated progress bar at the top of the window that indicates page loading status with vibrant colors.
- **🔍 Yandex-Style Address Bar**: Modernizes the address bar to show the domain prominently and the page title in the center, inspired by Yandex Browser.

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

---

> [!NOTE]
> For the best experience, ensure your Vivaldi browser is up to date. Some JavaScript mods utilize private Vivaldi APIs that may change between versions.
