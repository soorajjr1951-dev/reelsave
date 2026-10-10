const $ = (id) => document.getElementById(id);
const urlIn = $('url'), box = $('box'), btn = $('btn'), msg = $('msg'), card = $('card');
const LINK = /^https?:\/\/(?:(?:www\.)?instagram\.com\/(?:reels?|p|tv)\/[A-Za-z0-9_-]+|(?:[a-z0-9-]+\.)?pinterest\.[a-z.]{2,7}\/pin\/[^/?#]+|pin\.it\/[A-Za-z0-9_-]+)/i;
const isPin = (v) => /pinterest\.|pin\.it\//i.test(v);
const TITLES = {
  instagram: { video: 'Instagram Reels Download', audio: 'Instagram Audio Download (MP3)', photo: 'Instagram Photo Download' },
  pinterest: { video: 'Pinterest Video Download', audio: 'Pinterest Audio Download (MP3)', photo: 'Pinterest Image Download' },
};
const OPTS = {
  video: { t: 'video', label: '⬇ Download MP4', sub: 'Original quality · fastest', short: 'MP4' },
  h264:  { t: 'h264',  label: '⬇ Download MP4 (H.264)', sub: 'Plays on every device · slower', short: 'MP4 H.264' },
  audio: { t: 'audio', label: '⬇ Download MP3', sub: 'Audio only · 192 kbps', short: 'MP3' },
  photo: { t: 'photo', label: '⬇ Download JPG', sub: 'Cover image · full size', short: 'JPG' },
};
let tab = 'video', platform = 'instagram', current = null, busy = false, lastUrl = '', lastFile = null;
function setTitle() { $('title').textContent = TITLES[platform][current && current.imageOnly ? 'photo' : tab]; }

const cookies = () => $('cookies').value;
try { $('cookies').value = localStorage.getItem('cookies') || ''; } catch (_) {}
$('cookies').onchange = () => { try { localStorage.setItem('cookies', cookies()); } catch (_) {} };

function setMsg(text, cls) { msg.className = cls || ''; msg.textContent = text; }
const fmtDur = (s) => (s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '');
function syncBox() {
  const v = urlIn.value.trim();
  if (v && LINK.test(v)) { platform = isPin(v) ? 'pinterest' : 'instagram'; setTitle(); }
  box.classList.toggle('filled', v.length > 0);
  box.classList.toggle('bad', v.length > 8 && !LINK.test(v));
}

function renderButtons() {
  const imageOnly = current && current.imageOnly;
  const p = imageOnly ? OPTS.photo : OPTS[tab], main = $('mainBtn');
  main.textContent = '';
  main.append(p.label);
  const small = document.createElement('small'); small.textContent = p.sub; main.append(small);
  main.onclick = () => download(p);
  const others = $('others'); others.textContent = '';
  Object.values(OPTS).filter((o) => !imageOnly && o.t !== p.t).forEach((o) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = o.short; b.title = o.sub;
    b.onclick = () => download(o);
    others.appendChild(b);
  });
}

function reset(focus) {
  card.classList.remove('show'); current = null; lastUrl = ''; lastFile = null;
  $('showBtn').hidden = true; urlIn.value = ''; syncBox(); setMsg('');
  if (focus) urlIn.focus();
}

async function search() {
  const v = urlIn.value.trim();
  if (busy || !v) return;
  if (!LINK.test(v)) { setMsg('That does not look like an Instagram or Pinterest link.', 'err'); return; }
  if (v === lastUrl && current) return;
  busy = true; btn.disabled = true; card.classList.remove('show'); current = null; lastFile = null;
  $('showBtn').hidden = true;
  setMsg('Searching…');
  const j = await window.api.info(v, cookies());
  if (j.ok) {
    current = j; lastUrl = v; platform = j.platform || 'instagram'; setTitle();
    $('thumb').src = j.thumb || '';
    $('ctitle').textContent = j.title || (platform === 'pinterest' ? 'Pinterest pin' : 'Instagram reel');
    $('cinfo').textContent = [j.uploader && '@' + j.uploader, fmtDur(j.duration), j.height && (j.width + '×' + j.height)].filter(Boolean).join(' · ') || (j.imageOnly ? 'Image pin (no video)' : '');
    renderButtons(); card.classList.add('show'); setMsg('');
  } else setMsg(j.error, 'err');
  busy = false; btn.disabled = false;
}

async function download(opt) {
  if (busy || !current) return;
  busy = true;
  const ctrls = card.querySelectorAll('.main, .others button');
  ctrls.forEach((b) => (b.disabled = true));
  $('bar').classList.add('on');
  setMsg(opt.t === 'h264' ? 'Converting to H.264… this can take a minute.' : 'Downloading…');
  const r = await window.api.get(lastUrl, opt.t, cookies());
  if (r.ok) {
    lastFile = r.file;
    const name = r.file.split(/[\\/]/).pop();
    setMsg('✓ Saved ' + name, 'ok');
    $('showBtn').hidden = false;
  } else setMsg(r.error, 'err');
  $('bar').classList.remove('on');
  ctrls.forEach((b) => (b.disabled = false));
  busy = false;
}

$('f').addEventListener('submit', (e) => { e.preventDefault(); search(); });
urlIn.addEventListener('input', syncBox);
urlIn.addEventListener('paste', () => setTimeout(() => { syncBox(); if (LINK.test(urlIn.value.trim())) search(); }, 0));
$('clearBtn').onclick = () => reset(true);
$('again').onclick = () => reset(true);
$('showBtn').onclick = () => lastFile && window.api.reveal(lastFile);
$('folderBtn').onclick = () => window.api.openFolder();
$('pasteBtn').onclick = async () => {
  const t = ((await window.api.paste()) || '').trim();
  if (!t) { setMsg('Clipboard is empty. Copy a link first.', 'err'); return; }
  urlIn.value = t; syncBox();
  if (LINK.test(t)) search(); else setMsg('That does not look like an Instagram or Pinterest link.', 'err');
};
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.type;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  setTitle();
  if (current) renderButtons();
});
syncBox();
urlIn.focus();
