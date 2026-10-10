// Download logic, independent of Electron so it can be tested with plain Node.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const IG = /^https?:\/\/(?:www\.)?instagram\.com\/(reels?|p|tv)\/([A-Za-z0-9_-]+)/i;
const PIN = /^https?:\/\/(?:[a-z0-9-]+\.)?pinterest\.[a-z.]{2,7}\/pin\/([^/?#]+)/i;
const PIN_SHORT = /^https?:\/\/pin\.it\/([A-Za-z0-9_-]+)/i;
const YT = /^https?:\/\/(?:(?:www\.|m\.|music\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const QUALITIES = ['best', '1080', '720', '480', '360'];
const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'brave', 'opera', 'vivaldi'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Returns { platform, url } for a supported link, or null. pin.it short links are kept as-is (see resolve). */
function normalise(raw) {
  const s = String(raw || '').trim();
  let m = IG.exec(s);
  if (m) {
    const kind = m[1].toLowerCase() === 'reels' ? 'reel' : m[1].toLowerCase();
    return { platform: 'instagram', url: `https://www.instagram.com/${kind}/${m[2]}/` };
  }
  m = PIN.exec(s);
  if (m) {
    const id = /(\d+)$/.exec(m[1]);
    if (id) return { platform: 'pinterest', url: `https://www.pinterest.com/pin/${id[1]}/` };
  }
  m = PIN_SHORT.exec(s);
  if (m) return { platform: 'pinterest', url: `https://pin.it/${m[1]}`, short: true };
  m = YT.exec(s);
  if (m) return { platform: 'youtube', url: `https://www.youtube.com/watch?v=${m[1]}`, id: m[1] };
  return null;
}

/** Like normalise, but follows pin.it short links to the real pin URL. */
async function resolve(raw) {
  const n = normalise(raw);
  if (!n || !n.short) return n;
  try {
    const res = await fetch(n.url, { redirect: 'follow', headers: { 'User-Agent': UA } });
    const real = normalise(res.url);
    return real && !real.short ? real : null;
  } catch (_) { return null; }
}

function friendly(stderr, timedOut, platform) {
  const low = String(stderr || '').toLowerCase();
  if (timedOut) return 'This took too long. Please try again.';
  if (platform === 'youtube') {
    if (low.includes('not a bot') || low.includes('sign in to confirm')) return 'YouTube asked to confirm you are not a bot. Open "Having trouble?" below and pick the browser where you are logged in to YouTube.';
    if (low.includes('age') && low.includes('confirm')) return 'This video is age-restricted. Open "Having trouble?" below and pick a browser where you are logged in to YouTube.';
    if (low.includes('private video')) return 'This video is private.';
    if (low.includes('members-only') || low.includes('members only')) return 'This video is for channel members only.';
    if (low.includes('not available') || low.includes('unavailable') || low.includes('removed')) return 'This video is unavailable in your region or was removed.';
    if (low.includes('live event') || low.includes('is live')) return 'Live streams cannot be downloaded until they finish.';
    if (low.includes('cookies')) return 'Could not read cookies from that browser. Close the browser and try again, or pick another one.';
    return 'Could not fetch this video. Check the link and try again.';
  }
  if (platform === 'pinterest') {
    if (low.includes('no video') || low.includes('unable to extract') || low.includes('unsupported url')) return 'This pin has no video. Use the Photo tab to save its image.';
    if (low.includes('404') || low.includes('not found')) return 'This pin was not found. It may have been deleted or is private.';
    return 'Could not fetch this pin. Check the link and try again.';
  }
  if (low.includes('rate-limit') || low.includes('login required') || low.includes('login page')) {
    return 'Instagram asked for a login. Open "Having trouble?" below and pick the browser where you are logged in to Instagram.';
  }
  if (low.includes('private')) return 'This account is private. Only public content can be downloaded.';
  if (low.includes('cookies')) return 'Could not read cookies from that browser. Close the browser and try again, or pick another one.';
  if (low.includes('unsupported url') || low.includes('there is no video')) return 'No downloadable video was found at this link.';
  return 'Could not fetch this link. Check the URL and try again.';
}

function run(cmd, args, timeoutMs, onData) {
  return new Promise((resolve) => {
    let out = '', err = '', timedOut = false, done = false;
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e), timedOut: false });
    }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; if (onData) onData(String(d)); });
    child.stderr.on('data', (d) => { err += d; if (onData) onData(String(d)); });
    const finish = (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ code, out, err, timedOut }); };
    child.on('error', (e) => { err += String(e); finish(-1); });
    child.on('close', finish);
  });
}

