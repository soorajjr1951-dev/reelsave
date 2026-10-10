const { contextBridge, ipcRenderer } = require('electron');

let progressHandler = null;
ipcRenderer.on('progress', (_e, p) => { if (progressHandler) progressHandler(p); });

contextBridge.exposeInMainWorld('api', {
  info: (url, cookies) => ipcRenderer.invoke('info', url, cookies),
  get: (url, type, cookies, quality) => ipcRenderer.invoke('get', url, type, cookies, quality),
  onProgress: (cb) => { progressHandler = typeof cb === 'function' ? cb : null; },
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  openFolder: () => ipcRenderer.invoke('openFolder'),
  paste: () => ipcRenderer.invoke('paste'),
});
