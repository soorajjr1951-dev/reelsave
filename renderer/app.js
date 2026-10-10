const $ = (id) => document.getElementById(id);
const urlIn = $('url'), box = $('box'), btn = $('btn'), msg = $('msg'), card = $('card');
const IG = /^https?:\/\/(www\.)?instagram\.com\/(reels?|p|tv)\/[A-Za-z0-9_-]+/i;
const titles = { video: 'Instagram Reels Download', audio: 'Instagram Audio Download (MP3)', photo: 'Instagram Photo Download' };
const OPTS = {
  video: { t: 'video', label: '⬇ Download MP4', sub: 'Original quality · fastest', short: 'MP4' },
  h264:  { t: 'h264',  label: '⬇ Download MP4 (H.264)', sub: 'Plays on every device · slower', short: 'MP4 H.264' },
  audio: { t: 'audio', label: '⬇ Download MP3', sub: 'Audio only · 192 kbps', short: 'MP3' },
  photo: { t: 'photo', label: '⬇ Download JPG', sub: 'Cover image · full size', short: 'JPG' },
};
let tab = 'video', current = null, busy = false, lastUrl = '', lastFile = null;

const cookies = () => $('cookies').value;
try { $('cookies').value = localStorage.getItem('cookies') || ''; } catch (_) {}
$('cookies').onchange = () => { try { localStorage.setItem('cookies', cookies()); } catch (_) {} };

function setMsg(text, cls) { msg.className = cls || ''; msg.textContent = text; }
const fmtDur = (s) => (s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '');
function syncBox() {
  const v = urlIn.value.trim();
  box.classList.toggle('filled', v.length > 0);
  box.classList.toggle('bad', v.length > 8 && !IG.test(v));
}

function renderButtons() {
  const p = OPTS[tab], main = $('mainBtn');
  main.textContent = '';
  main.append(p.label);
  const small = document.createElement('small'); small.textContent = p.sub; main.append(small);
  main.onclick = () => download(p);
  const others = $('others'); others.textContent = '';
  Object.values(OPTS).filter((o) => o.t !== p.t).forEach((o) => {
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
  if (!IG.test(v)) { setMsg('That does not look like an Instagram reel link.', 'err'); return; }
  if (v === lastUrl && current) return;
  busy = true; btn.disabled = true; card.classList.remove('show'); current = null; lastFile = null;
  $('showBtn').hidden = true;
  setMsg('Searching…');
  const j = await window.api.info(v, cookies());
  if (j.ok) {
    current = j; lastUrl = v;
    $('thumb').src = j.thumb || '';
    $('ctitle').textContent = j.title || 'Instagram reel';
    $('cinfo').textContent = [j.uploader && '@' + j.uploader, fmtDur(j.duration), j.height && (j.width + '×' + j.height)].filter(Boolean).join(' · ');
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
urlIn.addEventListener('paste', () => setTimeout(() => { syncBox(); if (IG.test(urlIn.value.trim())) search(); }, 0));
$('clearBtn').onclick = () => reset(true);
$('again').onclick = () => reset(true);
$('showBtn').onclick = () => lastFile && window.api.reveal(lastFile);
$('folderBtn').onclick = () => window.api.openFolder();
$('pasteBtn').onclick = async () => {
  const t = ((await window.api.paste()) || '').trim();
  if (!t) { setMsg('Clipboard is empty. Copy a reel link first.', 'err'); return; }
  urlIn.value = t; syncBox();
  if (IG.test(t)) search(); else setMsg('That does not look like an Instagram reel link.', 'err');
};
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tab = b.dataset.type;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
  $('title').textContent = titles[tab];
  if (current) renderButtons();
});
syncBox();
urlIn.focus();
