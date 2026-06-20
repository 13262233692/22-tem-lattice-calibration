import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useImageStore = defineStore('image', () => {
  const currentFile = ref(null)
  const imageInfo = ref(null)
  const imageData = ref(null)
  const imageTiles = ref([])
  const fftResult = ref(null)
  const isLoading = ref(false)
  const loadingText = ref('')
  const addonStatus = ref({ loaded: false })
  const systemInfo = ref(null)
  const sharedMemoryName = ref('Local\\TEM_Image_Buffer')
  
  const isImageLoaded = computed(() => imageInfo.value !== null)
  const isFFTReady = computed(() => fftResult.value !== null)
  
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
    currentFile.value = filePath
    
    try {
      const info = await window.electronAPI.loadTiff(filePath)
      imageInfo.value = info
      
      loadingText.value = '正在转码为 WebP 格式...'
      const webpData = await window.electronAPI.getTiffWebP(filePath, 90)
      
      const blob = new Blob([new Uint8Array(webpData.data)], { type: webpData.type })
      imageData.value = URL.createObjectURL(blob)
      
      if (info.width > 4096 || info.height > 4096) {
        loadingText.value = '正在生成图像分片...'
        const tiles = await window.electronAPI.getTiffTiles(filePath, 1024)
        imageTiles.value = tiles.map(tile => {
          const blob = new Blob([new Uint8Array(tile)], { type: 'image/webp' })
          return URL.createObjectURL(blob)
        })
      }
      
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

  async function computeFFT(useSharedMemory = false) {
    if (!currentFile.value) {
      return { success: false, error: '未加载图像' }
    }
    
    isLoading.value = true
    loadingText.value = useSharedMemory 
      ? '正在通过共享内存执行 2D-FFT 变换...' 
      : '正在执行 2D-FFT 变换...'
    
    try {
      let result
      
      if (useSharedMemory) {
        loadingText.value = '正在写入共享内存...'
        const writeResult = await window.electronAPI.writeImageToShared(
          sharedMemoryName.value, 
          currentFile.value
        )
        
        loadingText.value = '正在从共享内存执行 FFT...'
        result = await window.electronAPI.computeFFTFromShared(
          sharedMemoryName.value,
          imageInfo.value.width,
          imageInfo.value.height
        )
        
        await window.electronAPI.closeSharedMemory(
          sharedMemoryName.value,
          writeResult.dataSize
        )
      } else {
        result = await window.electronAPI.computeFFT(currentFile.value)
      }
      
      fftResult.value = result
      isLoading.value = false
      loadingText.value = ''
      
      return { success: true, result }
    } catch (err) {
      isLoading.value = false
      loadingText.value = ''
      console.error('FFT computation failed:', err)
      return { success: false, error: err.message }
    }
  }

  function clearImage() {
    if (imageData.value) {
      URL.revokeObjectURL(imageData.value)
    }
    imageTiles.value.forEach(tile => URL.revokeObjectURL(tile))
    
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
    isLoading,
    loadingText,
    addonStatus,
    systemInfo,
    sharedMemoryName,
    isImageLoaded,
    isFFTReady,
    fileSize,
    formattedFileSize,
    loadAddonStatus,
    loadSystemInfo,
    loadTiff,
    computeFFT,
    clearImage
  }
})
