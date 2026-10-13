const { contextBridge, ipcRenderer } = require('electron');

let progressHandler = null;
ipcRenderer.on('progress', (_e, p) => { if (progressHandler) progressHandler(p); });

contextBridge.exposeInMainWorld('api', {
  info: (url, cookies) => ipcRenderer.invoke('info', url, cookies),
  get: (url, type, cookies, quality, meta) => ipcRenderer.invoke('get', url, type, cookies, quality, meta),
  onProgress: (cb) => { progressHandler = typeof cb === 'function' ? cb : null; },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  openFolder: () => ipcRenderer.invoke('openFolder'),
  paste: () => ipcRenderer.invoke('paste'),
});
