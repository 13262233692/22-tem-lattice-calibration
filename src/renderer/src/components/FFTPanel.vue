<template>
  <div class="fft-panel">
    <el-card shadow="never" class="spectrum-card">
      <template #header>
        <div class="panel-title">
          <el-icon class="icon"><Cpu /></el-icon>
          <span>FFT 衍射频谱图</span>
        </div>
      </template>
      
      <div v-if="isLoading" class="fft-loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">正在执行 FFT 变换...</div>
        <div class="fft-hint">
          <p>对 8K 图像执行 2D-FFT 变换需要</p>
          <p>进行大量复数运算，请耐心等待</p>
        </div>
      </div>
      
      <div v-else-if="!fftResult" class="fft-empty">
        <el-icon size="48" style="color: var(--accent-blue);"><TrendCharts /></el-icon>
        <p class="empty-title">等待 FFT 分析</p>
        <p class="empty-desc">加载图像后点击「执行 2D-FFT」</p>
        <p class="empty-tip">支持共享内存零拷贝加速</p>
      </div>
      
      <div v-else class="fft-content">
        <div class="fft-canvas-wrapper" ref="wrapperRef">
          <canvas ref="canvasRef"></canvas>
          <div 
            v-for="(spot, idx) in displaySpots" 
            :key="idx"
            class="diffraction-spot"
            :style="{
              left: (spot.x / fftResult.width * 100) + '%',
              top: (spot.y / fftResult.height * 100) + '%'
            }"
          ></div>
        </div>
        
        <div class="spot-count">
          检测到 <span class="highlight">{{ fftResult.diffractionSpots.length }}</span> 个衍射斑点
        </div>
      </div>
    </el-card>
    
    <el-card shadow="never" class="analysis-card">
      <template #header>
        <div class="panel-title">
          <el-icon class="icon"><DataAnalysis /></el-icon>
          <span>晶格参数分析</span>
        </div>
      </template>
      
      <div v-if="fftResult" class="analysis-content">
        <div class="stat-row">
          <div class="stat-item">
            <div class="stat-value">{{ fftResult.width }} × {{ fftResult.height }}</div>
            <div class="stat-label">频谱分辨率</div>
          </div>
        </div>
        
        <div class="divider"></div>
        
        <div class="info-row">
          <span class="info-label">主频</span>
          <span class="info-value">{{ fftResult.dominantFrequency.toFixed(6) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">晶格间距</span>
          <span class="info-value highlight">{{ fftResult.latticeSpacing.toFixed(4) }} nm</span>
        </div>
        <div class="info-row">
          <span class="info-label">衍射斑点</span>
          <span class="info-value">{{ fftResult.diffractionSpots.length }}</span>
        </div>
        
        <div class="divider"></div>
        
        <div class="calibration-section">
          <div class="section-label">校准参数</div>
          <el-slider 
            v-model="calibration" 
            :min="0.1" 
            :max="5" 
            :step="0.1"
            @input="updateLatticeSpacing"
          />
          <div class="calibration-value">
            校准系数: <span>{{ calibration.toFixed(1) }}</span>
          </div>
        </div>
        
        <div class="divider"></div>
        
        <div class="spot-list-section">
          <div class="section-label">前 10 个衍射斑点</div>
          <div class="spot-list" ref="spotListRef">
            <div 
              v-for="(spot, idx) in topSpots" 
              :key="idx"
              class="spot-item"
              @mouseenter="hoverSpot = idx"
              @mouseleave="hoverSpot = -1"
            >
              <span class="spot-index">{{ idx + 1 }}</span>
              <span class="spot-coord">({{ spot.x }}, {{ spot.y }})</span>
              <span class="spot-dist">
                {{ Math.sqrt(spot.x * spot.x + spot.y * spot.y).toFixed(1) }}
              </span>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="empty-analysis">
        <el-icon size="32" style="color: var(--text-secondary);"><Grid /></el-icon>
        <p>执行 FFT 后显示分析结果</p>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, onMounted } from 'vue'

const props = defineProps({
  fftResult: {
    type: Object,
    default: null
  },
  isLoading: {
    type: Boolean,
    default: false
  }
})

const canvasRef = ref(null)
const wrapperRef = ref(null)
const spotListRef = ref(null)
const calibration = ref(1.0)
const hoverSpot = ref(-1)

const displaySpots = computed(() => {
  if (!props.fftResult) return []
  return props.fftResult.diffractionSpots.slice(0, 30)
})

const topSpots = computed(() => {
  if (!props.fftResult) return []
  return props.fftResult.diffractionSpots.slice(0, 10)
})

function renderSpectrum() {
  if (!canvasRef.value || !props.fftResult) return
  
  const canvas = canvasRef.value
  const ctx = canvas.getContext('2d')
  const { width, height, spectrumData } = props.fftResult
  
  canvas.width = width
  canvas.height = height
  
  const imageData = ctx.createImageData(width, height)
  const srcData = new Uint8Array(spectrumData)
  
  for (let i = 0; i < srcData.length; i++) {
    imageData.data[i] = srcData[i]
  }
  
  ctx.putImageData(imageData, 0, 0)
  
  if (hoverSpot.value >= 0 && hoverSpot.value < displaySpots.value.length) {
    const spot = displaySpots.value[hoverSpot.value]
    ctx.strokeStyle = '#e94560'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(spot.x, spot.y, 15, 0, Math.PI * 2)
    ctx.stroke()
    
    const dx = spot.x - width / 2
    const dy = spot.y - height / 2
    const dist = Math.sqrt(dx * dx + dy * dy)
    
    ctx.fillStyle = 'rgba(233, 69, 96, 0.9)'
    ctx.fillRect(spot.x + 10, spot.y - 25, 80, 20)
    ctx.fillStyle = '#fff'
    ctx.font = '11px Consolas'
    ctx.fillText(dist.toFixed(1) + ' px', spot.x + 15, spot.y - 10)
  }
}

function updateLatticeSpacing() {
  if (props.fftResult) {
    const frequency = props.fftResult.dominantFrequency
    props.fftResult.latticeSpacing = frequency > 0 ? calibration.value / frequency : 0
  }
}

watch(() => props.fftResult, (newVal) => {
  if (newVal) {
    nextTick(() => {
      renderSpectrum()
    })
  }
}, { deep: true })

watch(hoverSpot, () => {
  if (props.fftResult) {
    renderSpectrum()
  }
})

onMounted(() => {
  if (props.fftResult) {
    nextTick(() => renderSpectrum())
  }
})
</script>

<style scoped>
.fft-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.spectrum-card {
  flex-shrink: 0;
}

.analysis-card {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.analysis-card :deep(.el-card__body) {
  flex: 1;
  overflow-y: auto;
}

.fft-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  gap: 16px;
}

.fft-hint {
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  margin-top: 8px;
}

.fft-hint p {
  margin: 4px 0;
}

.fft-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--text-secondary);
  gap: 8px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 16px 0 4px 0;
}

