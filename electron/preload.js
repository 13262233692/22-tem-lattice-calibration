const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getAddonStatus: () => ipcRenderer.invoke('addon:status'),
  
  loadTiff: (filePath) => ipcRenderer.invoke('tiff:load', filePath),
  getTiffWebP: (filePath, quality) => ipcRenderer.invoke('tiff:webp', filePath, quality),
  getTiffTiles: (filePath, tileSize) => ipcRenderer.invoke('tiff:tiles', filePath, tileSize),
  
  computeFFT: (filePath) => ipcRenderer.invoke('fft:compute', filePath),
  computeFFTFromShared: (memName, width, height) => ipcRenderer.invoke('fft:computeFromShared', memName, width, height),
  
  computeFFTAsync: (filePath) => ipcRenderer.invoke('fft:computeAsync', filePath),
  computeFFTFromSharedAsync: (memName, width, height) => ipcRenderer.invoke('fft:computeFromSharedAsync', memName, width, height),
  readSpectrumBuffer: (memName, width, height) => ipcRenderer.invoke('spectrum:readBuffer', memName, width, height),
  releaseSpectrum: (memName) => ipcRenderer.invoke('spectrum:release', memName),
  
  createSharedMemory: (name, size) => ipcRenderer.invoke('sharedmemory:create', name, size),
  writeImageToShared: (memName, imagePath) => ipcRenderer.invoke('sharedmemory:writeImage', memName, imagePath),
  closeSharedMemory: (name, size) => ipcRenderer.invoke('sharedmemory:close', name, size),
  
  analyzeDislocations: (filePath, roiPolygon, options) => ipcRenderer.invoke('dislocation:analyze', filePath, roiPolygon, options),
  analyzeDislocationsFromShared: (memName, width, height, roiPolygon, options) => ipcRenderer.invoke('dislocation:analyzeFromShared', memName, width, height, roiPolygon, options),
  
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
  
  onFileSelected: (callback) => ipcRenderer.on('file-selected', (event, filePath) => callback(filePath)),
  onComputeFFT: (callback) => ipcRenderer.on('compute-fft', () => callback()),
  onComputeFFTShared: (callback) => ipcRenderer.on('compute-fft-shared', () => callback()),
  onExportFFT: (callback) => ipcRenderer.on('export-fft', () => callback()),
  
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
