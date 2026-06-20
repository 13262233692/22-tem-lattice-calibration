const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getAddonStatus: () => ipcRenderer.invoke('addon:status'),
  
  loadTiff: (filePath) => ipcRenderer.invoke('tiff:load', filePath),
  getTiffWebP: (filePath, quality) => ipcRenderer.invoke('tiff:webp', filePath, quality),
  getTiffTiles: (filePath, tileSize) => ipcRenderer.invoke('tiff:tiles', filePath, tileSize),
  
  computeFFT: (filePath) => ipcRenderer.invoke('fft:compute', filePath),
  computeFFTFromShared: (memName, width, height) => ipcRenderer.invoke('fft:computeFromShared', memName, width, height),
  
  createSharedMemory: (name, size) => ipcRenderer.invoke('sharedmemory:create', name, size),
  writeImageToShared: (memName, imagePath) => ipcRenderer.invoke('sharedmemory:writeImage', memName, imagePath),
  closeSharedMemory: (name, size) => ipcRenderer.invoke('sharedmemory:close', name, size),
  
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  
  onFileSelected: (callback) => ipcRenderer.on('file-selected', (event, filePath) => callback(filePath)),
  onComputeFFT: (callback) => ipcRenderer.on('compute-fft', () => callback()),
  onComputeFFTShared: (callback) => ipcRenderer.on('compute-fft-shared', () => callback()),
  onExportFFT: (callback) => ipcRenderer.on('export-fft', () => callback()),
  
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
