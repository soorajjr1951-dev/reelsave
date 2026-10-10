const { app, BrowserWindow, ipcMain, shell, clipboard } = require('electron');
const path = require('path');
const { createCore } = require('./core');

const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin');
const outDir = path.join(app.getPath('downloads'), 'ReelSave');
const core = createCore({ binDir, outDir });

// Real yt-dlp errors go to a log file (the UI only shows friendly messages).
function logError(err) {
  try {
    const dir = app.getPath('logs');
    require('fs').mkdirSync(dir, { recursive: true });
    require('fs').appendFileSync(path.join(dir, 'reelsave.log'), `[${new Date().toISOString()}] ${err.detail || err.stack || err.message}

`);
  } catch (_) { /* logging must never break the app */ }
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
ipcMain.handle('get', async (e, url, type, cookies, quality) => {
  try {
    const r = await core.get(url, type, cookies, quality, (p) => { if (!e.sender.isDestroyed()) e.sender.send('progress', p); });
    return { ok: true, ...r };
  } catch (err) { logError(err); return { ok: false, error: err.message || 'Unexpected error.' }; }
});
ipcMain.handle('reveal', (_e, file) => { if (file) shell.showItemInFolder(file); });
ipcMain.handle('openFolder', () => shell.openPath(outDir));
ipcMain.handle('paste', () => clipboard.readText());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
