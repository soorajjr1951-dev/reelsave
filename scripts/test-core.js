// Usage: node scripts/test-core.js <instagram reel url>
const os = require('os');
const path = require('path');
const fs = require('fs');
const { createCore } = require('../core');

const url = process.argv[2];
if (!url) { console.error('Pass a reel URL.'); process.exit(1); }
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsave-test-'));
const core = createCore({ binDir: path.join(__dirname, '..', 'bin'), outDir: out });

(async () => {
  const i = await core.info(url);
  console.log('info:', i.id, `${i.width}x${i.height}`, i.title, 'thumb:', !!i.thumb);
  for (const t of ['video', 'h264', 'audio', 'photo']) {
    const r = await core.get(url, t);
    console.log(t, '->', path.basename(r.file), fs.statSync(r.file).size, 'bytes');
  }
  try { await core.info('https://example.com/x'); } catch (e) { console.log('bad url ->', e.message); }
  console.log('files in', out);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