.empty-desc {
  font-size: 13px;
  margin: 0;
}

.empty-tip {
  font-size: 11px;
  color: var(--accent-cyan);
  margin: 0;
  opacity: 0.8;
}

.fft-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.spot-count {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.spot-count .highlight {
  color: var(--accent-cyan);
  font-weight: 700;
  font-size: 16px;
  margin: 0 4px;
}

.analysis-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-row {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
}

.stat-item {
  text-align: center;
}

.divider {
  height: 1px;
  background: var(--border-color);
  margin: 12px 0;
}

.highlight {
  color: var(--accent-green) !important;
  font-size: 14px !important;
}

.calibration-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.calibration-value {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: 'Consolas', monospace;
}

.calibration-value span {
  color: var(--accent-cyan);
  font-weight: 600;
}

.empty-analysis {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: var(--text-secondary);
  gap: 12px;
}

.empty-analysis p {
  margin: 0;
  font-size: 13px;
}

.spot-list-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.spot-list {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.spot-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
  font-family: 'Consolas', monospace;
}

.spot-item:last-child {
  border-bottom: none;
}

.spot-item:hover {
  background: var(--accent-blue);
}

.spot-index {
  width: 24px;
  color: var(--accent-cyan);
  font-weight: 600;
}

.spot-coord {
  flex: 1;
  color: var(--text-primary);
}

.spot-dist {
  color: var(--text-secondary);
}
</style>
