import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useImageStore = defineStore('image', () => {
  const currentFile = ref(null)
  const imageInfo = ref(null)
  const imageData = ref(null)
  const imageTiles = ref([])
  const fftResult = ref(null)
  const fftSpectrumBuffer = ref(null)
  const isLoading = ref(false)
  const loadingText = ref('')
  const loadingProgress = ref(0)
  const addonStatus = ref({ loaded: false })
  const systemInfo = ref(null)
  const sharedMemoryName = ref('Local\\TEM_Image_Buffer')
  const fftComputeTimeMs = ref(0)
  const spectrumMemName = ref(null)
  
  const roiPolygon = ref([])
  const isDrawingROI = ref(false)
  const dislocationResult = ref(null)
  const dislocationLoading = ref(false)
  const selectedDislocationId = ref(null)
  
  const isImageLoaded = computed(() => imageInfo.value !== null)
  const isFFTReady = computed(() => fftResult.value !== null)
  const isFFTComputing = computed(() => isLoading.value && loadingText.value.includes('FFT'))
  
  const fileSize = computed(() => {
    if (!imageInfo.value) return 0
    const { width, height, bitDepth, channels } = imageInfo.value
    return (width * height * bitDepth * channels) / 8
  })
  
  const formattedFileSize = computed(() => {
    const bytes = fileSize.value
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  })

  async function loadAddonStatus() {
    try {
      const status = await window.electronAPI.getAddonStatus()
      addonStatus.value = status
    } catch (err) {
      console.error('Failed to get addon status:', err)
    }
  }

  async function loadSystemInfo() {
    try {
      const info = await window.electronAPI.getSystemInfo()
      systemInfo.value = info
    } catch (err) {
      console.error('Failed to get system info:', err)
    }
  }

  async function loadTiff(filePath) {
    isLoading.value = true
    loadingText.value = '正在解析 TIFF 图像...'
    loadingProgress.value = 10
    currentFile.value = filePath
    
    try {
      const info = await window.electronAPI.loadTiff(filePath)
      imageInfo.value = info
      loadingProgress.value = 40
      
      loadingText.value = '正在转码为 WebP 格式...'
      const webpData = await window.electronAPI.getTiffWebP(filePath, 90)
      
      const blob = new Blob([new Uint8Array(webpData.data)], { type: webpData.type })
      imageData.value = URL.createObjectURL(blob)
      loadingProgress.value = 70
      
      if (info.width > 4096 || info.height > 4096) {
        loadingText.value = '正在生成图像分片...'
        const tiles = await window.electronAPI.getTiffTiles(filePath, 1024)
        imageTiles.value = tiles.map(tile => {
          const blob = new Blob([new Uint8Array(tile)], { type: 'image/webp' })
          return URL.createObjectURL(blob)
        })
      }
      
      loadingProgress.value = 100
      isLoading.value = false
      loadingText.value = ''
      
      return { success: true, info }
    } catch (err) {
      isLoading.value = false
      loadingText.value = ''
      console.error('Failed to load TIFF:', err)
      return { success: false, error: err.message }
    }
  }

  async function releaseSpectrumMemory() {
    if (spectrumMemName.value) {
      try {
        await window.electronAPI.releaseSpectrum(spectrumMemName.value)
      } catch (e) {
        console.warn('Failed to release spectrum memory:', e)
      }
      spectrumMemName.value = null
    }
    fftSpectrumBuffer.value = null
  }

  async function loadSpectrumPixels() {
    if (!spectrumMemName.value || !fftResult.value) {
      return null
    }
    
    try {
      const buffer = await window.electronAPI.readSpectrumBuffer(
        spectrumMemName.value,
        fftResult.value.width,
        fftResult.value.height
      )
      fftSpectrumBuffer.value = new Uint8ClampedArray(buffer)
      return fftSpectrumBuffer.value
    } catch (e) {
      console.error('Failed to load spectrum pixels from shared memory:', e)
      return null
    }
  }

  async function computeFFT(useSharedMemory = false) {
    if (!currentFile.value) {
      return { success: false, error: '未加载图像' }
    }
    
    await releaseSpectrumMemory()
    
    isLoading.value = true
    loadingProgress.value = 5
    
    if (useSharedMemory) {
      loadingText.value = 'C++ 线程池正在写入原始图像到共享内存...'
    } else {
      loadingText.value = 'C++ Worker 线程池正在异步执行 2D-FFT...'
    }
    
    try {
      let metaResult
      loadingProgress.value = 15
      
      if (useSharedMemory) {
        loadingText.value = 'C++ 线程池：原始图像 → 共享内存...'
        const writeResult = await window.electronAPI.writeImageToShared(
          sharedMemoryName.value, 
          currentFile.value
        )
        loadingProgress.value = 30
        
        loadingText.value = 'C++ 线程池：从共享内存执行异步 FFT 变换...'
        metaResult = await window.electronAPI.computeFFTFromSharedAsync(
          sharedMemoryName.value,
          imageInfo.value.width,
          imageInfo.value.height
        )
        
        try {
          await window.electronAPI.closeSharedMemory(
            sharedMemoryName.value,
            writeResult.dataSize
          )
        } catch (e) { /* ignore */ }
      } else {
        loadingText.value = 'C++ 线程池：异步执行 2D-FFT（零拷贝共享内存输出）...'
        metaResult = await window.electronAPI.computeFFTAsync(currentFile.value)
      }
      
      loadingProgress.value = 75
      
      if (!metaResult || !metaResult.success) {
        throw new Error(metaResult?.errorMessage || 'FFT 计算失败')
      }
      
      fftComputeTimeMs.value = metaResult.computeTimeMs || 0
      spectrumMemName.value = metaResult.spectrumMemName
      
      loadingText.value = `FFT 完成 (${fftComputeTimeMs.value}ms)，正在读取频谱纹理...`
      
      const normalizedResult = {
        width: metaResult.spectrumWidth,
        height: metaResult.spectrumHeight,
        dominantFrequency: metaResult.dominantFrequency,
        latticeSpacing: metaResult.latticeSpacing,
        diffractionSpots: metaResult.diffractionSpots || []
      }
      
      fftResult.value = normalizedResult
      
      loadingProgress.value = 90
      loadingText.value = '正在上传到 GPU 纹理...'
      
      await loadSpectrumPixels()
      
      loadingProgress.value = 100
      isLoading.value = false
      loadingText.value = ''
      
      return { success: true, result: normalizedResult, computeTimeMs: fftComputeTimeMs.value }
    } catch (err) {
      isLoading.value = false
      loadingText.value = ''
      console.error('FFT computation failed:', err)
      return { success: false, error: err.message }
    }
  }

  function clearFFT() {
    releaseSpectrumMemory()
    fftResult.value = null
  }
  
  function setROIPolygon(polygon) {
    roiPolygon.value = polygon || []
  }
  
  function setDrawingROI(drawing) {
    isDrawingROI.value = drawing
  }
  
  function clearROI() {
    roiPolygon.value = []
    isDrawingROI.value = false
    dislocationResult.value = null
    selectedDislocationId.value = null
  }
  
  async function analyzeDislocations() {
    if (!currentFile.value || roiPolygon.value.length < 3) {
      return { success: false, error: '请先绘制 ROI 多边形区域' }
    }
    
    dislocationLoading.value = true
    dislocationResult.value = null
    
    try {
      const bounds = getROIBounds()
      const options = {
        roiWidth: Math.round(bounds.width),
        roiHeight: Math.round(bounds.height)
      }
      
      const result = await window.electronAPI.analyzeDislocations(
        currentFile.value,
        roiPolygon.value,
        options
      )
      
      if (result && result.success) {
        dislocationResult.value = result
        return { success: true, result }
      } else {
        throw new Error(result?.error || '位错分析失败')
      }
    } catch (err) {
      console.error('Dislocation analysis failed:', err)
      return { success: false, error: err.message }
    } finally {
      dislocationLoading.value = false
    }
  }
  
  function getROIBounds() {
    if (roiPolygon.value.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const pt of roiPolygon.value) {
      minX = Math.min(minX, pt.x)
      minY = Math.min(minY, pt.y)
      maxX = Math.max(maxX, pt.x)
      maxY = Math.max(maxY, pt.y)
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }
  
  function selectDislocation(id) {
    selectedDislocationId.value = id
  }
  
  function clearDislocationResult() {
    dislocationResult.value = null
    selectedDislocationId.value = null
  }

  function clearImage() {
    if (imageData.value) {
      URL.revokeObjectURL(imageData.value)
    }
    imageTiles.value.forEach(tile => URL.revokeObjectURL(tile))
    releaseSpectrumMemory()
    
    currentFile.value = null
    imageInfo.value = null
    imageData.value = null
    imageTiles.value = []
    fftResult.value = null
  }

  return {
    currentFile,
    imageInfo,
    imageData,
    imageTiles,
    fftResult,
    fftSpectrumBuffer,
    isLoading,
    loadingText,
    loadingProgress,
    addonStatus,
    systemInfo,
    sharedMemoryName,
    fftComputeTimeMs,
    spectrumMemName,
    roiPolygon,
    isDrawingROI,
    dislocationResult,
    dislocationLoading,
    selectedDislocationId,
    isImageLoaded,
    isFFTReady,
    isFFTComputing,
    isDislocationReady: computed(() => dislocationResult.value !== null),
    fileSize,
    formattedFileSize,
    loadAddonStatus,
    loadSystemInfo,
    loadTiff,
    computeFFT,
    clearFFT,
    clearImage,
    loadSpectrumPixels,
    releaseSpectrumMemory,
    setROIPolygon,
    setDrawingROI,
    clearROI,
    analyzeDislocations,
    getROIBounds,
    selectDislocation,
    clearDislocationResult
  }
})
