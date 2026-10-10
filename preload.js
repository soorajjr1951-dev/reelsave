const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  info: (url, cookies) => ipcRenderer.invoke('info', url, cookies),
  get: (url, type, cookies) => ipcRenderer.invoke('get', url, type, cookies),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  openFolder: () => ipcRenderer.invoke('openFolder'),
  paste: () => ipcRenderer.invoke('paste'),
});