function createCore({ binDir, outDir }) {
  const exe = (n) => path.join(binDir, n + (process.platform === 'win32' ? '.exe' : ''));
  const YTDLP = exe('yt-dlp');
  const FFMPEG = exe('ffmpeg');

  function ytdlp(args, cookies, timeoutMs, onData) {
    const base = ['--no-playlist', '--no-warnings', '--no-cache-dir', '--no-update',
      '--socket-timeout', '20', '--ffmpeg-location', binDir];
    if (cookies && BROWSERS.includes(cookies)) base.push('--cookies-from-browser', cookies);
    return run(YTDLP, base.concat(args), timeoutMs, onData);
  }

  /** Turns yt-dlp progress lines into a 0-100 number for the UI. */
  function progressParser(onProgress, streams = 1) {
    if (!onProgress) return undefined;
    // yt-dlp reports each stream (video, then audio) from 0-100; fold them into one steady 0-100.
    let buf = '', prev = -1, idx = 0, shown = -1;
    return (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n|\r/);
      buf = lines.pop();
      for (const l of lines) {
        const m = /^RSPROG\s+([\d.]+)%/.exec(l.trim());
        if (!m) continue;
        const p = Math.min(100, parseFloat(m[1]));
        if (prev >= 0 && p < prev - 20 && idx < streams - 1) idx++;
        prev = p;
        const overall = Math.min(100, Math.round(((idx * 100) + p) / streams));
        if (overall > shown) { shown = overall; onProgress(overall); }
      }
    };
  }

  async function getInfo(target, cookies) {
    const r = await ytdlp(['-J', target.url], cookies, 60000);
    let info;
    try { info = JSON.parse(r.out); } catch (_) { info = null; }
    if (r.code !== 0 || !info) throw new Error(friendly(r.err, r.timedOut, target.platform));
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
    if (!/(^|\.)(cdninstagram\.com|fbcdn\.net|pinimg\.com|ytimg\.com)$/.test(host)) return null;
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  /** Pinterest image pins have no video, so read the pin page's Open Graph tags instead. */
  async function scrapePin(url) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' } });
      if (!res.ok) return null;
      const html = await res.text();
      const og = (prop) => {
        for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
          const key = /(?:property|name)\s*=\s*"([^"]*)"/i.exec(tag);
          const val = /content\s*=\s*"([^"]*)"/i.exec(tag);
          if (key && val && key[1].toLowerCase() === prop) return val[1].replace(/&amp;/g, '&');
        }
        return null;
      };
      const image = og('og:image');
      if (!image) return null;
      return { image, title: og('og:title') || '', id: /\/pin\/(\d+)/.exec(url)[1] };
    } catch (_) { return null; }
  }

  /** Best available picture for a pin: the /originals/ version if it exists, else the page's image. */
  async function pinImage(image) {
    const orig = image.replace(/\/(?:\d+x\d*|\d+x)\//, '/originals/');
    return (orig !== image && await fetchImage(orig).catch(() => null)) || fetchImage(image);
  }

  async function info(rawUrl, cookies) {
    const target = await resolve(rawUrl);
    if (!target) throw new Error('Please paste a valid Instagram reel/post or Pinterest pin link.');
    let i;
    try {
      i = await getInfo(target, cookies);
    } catch (err) {
      if (target.platform !== 'pinterest') throw err;
      // No video in this pin: offer the image if there is one.
      const pin = await scrapePin(target.url);
      if (!pin) throw err;
      const img = await fetchImage(pin.image).catch(() => null);
      return {
        platform: 'pinterest', imageOnly: true, id: pin.id, title: pin.title.slice(0, 120), uploader: '',
        duration: 0, width: 0, height: 0, thumb: img ? 'data:image/jpeg;base64,' + img.toString('base64') : null,
      };
    }
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
    return { platform: target.platform, imageOnly: false, id: i.id, title, uploader: i.uploader || i.channel || '', duration: Math.round(i.duration || 0), width: w, height: h, thumb };
  }

  /** yt-dlp -f expression for a YouTube quality cap. H.264 is preferred so files play everywhere. */
  function youtubeFormat(quality) {
    if (quality === 'best') return 'bv*+ba/b';
    const h = QUALITIES.includes(quality) ? quality : '1080';
    return `bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
  }

  async function get(rawUrl, type, cookies, quality, onProgress) {
    const target = await resolve(rawUrl);
    if (!target) throw new Error('Please paste a valid Instagram, Pinterest or YouTube link.');
    if (!['video', 'h264', 'audio', 'photo'].includes(type)) throw new Error('Invalid download type.');
    fs.mkdirSync(outDir, { recursive: true });
    const prefix = { pinterest: 'pin', youtube: 'yt' }[target.platform] || 'reel';

    if (type === 'photo') {
      let img = null, id;
      if (target.platform === 'youtube') {
        id = target.id;
        for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
          img = await fetchImage(`https://i.ytimg.com/vi/${id}/${name}.jpg`).catch(() => null);
          if (img) break;
        }
      }
      if (!img && target.platform === 'pinterest') {
        const pin = await scrapePin(target.url);
        if (pin) { id = pin.id; img = await pinImage(pin.image); }
      }
      if (!img) {
        const i = await getInfo(target, cookies);
        id = i.id; img = i.thumbnail && await fetchImage(i.thumbnail);
      }
      if (!img) throw new Error('No image found for this link.');
      const file = path.join(outDir, `${prefix}_${id}.jpg`);
      fs.writeFileSync(file, img);
      return { file };
    }

    const work = type === 'h264' ? fs.mkdtempSync(path.join(os.tmpdir(), 'reelsave-')) : outDir;
    try {
      const yt = target.platform === 'youtube';
      // YouTube gets readable file names; the others keep the short id-based names.
      const tpl = path.join(work, yt ? 'yt_%(title).70B [%(id)s].%(ext)s' : `${prefix}_%(id)s.%(ext)s`);
      const videoFormat = yt ? youtubeFormat(quality) : 'bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b';
      const args = type === 'audio'
        ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '192K']
        : ['-f', videoFormat, '--merge-output-format', 'mp4'];
      if (yt) args.push('--windows-filenames');
      args.push('--newline', '--progress', '--progress-template', 'download:RSPROG %(progress._percent_str)s');
      const r = await ytdlp(args.concat(['-o', tpl, '--print', 'after_move:filepath', target.url]),
        cookies, yt ? 3600000 : 180000, progressParser(onProgress, type === 'audio' ? 1 : 2));
      const lines = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const produced = lines[lines.length - 1];
      if (r.code !== 0 || !produced || !fs.existsSync(produced)) {
        const e = new Error(friendly(r.err, r.timedOut, target.platform));
        e.detail = `get ${type} ${target.url} exit=${r.code} timedOut=${r.timedOut}
${String(r.err).slice(-1500)}`;
        throw e;
      }
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

  return { info, get };
}

module.exports = { createCore, normalise, resolve };
