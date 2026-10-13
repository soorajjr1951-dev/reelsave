# ReelSave desktop app (Windows + Mac)

Electron app for Instagram reels/posts, Pinterest pins (pinterest.com/pin/... and pin.it short links) and YouTube videos/Shorts.
YouTube: pick 360p to 1080p (or maximum, up to 4K), or save MP3 audio or the thumbnail. Playlists are not downloaded, only the single video.
Video pins save as MP4, MP4 (H.264), MP3 or JPG. Image-only pins save as JPG.
yt-dlp and ffmpeg are bundled, so users install nothing else.
A **Save as** window asks where to save each file (tick/untick "Ask where to save each file" in the app).
With it off, files go to `Downloads/ReelSave`.

## Windows (built)
`dist/ReelSave-1.0.0-Setup.exe` (installer) or `dist/ReelSave-1.0.0-Portable.exe` (no install).
Rebuild: `npm install && npm run dist:win`

Windows SmartScreen will say "unknown publisher" because the app is not code-signed.
Click "More info" then "Run anyway".

## Mac (must be built on a Mac or on GitHub)
Option A - on a Mac with Node 20+:
    npm install
    npm run dist:mac
  Output: dist/ReelSave-1.0.0-arm64.dmg (Apple Silicon) or -x64.dmg (Intel).

Option B - GitHub Actions (no Mac needed):
  1. Push this folder to a GitHub repo.
  2. Actions tab -> "Build desktop apps" -> Run workflow.
  3. Download the Windows, Mac Apple Silicon and Mac Intel files from the run's Artifacts.

The Mac app is not signed or notarized. First launch: right-click the app -> Open -> Open.
(If macOS says it is damaged: run `xattr -cr /Applications/ReelSave.app` once.)

## If downloads stop working
Instagram changes often. Update yt-dlp and rebuild: `npm run prepare-bin -- --update && npm run dist:win`.

## Dev
`npm start` runs the app. `node scripts/test-core.js <reel url>` tests all four download types without the GUI.

## Errors
The app shows friendly messages. The real yt-dlp error is written to a log file:
`%APPDATA%\reelsave\logs\reelsave.log` (Windows) or `~/Library/Logs/reelsave/reelsave.log` (Mac).
