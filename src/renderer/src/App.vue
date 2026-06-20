<template>
  <div class="app-container">
    <header class="app-header">
      <div class="header-left">
        <el-icon class="logo-icon"><Microscope /></el-icon>
        <div class="title-group">
          <h1 class="app-title">TEM Lattice Calibration</h1>
          <p class="app-subtitle">透射电子显微镜晶格校准系统 v1.0</p>
        </div>
      </div>
      <div class="header-right">
        <el-tag :type="imageStore.addonStatus.loaded ? 'success' : 'danger'" size="default">
          <el-icon style="margin-right: 4px;"><Cpu /></el-icon>
          {{ imageStore.addonStatus.loaded ? 'C++ Addon 已加载' : 'C++ Addon 未加载' }}
        </el-tag>
        <el-button type="primary" size="default" @click="openFileDialog" :disabled="imageStore.isLoading">
          <el-icon><FolderOpened /></el-icon>
          <span>打开 TIFF</span>
        </el-button>
      </div>
    </header>

    <div class="main-content">
      <aside class="left-sidebar">
        <el-card shadow="never">
          <template #header>
            <div class="panel-title">
              <el-icon class="icon"><DataAnalysis /></el-icon>
              <span>图像信息</span>
            </div>
          </template>
          <div v-if="imageStore.isImageLoaded">
            <div class="info-row">
              <span class="info-label">分辨率</span>
              <span class="info-value">{{ imageStore.imageInfo.width }} × {{ imageStore.imageInfo.height }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">位深</span>
              <span class="info-value">{{ imageStore.imageInfo.bitDepth }} bit</span>
            </div>
            <div class="info-row">
              <span class="info-label">通道数</span>
              <span class="info-value">{{ imageStore.imageInfo.channels }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">像素格式</span>
              <span class="info-value">{{ imageStore.imageInfo.pixelFormat }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">最小值</span>
              <span class="info-value">{{ imageStore.imageInfo.minValue.toFixed(0) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">最大值</span>
              <span class="info-value">{{ imageStore.imageInfo.maxValue.toFixed(0) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">数据大小</span>
              <span class="info-value">{{ imageStore.formattedFileSize }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">分片数量</span>
              <span class="info-value">{{ imageStore.imageTiles.length || 1 }}</span>
            </div>
          </div>
          <div v-else class="empty-state">
            <el-icon size="48" style="color: var(--text-secondary);"><Picture /></el-icon>
            <p>暂无图像数据</p>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px;">
          <template #header>
            <div class="panel-title">
              <el-icon class="icon"><Operation /></el-icon>
              <span>FFT 分析</span>
            </div>
          </template>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <el-button 
              type="primary" 
              :disabled="!imageStore.isImageLoaded || imageStore.isLoading"
              @click="runFFT(false)"
            >
              <el-icon><MagicStick /></el-icon>
              <span>执行 2D-FFT</span>
            </el-button>
            <el-button 
              type="success" 
              :disabled="!imageStore.isImageLoaded || imageStore.isLoading"
              @click="runFFT(true)"
            >
              <el-icon><Connection /></el-icon>
              <span>共享内存 FFT</span>
            </el-button>
            <el-button 
              type="warning" 
              :disabled="!imageStore.isFFTReady"
              @click="exportFFT"
            >
              <el-icon><Download /></el-icon>
              <span>导出频谱图</span>
            </el-button>
          </div>

          <div v-if="imageStore.isFFTReady" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--border-color);">
            <div class="info-row">
              <span class="info-label">主频</span>
              <span class="info-value">{{ imageStore.fftResult.dominantFrequency.toFixed(6) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">晶格间距</span>
              <span class="info-value">{{ imageStore.fftResult.latticeSpacing.toFixed(4) }} nm</span>
            </div>
            <div class="info-row">
              <span class="info-label">衍射斑点</span>
              <span class="info-value">{{ imageStore.fftResult.diffractionSpots.length }}</span>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px;">
          <template #header>
            <div class="panel-title">
              <el-icon class="icon"><Connection /></el-icon>
              <span>位错分析</span>
            </div>
          </template>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <el-button 
              type="warning" 
              :disabled="!imageStore.isImageLoaded || imageStore.roiPolygon.length < 3 || imageStore.dislocationLoading"
              @click="runDislocationAnalysis"
              :loading="imageStore.dislocationLoading"
            >
              <el-icon><MagicStick /></el-icon>
              <span>执行 GPA 位错分析</span>
            </el-button>
            <el-button 
              type="info" 
              :disabled="imageStore.roiPolygon.length === 0"
              @click="clearROI"
              plain
            >
              <el-icon><Delete /></el-icon>
              <span>清除 ROI</span>
            </el-button>
          </div>

          <div v-if="imageStore.roiPolygon.length > 0" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--border-color);">
            <div class="info-row">
              <span class="info-label">ROI 顶点</span>
              <span class="info-value">{{ imageStore.roiPolygon.length }} 个</span>
            </div>
            <div class="info-row">
              <span class="info-label">ROI 尺寸</span>
              <span class="info-value">{{ roiBounds.width.toFixed(0) }} × {{ roiBounds.height.toFixed(0) }}</span>
            </div>
          </div>

          <div v-if="imageStore.isDislocationReady" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed var(--border-color);">
            <div class="info-row">
              <span class="info-label">分析方法</span>
              <span class="info-value">{{ imageStore.dislocationResult.method }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">位错数量</span>
              <span class="info-value highlight">{{ imageStore.dislocationResult.numDislocations }} 条</span>
            </div>
            <div class="info-row">
              <span class="info-label">计算耗时</span>
              <span class="info-value">{{ imageStore.dislocationResult.computeTimeMs }} ms</span>
            </div>
            
            <div style="margin-top: 12px;">
              <div class="section-label" style="font-size: 12px; color: var(--text-secondary); font-weight: 600; margin-bottom: 8px;">检测到位错列表</div>
              <div style="max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
                <div 
                  v-for="line in imageStore.dislocationResult.dislocationLines" 
                  :key="line.id"
                  class="dislocation-item"
                  :class="{ active: imageStore.selectedDislocationId === line.id }"
                  @click="selectDislocation(line.id)"
                >
                  <span class="dislocation-type" :class="line.type">
                    {{ line.typeName }}
                  </span>
                  <span class="dislocation-burgers">
                    b = {{ line.burgersMagnitude_angstrom.toFixed(2) }} Å
                  </span>
                </div>
              </div>
            </div>
          </div>
        </el-card>

        <el-card shadow="never" style="margin-top: 16px;">
          <template #header>
            <div class="panel-title">
              <el-icon class="icon"><Monitor /></el-icon>
              <span>系统信息</span>
            </div>
          </template>
          <div v-if="imageStore.systemInfo">
            <div class="info-row">
              <span class="info-label">操作系统</span>
              <span class="info-value">{{ imageStore.systemInfo.platform }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">架构</span>
              <span class="info-value">{{ imageStore.systemInfo.arch }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">CPU 核心</span>
              <span class="info-value">{{ imageStore.systemInfo.cpus }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">总内存</span>
              <span class="info-value">{{ (imageStore.systemInfo.totalMem / 1024 / 1024 / 1024).toFixed(1) }} GB</span>
            </div>
          </div>
        </el-card>
      </aside>

      <main class="main-view">
        <div class="view-toolbar">
          <div class="toolbar-left">
            <button 
              class="toolbar-btn" 
              :class="{ active: toolMode === 'pan' }"
              @click="toolMode = 'pan'"
              title="平移 (Space)"
            >
              <el-icon><Rank /></el-icon>
            </button>
            <button 
              class="toolbar-btn" 
              :class="{ active: toolMode === 'zoom' }"
              @click="toolMode = 'zoom'"
              title="缩放 (Z)"
            >
              <el-icon><ZoomIn /></el-icon>
            </button>
            <button 
              class="toolbar-btn" 
              :class="{ active: toolMode === 'measure' }"
              @click="toolMode = 'measure'"
              title="测量 (M)"
            >
              <el-icon><Ruler /></el-icon>
            </button>
            <button 
              class="toolbar-btn" 
              :class="{ active: toolMode === 'roi' }"
              @click="toolMode = 'roi'"
              title="ROI 多边形 (R)"
            >
              <el-icon><Grid /></el-icon>
            </button>
            <div class="divider"></div>
            <button 
              class="toolbar-btn" 
              @click="zoomIn"
              title="放大 (+)"
            >
              <el-icon><Plus /></el-icon>
            </button>
            <button 
              class="toolbar-btn" 
              @click="zoomOut"
              title="缩小 (-)"
            >
              <el-icon><Minus /></el-icon>
            </button>
            <button 
              class="toolbar-btn" 
              @click="resetView"
              title="重置视图 (0)"
            >
              <el-icon><Refresh /></el-icon>
            </button>
            <button 
              class="toolbar-btn" 
              @click="fitView"
              title="适应窗口 (F)"
            >
              <el-icon><FullScreen /></el-icon>
            </button>
          </div>
          <div class="toolbar-right">
            <el-tag type="info">
              缩放: {{ (scale * 100).toFixed(1) }}%
            </el-tag>
            <el-tag v-if="imageStore.isImageLoaded" type="info">
              {{ imageStore.imageInfo.width }} × {{ imageStore.imageInfo.height }}
            </el-tag>
          </div>
        </div>

        <div class="canvas-area">
          <ImageCanvas
            ref="imageCanvasRef"
            :image-data="imageStore.imageData"
            :image-tiles="imageStore.imageTiles"
            :image-info="imageStore.imageInfo"
            :tool-mode="toolMode"
            :scale="scale"
            :offset-x="offsetX"
            :offset-y="offsetY"
            :is-loading="imageStore.isLoading"
            :loading-text="imageStore.loadingText"
            :dislocation-lines="imageStore.dislocationResult?.dislocationLines || []"
            :roi-offset-x="roiBounds.x"
            :roi-offset-y="roiBounds.y"
            :selected-dislocation-id="imageStore.selectedDislocationId"
            @update:scale="scale = $event"
            @update:offset-x="offsetX = $event"
            @update:offset-y="offsetY = $event"
            @roi:update="handleROIUpdate"
            @roi:complete="handleROIComplete"
            @roi:clear="handleROIClear"
          />
        </div>
      </main>

      <aside class="right-sidebar">
        <FFTPanel
          :fft-result="imageStore.fftResult"
          :is-loading="imageStore.isLoading"
        />
      </aside>
    </div>

    <footer class="status-bar">
      <div class="status-item">
        <span class="status-dot" :class="{ error: !imageStore.addonStatus.loaded }"></span>
        <span>{{ imageStore.addonStatus.loaded ? 'C++ Addon 运行正常' : 'C++ Addon 未加载' }}</span>
      </div>
      <div class="status-item">
        <span class="status-dot"></span>
        <span>OpenCV {{ opencvVersion }}</span>
      </div>
      <div class="status-item">
        <el-icon><Folder /></el-icon>
        <span>{{ imageStore.currentFile ? imageStore.currentFile.split('\\').pop() : '未打开文件' }}</span>
      </div>
      <div class="status-item" style="margin-left: auto;">
        <el-icon><Clock /></el-icon>
        <span>{{ currentTime }}</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useImageStore } from './stores/imageStore'
import ImageCanvas from './components/ImageCanvas.vue'
import FFTPanel from './components/FFTPanel.vue'

const imageStore = useImageStore()

const imageCanvasRef = ref(null)
const toolMode = ref('pan')
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const opencvVersion = ref('4.9.0')
const currentTime = ref('')

const roiBounds = computed(() => {
  return imageStore.getROIBounds() || { x: 0, y: 0, width: 0, height: 0 }
})

let timeInterval = null

function updateTime() {
  const now = new Date()
  currentTime.value = now.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

async function openFileDialog() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.tif,.tiff'
  input.onchange = async (e) => {
    const file = e.target.files[0]
    if (file) {
      await loadFile(file.path)
    }
  }
  input.click()
}

async function loadFile(filePath) {
  const result = await imageStore.loadTiff(filePath)
  if (result.success) {
    ElMessage.success(`图像加载成功: ${result.info.width} × ${result.info.height}`)
    setTimeout(() => fitView(), 100)
  } else {
    ElMessage.error(`加载失败: ${result.error}`)
  }
}

async function runFFT(useSharedMemory) {
  const startTime = performance.now()
  const result = await imageStore.computeFFT(useSharedMemory)
  const duration = (performance.now() - startTime).toFixed(2)
  
  if (result.success) {
    ElMessage.success(`FFT 分析完成 (${duration} ms) - 检测到 ${result.result.diffractionSpots.length} 个衍射斑点`)
  } else {
    ElMessage.error(`FFT 分析失败: ${result.error}`)
  }
}

function exportFFT() {
  if (!imageStore.fftResult) return
  
  const canvas = document.createElement('canvas')
  canvas.width = imageStore.fftResult.width
  canvas.height = imageStore.fftResult.height
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(canvas.width, canvas.height)
  
  const src = new Uint8Array(imageStore.fftResult.spectrumData)
  for (let i = 0; i < src.length; i++) {
    imageData.data[i] = src[i]
  }
  ctx.putImageData(imageData, 0, 0)
  
  const link = document.createElement('a')
  link.download = 'fft_spectrum.png'
  link.href = canvas.toDataURL('image/png')
  link.click()
  
  ElMessage.success('频谱图已导出')
}

async function runDislocationAnalysis() {
  const startTime = performance.now()
  const result = await imageStore.analyzeDislocations()
  const duration = (performance.now() - startTime).toFixed(2)
  
  if (result.success) {
    ElMessage.success(`位错分析完成 (${duration} ms) - 检测到 ${result.result.numDislocations} 条位错线`)
  } else {
    ElMessage.error(`位错分析失败: ${result.error}`)
  }
}

function clearROI() {
  if (imageCanvasRef.value) {
    imageCanvasRef.value.clearROI()
  }
  imageStore.clearROI()
  ElMessage.info('ROI 已清除')
}

function selectDislocation(id) {
  imageStore.selectDislocation(id)
}

function handleROIUpdate(e) {
  imageStore.setROIPolygon(e.polygon)
  imageStore.setDrawingROI(e.isDrawing)
}

function handleROIComplete(e) {
  imageStore.setROIPolygon(e.polygon)
  imageStore.setDrawingROI(false)
  ElMessage.success(`ROI 绘制完成，${e.polygon.length} 个顶点`)
}

function handleROIClear() {
  imageStore.clearROI()
}

function zoomIn() {
  scale.value = Math.min(scale.value * 1.2, 10)
}

function zoomOut() {
  scale.value = Math.max(scale.value / 1.2, 0.1)
}

function resetView() {
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}

function fitView() {
  if (imageCanvasRef.value && imageStore.imageInfo) {
    imageCanvasRef.value.fitToView()
  }
}

function handleKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  
  switch (e.key.toLowerCase()) {
    case ' ':
      toolMode.value = 'pan'
      break
    case 'z':
      toolMode.value = 'zoom'
      break
    case 'm':
      toolMode.value = 'measure'
      break
    case 'r':
      toolMode.value = 'roi'
      break
    case '+':
    case '=':
      zoomIn()
      break
    case '-':
      zoomOut()
      break
    case '0':
      resetView()
      break
    case 'f':
      fitView()
      break
    case 'o':
      if (e.ctrlKey) {
        e.preventDefault()
        openFileDialog()
      }
      break
  }
}

function handleFileSelected(filePath) {
  loadFile(filePath)
}

function handleComputeFFT() {
  runFFT(false)
}

function handleComputeFFTShared() {
  runFFT(true)
}

function handleExportFFT() {
  exportFFT()
}

onMounted(async () => {
  await imageStore.loadAddonStatus()
  await imageStore.loadSystemInfo()
  
  window.addEventListener('keydown', handleKeydown)
  
  if (window.electronAPI) {
    window.electronAPI.onFileSelected(handleFileSelected)
    window.electronAPI.onComputeFFT(handleComputeFFT)
    window.electronAPI.onComputeFFTShared(handleComputeFFTShared)
    window.electronAPI.onExportFFT(handleExportFFT)
  }
  
  updateTime()
  timeInterval = setInterval(updateTime, 1000)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  
  if (window.electronAPI) {
    window.electronAPI.removeAllListeners('file-selected')
    window.electronAPI.removeAllListeners('compute-fft')
    window.electronAPI.removeAllListeners('compute-fft-shared')
    window.electronAPI.removeAllListeners('export-fft')
  }
  
  if (timeInterval) {
    clearInterval(timeInterval)
  }
})
</script>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--primary-dark);
}

.app-header {
  height: 64px;
  background: var(--secondary-dark);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.logo-icon {
  font-size: 32px;
  color: var(--accent-cyan);
}

.title-group h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: 0.5px;
}

.app-subtitle {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 2px 0 0 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-sidebar {
  width: 300px;
  background: var(--primary-dark);
  border-right: 1px solid var(--border-color);
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}

.main-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.view-toolbar {
  height: 56px;
  background: var(--secondary-dark);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.divider {
  width: 1px;
  height: 24px;
  background: var(--border-color);
  margin: 0 8px;
}

.canvas-area {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.right-sidebar {
  width: 340px;
  background: var(--primary-dark);
  border-left: 1px solid var(--border-color);
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--text-secondary);
  gap: 12px;
}

.empty-state p {
  margin: 0;
  font-size: 13px;
}

.dislocation-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
}

.dislocation-item:hover {
  background: var(--accent-blue);
  border-color: var(--accent-cyan);
}

.dislocation-item.active {
  background: var(--accent-blue);
  border-color: var(--accent-cyan);
}

.dislocation-type {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 3px;
  background: var(--warning);
  color: white;
}

.dislocation-type.edge {
  background: #e94560;
}

.dislocation-type.screw {
  background: var(--accent-blue);
}

.dislocation-burgers {
  font-family: 'Consolas', monospace;
  font-size: 12px;
  color: var(--accent-cyan);
  font-weight: 600;
}
</style>
