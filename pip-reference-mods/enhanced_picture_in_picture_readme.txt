What's different

Button position - You can now place the button wherever you want. Top-right, bottom-left, center... there's a little visual grid in the settings where you just click where you want it.
Boss Key - A global hotkey (Alt+P by default) that toggles PiP instantly. No need to hover and click - it finds the best video on the page automatically. Handy when someone walks into your office.
Auto-PiP - Switch to another tab and the video automatically pops into PiP mode. Come back and it returns to normal. There's a configurable delay so it doesn't trigger accidentally.
Blacklist - Some sites are annoying with PiP (looking at you, TikTok and YouTube Shorts). Just add them to the blacklist and the script leaves them alone.
Stealth mode - The button can be semi-transparent when you're not hovering over it. Less distracting when you're actually watching something.
Size and duration filters - Set minimum dimensions and duration for videos. Stops the button from appearing on every tiny thumbnail and 5-second ad on the page.
Seek interval - Configure how far the media controls skip. I prefer 15 seconds, you might want 5.
Settings

Right-click the button to open the settings panel. Everything's configurable without touching the code.

Technical stuff
I've added proper Shadow DOM isolation, input sanitization, event listener cleanup, and a fallback for when localStorage is broken (which apparently happens on some Vivaldi snapshots). The button also won't randomly appear at the top-left corner of the page anymore - it stays hidden until it's actually positioned over a video.

How to Use This Modification:
This modification involves replacing existing Vivaldi browser component files. Proceed with caution.

IMPORTANT: Back up your original files first! Before making any changes, navigate to your Vivaldi installation folder, then into the Application\[VERSION]\resources\vivaldi\components\picture-in-picture\ directory. (Replace [INSTALLATIONFOLDER] with your actual Vivaldi installation path and [VERSION] with your Vivaldi version number, e.g., 7.4.3684.38). Create a copy of the original picture-in-picture.js file and store it in a safe place. This will allow you to revert the changes if needed.
You will need the modified picture-in-picture.js file.
Close Vivaldi completely.
Replace the original picture-in-picture.js in the Vivaldi directory mentioned above with the new, modified picture-in-picture.js file.
Restart Vivaldi.
There were a lot of versions and really much tinkering how to get things done correctly - thanks to the users here ❤