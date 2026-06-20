const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const os = require('os')

let addon = null
let mainWindow = null
const activeSpectrumHandles = new Set()

function loadAddon() {
  try {
    addon = require('bindings')('tem_image_processor.node')
    console.log('[TEM] C++ Addon loaded (bindings)')
    return true
  } catch (err) {
    console.warn('[TEM] Failed bindings addon:', err.message)
    const buildPath = path.join(__dirname, '..', 'build', 'Release', 'tem_image_processor.node')
    try {
      addon = require(buildPath)
      console.log('[TEM] C++ Addon loaded (build path)')
      return true
    } catch (err2) {
      console.warn('[TEM] Failed build path addon:', err2.message)
      console.log('[TEM] Falling back to JS mock addon...')
      try {
        addon = require('./mock-addon.js')
        console.log('[TEM] JS mock addon loaded OK (dev mode)')
        return true
      } catch (err3) {
        console.error('[TEM] Mock addon also failed:', err3.message)
        return false
      }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.maximize()
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  createMenu()
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开 TIFF 图像',
          accelerator: 'Ctrl+O',
          click: () => {
            dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'TIFF 图像', extensions: ['tif', 'tiff'] },
                { name: '所有文件', extensions: ['*'] }
              ]
            }).then(result => {
              if (!result.canceled && result.filePaths.length > 0) {
                mainWindow.webContents.send('file-selected', result.filePaths[0])
              }
            }).catch(err => console.error(err))
          }
        },
        { type: 'separator' },
        {
          label: '导出 FFT 频谱图',
          accelerator: 'Ctrl+S',
          click: () => mainWindow.webContents.send('export-fft')
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'F5', click: () => mainWindow.reload() },
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
      ]
    },
    {
      label: '分析',
      submenu: [
        {
          label: '执行 2D-FFT 分析（异步线程池）',
          accelerator: 'Ctrl+F',
          click: () => mainWindow.webContents.send('compute-fft')
        },
        {
          label: '共享内存零拷贝 FFT',
          accelerator: 'Ctrl+Shift+F',
          click: () => mainWindow.webContents.send('compute-fft-shared')
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function trackSpectrum(memName) {
  if (memName) activeSpectrumHandles.add(memName)
}

function releaseAllSpectra() {
  if (!addon) return
  for (const memName of activeSpectrumHandles) {
    try { addon.closeSharedMemory(memName) } catch (e) {}
  }
  activeSpectrumHandles.clear()
}

app.whenReady().then(() => {
  loadAddon()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  releaseAllSpectra()
  try { if (addon && addon.shutdownThreadPool) addon.shutdownThreadPool() } catch (e) {}
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  releaseAllSpectra()
  try { if (addon && addon.shutdownThreadPool) addon.shutdownThreadPool() } catch (e) {}
})

ipcMain.handle('addon:status', () => ({ loaded: addon !== null }))

ipcMain.handle('tiff:load', async (event, filePath) => {
  if (!addon) throw new Error('Addon not loaded')
  return addon.loadTiff(filePath)
})

ipcMain.handle('tiff:webp', async (event, filePath, quality = 90) => {
  if (!addon) throw new Error('Addon not loaded')
  const buffer = addon.getImageWebP(filePath, quality)
  return { data: Array.from(buffer), type: 'image/webp' }
})

ipcMain.handle('tiff:tiles', async (event, filePath, tileSize = 1024) => {
  if (!addon) throw new Error('Addon not loaded')
  const tiles = addon.getImageTiles(filePath, tileSize)
  return tiles.map(tile => Array.from(tile))
})

ipcMain.handle('fft:compute', async (event, filePath) => {
  if (!addon) throw new Error('Addon not loaded')
  const result = addon.computeFFT(filePath)
  result.spectrumData = Array.from(result.spectrumData)
  return result
})

ipcMain.handle('fft:computeAsync', async (event, filePath) => {
  if (!addon) throw new Error('Addon not loaded')
  if (!addon.computeFFTAsync) {
    console.warn('[TEM] addon.computeFFTAsync not available, falling back to sync')
    const result = addon.computeFFT(filePath)
    result.spectrumData = Array.from(result.spectrumData)
    return result
  }
  const result = await addon.computeFFTAsync(filePath, true)
  if (result && result.spectrumMemName) {
    trackSpectrum(result.spectrumMemName)
    console.log(`[TEM] FFT async done in ${result.computeTimeMs}ms, spectrum @ ${result.spectrumMemName}`)
  }
  return result
})

ipcMain.handle('sharedmemory:create', async (event, name, size) => {
  if (!addon) throw new Error('Addon not loaded')
  return addon.createSharedMemory(name, size)
})

ipcMain.handle('sharedmemory:writeImage', async (event, memName, imagePath) => {
  if (!addon) throw new Error('Addon not loaded')
  return addon.writeImageToSharedMemory(memName, imagePath)
})

ipcMain.handle('fft:computeFromShared', async (event, memName, width, height) => {
  if (!addon) throw new Error('Addon not loaded')
  const result = addon.computeFFTFromSharedMemory(memName, width, height)
  result.spectrumData = Array.from(result.spectrumData)
  return result
})

ipcMain.handle('fft:computeFromSharedAsync', async (event, memName, width, height) => {
  if (!addon) throw new Error('Addon not loaded')
  if (!addon.computeFFTFromSharedAsync) {
    console.warn('[TEM] addon.computeFFTFromSharedAsync not available, falling back')
    const result = addon.computeFFTFromSharedMemory(memName, width, height)
    result.spectrumData = Array.from(result.spectrumData)
    return result
  }
  const result = await addon.computeFFTFromSharedAsync(memName, width, height)
  if (result && result.spectrumMemName) {
    trackSpectrum(result.spectrumMemName)
    console.log(`[TEM] FFT shared-async done in ${result.computeTimeMs}ms, spectrum @ ${result.spectrumMemName}`)
  }
  return result
})

ipcMain.handle('spectrum:readBuffer', async (event, memName, width, height) => {
  if (!addon) throw new Error('Addon not loaded')
  if (!addon.readSpectrumFromSharedMemory) {
    throw new Error('readSpectrumFromSharedMemory not available in current addon')
  }
  const buffer = addon.readSpectrumFromSharedMemory(memName, width, height)
  return Buffer.from(buffer)
})

ipcMain.handle('spectrum:release', async (event, memName) => {
  if (!addon || !memName) return false
  try {
    addon.closeSharedMemory(memName)
    activeSpectrumHandles.delete(memName)
    return true
  } catch (e) {
    console.error('[TEM] Failed to release spectrum memory:', e.message)
    return false
  }
})

ipcMain.handle('sharedmemory:close', async (event, name, size) => {
  if (!addon) throw new Error('Addon not loaded')
  return addon.closeSharedMemory(name, size)
})

ipcMain.handle('system:info', () => ({
  platform: os.platform(),
  arch: os.arch(),
  cpus: os.cpus().length,
  totalMem: os.totalmem(),
  freeMem: os.freemem(),
  tmpdir: os.tmpdir()
}))
