// Download logic, independent of Electron so it can be tested with plain Node.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IG = /^https?:\/\/(?:www\.)?instagram\.com\/(reels?|p|tv)\/([A-Za-z0-9_-]+)/i;
const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'brave', 'opera', 'vivaldi'];

function normalise(url) {
  const m = IG.exec(String(url || '').trim());
  if (!m) return null;
  const kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
  return `https://www.instagram.com/${kind}/${m[2]}/`;
}

function friendly(stderr, timedOut) {
  const low = String(stderr || '').toLowerCase();
  if (timedOut) return 'This took too long. Please try again.';
  if (low.includes('rate-limit') || low.includes('login required') || low.includes('login page')) {
    return 'Instagram asked for a login. Open "Having trouble?" below and pick the browser where you are logged in to Instagram.';
  }
  if (low.includes('private')) return 'This account is private. Only public content can be downloaded.';
  if (low.includes('cookies')) return 'Could not read cookies from that browser. Close the browser and try again, or pick another one.';
  if (low.includes('unsupported url') || low.includes('there is no video')) return 'No downloadable video was found at this link.';
  return 'Could not fetch this link. Check the URL and try again.';
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', err = '', timedOut = false, done = false;
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e), timedOut: false });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err, timedOut }); };
    child.on('error', (e) => { err += String(e); finish(-1); });
    child.on('close', finish);
  });
}

function createCore({ binDir, outDir }) {
  const exe = (n) => path.join(binDir, n + (process.platform === 'win32' ? '.exe' : ''));
  const YTDLP = exe('yt-dlp');
  const FFMPEG = exe('ffmpeg');

  function ytdlp(args, cookies, timeoutMs) {
    const base = ['--no-playlist', '--no-warnings', '--no-cache-dir', '--no-update',
      '--socket-timeout', '20', '--ffmpeg-location', binDir];
    if (cookies && BROWSERS.includes(cookies)) base.push('--cookies-from-browser', cookies);
    return run(YTDLP, base.concat(args), timeoutMs);
  }

  async function getInfo(url, cookies) {
    const r = await ytdlp(['-J', url], cookies, 60000);
    let info;
    try { info = JSON.parse(r.out); } catch (_) { info = null; }
    if (r.code !== 0 || !info) throw new Error(friendly(r.err, r.timedOut));
    return info;
  }

  function pickThumb(info, width = 480) {
    let best = null, bestD = Infinity;
    for (const t of info.thumbnails || []) {
      if (!t.url) continue;
      const d = Math.abs((t.width || 0) - width);
      if (d < bestD) { best = t.url; bestD = d; }
    }
    return best || info.thumbnail || null;
  }

  async function fetchImage(u) {
    let host = '';
    try { const p = new URL(u); host = p.hostname.toLowerCase(); if (p.protocol !== 'https:') return null; } catch (_) { return null; }
    if (!/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(host)) return null;
    const res = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async function info(rawUrl, cookies) {
    const url = normalise(rawUrl);
    if (!url) throw new Error('Please enter a valid Instagram reel or post URL.');
    const i = await getInfo(url, cookies);
    let w = i.width || 0, h = i.height || 0;
    for (const f of i.formats || []) if ((f.height || 0) > h) { h = f.height; w = f.width || 0; }
    let thumb = null;
    try {
      const t = pickThumb(i);
      const img = t && await fetchImage(t);
      if (img) thumb = 'data:image/jpeg;base64,' + img.toString('base64');
    } catch (_) { /* thumbnail is optional */ }
    let title = String(i.title || i.description || '').trim();
    if (title.length > 120) title = title.slice(0, 117) + '…';
    return { id: i.id, title, uploader: i.uploader || i.channel || '', duration: Math.round(i.duration || 0), width: w, height: h, thumb };
  }

  async function get(rawUrl, type, cookies) {
    const url = normalise(rawUrl);
    if (!url) throw new Error('Please enter a valid Instagram reel or post URL.');
    if (!['video', 'h264', 'audio', 'photo'].includes(type)) throw new Error('Invalid download type.');
    fs.mkdirSync(outDir, { recursive: true });

    if (type === 'photo') {
      const i = await getInfo(url, cookies);
      const img = i.thumbnail && await fetchImage(i.thumbnail);
      if (!img) throw new Error('No image found for this link.');
      const file = path.join(outDir, `reel_${i.id}.jpg`);
      fs.writeFileSync(file, img);
      return { file };
    }

    const work = type === 'h264' ? fs.mkdtempSync(path.join(os.tmpdir(), 'reelsave-')) : outDir;
    try {
      const tpl = path.join(work, 'reel_%(id)s.%(ext)s');
      const args = type === 'audio'
        ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K']
        : ['-f', 'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b', '--merge-output-format', 'mp4'];
      const r = await ytdlp(args.concat(['-o', tpl, '--print', 'after_move:filepath', url]), cookies, 180000);
      const lines = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const produced = lines[lines.length - 1];
      if (r.code !== 0 || !produced || !fs.existsSync(produced)) throw new Error(friendly(r.err, r.timedOut));
      if (type !== 'h264') return { file: produced };

      const base = path.basename(produced, path.extname(produced));
      const out = path.join(outDir, `${base}_h264.mp4`);
      const c = await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', produced,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out], 600000);
      if (c.code !== 0 || !fs.existsSync(out)) throw new Error('Conversion failed. Use the original MP4 instead.');
      return { file: out };
    } finally {
      if (work !== outDir) fs.rmSync(work, { recursive: true, force: true });
    }
  }

  return { info, get, normalise };
}

module.exports = { createCore, normalise };
