const { app, BrowserWindow, ipcMain, shell, clipboard, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCore } = require('./core');

const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin');
const outDir = path.join(app.getPath('downloads'), 'ReelSave');
const core = createCore({ binDir, outDir });

// Real yt-dlp errors go to a log file (the UI only shows friendly messages).
function logError(err) {
  try {
    const dir = app.getPath('logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'reelsave.log'), `[${new Date().toISOString()}] ${err.detail || err.stack || err.message}\n\n`);
  } catch (_) { /* logging must never break the app */ }
}

// Small settings file: whether to show "Save as", and the last folder used.
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return { askWhere: true, lastDir: '', ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; }
  catch (_) { return { askWhere: true, lastDir: '' }; }
}
function saveSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s)); }
  catch (_) { /* settings are a convenience */ }
}

/** File name offered in the Save As box. */
function suggestName(meta, type, ext) {
  const m = meta || {};
  const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const prefix = { pinterest: 'pin', youtube: 'yt' }[m.platform] || 'reel';
  const id = clean(m.id) || 'download';
  const base = m.platform === 'youtube' && clean(m.title) ? `${clean(m.title)} [${id}]` : `${prefix}_${id}`;
  return `${base}${type === 'h264' ? '_h264' : ''}.${ext}`;
}

/** Move a finished file to the place the user chose (works across drives). */
function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); }
  catch (_) { fs.copyFileSync(from, to); fs.unlinkSync(from); }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 520, height: 780, minWidth: 400, minHeight: 560,
    title: 'ReelSave', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Never navigate the app window or open new windows; send links to the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

const wrap = (fn) => async (_e, ...a) => {
  try { return { ok: true, ...(await fn(...a)) }; }
  catch (err) { return { ok: false, error: err.message || 'Unexpected error.' }; }
};

ipcMain.handle('info', wrap((url, cookies) => core.info(url, cookies)));

ipcMain.handle('get', async (e, url, type, cookies, quality, meta) => {
  const send = (p) => { if (!e.sender.isDestroyed()) e.sender.send('progress', p); };
  const settings = loadSettings();
  let work = null;
  try {
    // Ask first, then download, so a cancel costs nothing.
    let dest = null;
    if (settings.askWhere) {
      const ext = type === 'audio' ? 'mp3' : type === 'photo' ? 'jpg' : 'mp4';
      const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
        title: 'Save as',
        buttonLabel: 'Save',
        defaultPath: path.join(settings.lastDir && fs.existsSync(settings.lastDir) ? settings.lastDir : outDir, suggestName(meta, type, ext)),
        filters: [{ name: ext.toUpperCase() + ' file', extensions: [ext] }],
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true, error: 'Save cancelled.' };
      dest = /\.[A-Za-z0-9]{2,4}$/.test(res.filePath) ? res.filePath : `${res.filePath}.${ext}`;
      saveSettings({ ...settings, lastDir: path.dirname(dest) });
    }

    if (!dest) {
      const r = await core.get(url, type, cookies, quality, send);
      return { ok: true, ...r };
    }
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'reelsave-out-'));
    const r = await createCore({ binDir, outDir: work }).get(url, type, cookies, quality, send);
    moveFile(r.file, dest);
    return { ok: true, file: dest };
  } catch (err) {
    logError(err);
    return { ok: false, error: err.message || 'Unexpected error.' };
  } finally {
    if (work) fs.rmSync(work, { recursive: true, force: true });
  }
});

ipcMain.handle('settings:get', () => { const s = loadSettings(); return { askWhere: !!s.askWhere }; });
ipcMain.handle('settings:set', (_e, patch) => {
  const s = loadSettings();
  if (patch && typeof patch.askWhere === 'boolean') s.askWhere = patch.askWhere;
  saveSettings(s);
  return { askWhere: !!s.askWhere };
});
ipcMain.handle('reveal', (_e, file) => { if (file) shell.showItemInFolder(file); });
ipcMain.handle('openFolder', () => {
  const s = loadSettings();
  const dir = s.askWhere && s.lastDir && fs.existsSync(s.lastDir) ? s.lastDir : outDir;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
ipcMain.handle('paste', () => clipboard.readText());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
