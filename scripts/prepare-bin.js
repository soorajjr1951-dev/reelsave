// Fetches yt-dlp (official GitHub release) and copies ffmpeg (from the ffmpeg-static package)
// into ./bin for the current platform. Run automatically by `npm run dist:*`.
const fs = require('fs');
const path = require('path');

const bin = path.join(__dirname, '..', 'bin');
fs.mkdirSync(bin, { recursive: true });
const win = process.platform === 'win32';

const asset = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' }[process.platform];
if (!asset) throw new Error('Unsupported platform ' + process.platform);

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

(async () => {
  const ytdlp = path.join(bin, win ? 'yt-dlp.exe' : 'yt-dlp');
  if (!fs.existsSync(ytdlp) || process.argv.includes('--update')) {
    console.log('Downloading yt-dlp:', asset);
    await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, ytdlp);
    if (!win) fs.chmodSync(ytdlp, 0o755);
  } else console.log('yt-dlp already in bin/ (use --update to refresh)');

  const ffmpegSrc = require('ffmpeg-static');
  if (!ffmpegSrc || !fs.existsSync(ffmpegSrc)) throw new Error('ffmpeg-static did not provide a binary for this platform.');
  const ffmpeg = path.join(bin, win ? 'ffmpeg.exe' : 'ffmpeg');
  fs.copyFileSync(ffmpegSrc, ffmpeg);
  if (!win) fs.chmodSync(ffmpeg, 0o755);
  console.log('Binaries ready in', bin);
})().catch((e) => { console.error(e.message); process.exit(1); });
