<template>
  <div class="canvas-container" ref="containerRef">
    <canvas 
      ref="canvasRef" 
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
      @wheel="handleWheel"
    ></canvas>
    
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <div class="loading-text">{{ loadingText }}</div>
    </div>
    
    <div v-if="!imageData && !isLoading" class="empty-overlay">
      <el-icon size="64" style="color: var(--accent-blue);"><DataLine /></el-icon>
      <p class="empty-title">等待加载 TEM 图像</p>
      <p class="empty-desc">点击右上角「打开 TIFF」按钮或使用 Ctrl+O 快捷键</p>
      <p class="empty-hint">支持 8K+ 分辨率 16-bit 单通道无损 TIFF 格式</p>
    </div>
    
    <div v-if="showMeasurements" class="measurements-overlay">
      <div 
        v-for="(m, idx) in measurements" 
        :key="idx"
        class="measurement-label"
        :style="{ left: m.endX + 'px', top: m.endY + 'px' }"
      >
        {{ m.distance.toFixed(2) }} px
      </div>
    </div>
    
    <div class="coordinates-display" v-if="mouseCoords">
      X: {{ mouseCoords.x.toFixed(0) }}  Y: {{ mouseCoords.y.toFixed(0) }}
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick, defineExpose } from 'vue'

const props = defineProps({
  imageData: {
    type: String,
    default: null
  },
  imageTiles: {
    type: Array,
    default: () => []
  },
  imageInfo: {
    type: Object,
    default: null
  },
  toolMode: {
    type: String,
    default: 'pan'
  },
  scale: {
    type: Number,
    default: 1
  },
  offsetX: {
    type: Number,
    default: 0
  },
  offsetY: {
    type: Number,
    default: 0
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  loadingText: {
    type: String,
    default: '加载中...'
  }
})

const emit = defineEmits(['update:scale', 'update:offset-x', 'update:offset-y'])

const containerRef = ref(null)
const canvasRef = ref(null)
const ctx = ref(null)
const image = ref(null)
const tileImages = ref([])
const isDragging = ref(false)
const lastMouseX = ref(0)
const lastMouseY = ref(0)
const mouseCoords = ref(null)
const measurements = ref([])
const showMeasurements = ref(false)
const currentMeasurement = ref(null)

const TILE_SIZE = 1024

async function loadImage() {
  if (!props.imageData) return
  
  image.value = new Image()
  image.value.onload = () => {
    nextTick(() => {
      resizeCanvas()
      render()
    })
  }
  image.value.src = props.imageData
  
  if (props.imageTiles.length > 0) {
    tileImages.value = await Promise.all(
      props.imageTiles.map(tile => {
        return new Promise((resolve) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => resolve(null)
          img.src = tile
        })
      })
    )
  }
}

function resizeCanvas() {
  if (!containerRef.value || !canvasRef.value) return
  
  const container = containerRef.value
  const canvas = canvasRef.value
  
  canvas.width = container.clientWidth
  canvas.height = container.clientHeight
  ctx.value = canvas.getContext('2d')
  
  render()
}

function render() {
  if (!ctx.value) return
  
  const canvas = canvasRef.value
  const context = ctx.value
  
  context.fillStyle = '#0a0a15'
  context.fillRect(0, 0, canvas.width, canvas.height)
  
  context.save()
  context.translate(canvas.width / 2 + props.offsetX, canvas.height / 2 + props.offsetY)
  context.scale(props.scale, props.scale)
  
  if (tileImages.value.length > 0 && props.imageInfo) {
    renderTiles(context)
  } else if (image.value) {
    const imgWidth = image.value.width
    const imgHeight = image.value.height
    context.drawImage(image.value, -imgWidth / 2, -imgHeight / 2)
  }
  
  context.restore()
  
  if (currentMeasurement.value) {
    renderMeasurement(context, currentMeasurement.value)
  }
  
  measurements.value.forEach(m => renderMeasurement(context, m))
}

function renderTiles(context) {
  if (!props.imageInfo) return
  
  const { width, height } = props.imageInfo
  const cols = Math.ceil(width / TILE_SIZE)
  const rows = Math.ceil(height / TILE_SIZE)
  
  let tileIndex = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = tileImages.value[tileIndex]
      if (tile) {
        const x = col * TILE_SIZE - width / 2
        const y = row * TILE_SIZE - height / 2
        const drawWidth = Math.min(TILE_SIZE, width - col * TILE_SIZE)
        const drawHeight = Math.min(TILE_SIZE, height - row * TILE_SIZE)
        context.drawImage(tile, 0, 0, drawWidth, drawHeight, x, y, drawWidth, drawHeight)
      }
      tileIndex++
    }
  }
}

function renderMeasurement(context, m) {
  if (!context) return
  
  context.save()
  context.strokeStyle = '#e94560'
  context.lineWidth = 2 / props.scale
  context.setLineDash([5 / props.scale, 5 / props.scale])
  
  context.beginPath()
  context.moveTo(m.startX - props.imageInfo.width / 2, m.startY - props.imageInfo.height / 2)
  context.lineTo(m.endX - props.imageInfo.width / 2, m.endY - props.imageInfo.height / 2)
  context.stroke()
  
  context.fillStyle = '#e94560'
  context.beginPath()
  context.arc(m.startX - props.imageInfo.width / 2, m.startY - props.imageInfo.height / 2, 4 / props.scale, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.arc(m.endX - props.imageInfo.width / 2, m.endY - props.imageInfo.height / 2, 4 / props.scale, 0, Math.PI * 2)
  context.fill()
  
  context.restore()
}

function screenToImage(screenX, screenY) {
  if (!canvasRef.value || !props.imageInfo) return null
  
  const canvas = canvasRef.value
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  
  const imageX = (screenX - centerX - props.offsetX) / props.scale + props.imageInfo.width / 2
  const imageY = (screenY - centerY - props.offsetY) / props.scale + props.imageInfo.height / 2
  
  return { x: imageX, y: imageY }
}

function handleMouseDown(e) {
  if (props.isLoading || !props.imageInfo) return
  
  const rect = canvasRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  
  if (props.toolMode === 'pan') {
    isDragging.value = true
    lastMouseX.value = x
    lastMouseY.value = y
  } else if (props.toolMode === 'zoom') {
    const delta = e.button === 2 ? -1 : 1
    adjustZoom(x, y, delta)
  } else if (props.toolMode === 'measure') {
    const coords = screenToImage(x, y)
    if (coords) {
      currentMeasurement.value = {
        startX: coords.x,
        startY: coords.y,
        endX: coords.x,
        endY: coords.y,
        distance: 0
      }
      isDragging.value = true
    }
  }
}

function handleMouseMove(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  
  const coords = screenToImage(x, y)
  if (coords && props.imageInfo) {
    if (coords.x >= 0 && coords.x < props.imageInfo.width && 
        coords.y >= 0 && coords.y < props.imageInfo.height) {
      mouseCoords.value = coords
    } else {
      mouseCoords.value = null
    }
  }
  
  if (!isDragging.value) return
  
  if (props.toolMode === 'pan') {
    const dx = x - lastMouseX.value
    const dy = y - lastMouseY.value
    emit('update:offset-x', props.offsetX + dx)
    emit('update:offset-y', props.offsetY + dy)
    lastMouseX.value = x
    lastMouseY.value = y
  } else if (props.toolMode === 'measure' && currentMeasurement.value) {
    const coords = screenToImage(x, y)
    if (coords) {
      currentMeasurement.value.endX = coords.x
      currentMeasurement.value.endY = coords.y
      const dx = coords.x - currentMeasurement.value.startX
      const dy = coords.y - currentMeasurement.value.startY
      currentMeasurement.value.distance = Math.sqrt(dx * dx + dy * dy)
    }
  }
  
  render()
}

function handleMouseUp(e) {
  if (props.toolMode === 'measure' && currentMeasurement.value) {
    if (currentMeasurement.value.distance > 2) {
      measurements.value.push({ ...currentMeasurement.value })
      showMeasurements.value = true
    }
    currentMeasurement.value = null
  }
  
  isDragging.value = false
  render()
}

function handleWheel(e) {
  if (props.isLoading || !props.imageInfo) return
  
  e.preventDefault()
  
  const rect = canvasRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top
  
  const delta = e.deltaY > 0 ? -1 : 1
  adjustZoom(x, y, delta)
}

function adjustZoom(centerX, centerY, delta) {
  const zoomFactor = delta > 0 ? 1.2 : 1 / 1.2
  const newScale = Math.max(0.1, Math.min(10, props.scale * zoomFactor))
  
  if (!canvasRef.value) return
  
  const canvas = canvasRef.value
  const imageCenterX = canvas.width / 2
  const imageCenterY = canvas.height / 2
  
  const mouseImageX = (centerX - imageCenterX - props.offsetX) / props.scale
  const mouseImageY = (centerY - imageCenterY - props.offsetY) / props.scale
  
  const newOffsetX = centerX - imageCenterX - mouseImageX * newScale
  const newOffsetY = centerY - imageCenterY - mouseImageY * newScale
  
  emit('update:scale', newScale)
  emit('update:offset-x', newOffsetX)
  emit('update:offset-y', newOffsetY)
  
  nextTick(render)
}

function fitToView() {
  if (!props.imageInfo || !containerRef.value) return
  
  const container = containerRef.value
  const { width, height } = props.imageInfo
  
  const scaleX = (container.clientWidth - 40) / width
  const scaleY = (container.clientHeight - 40) / height
  const newScale = Math.min(scaleX, scaleY, 2)
  
  emit('update:scale', newScale)
  emit('update:offset-x', 0)
  emit('update:offset-y', 0)
  
  nextTick(render)
}

function clearMeasurements() {
  measurements.value = []
  showMeasurements.value = false
  render()
}

watch(() => props.imageData, () => {
  if (props.imageData) {
    loadImage()
  } else {
    image.value = null
    tileImages.value = []
    render()
  }
})

watch([() => props.scale, () => props.offsetX, () => props.offsetY], () => {
  render()
})

let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    resizeCanvas()
    if (props.imageData) {
      loadImage()
    }
  })
  
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  if (image.value) {
    image.value.src = ''
  }
})

defineExpose({
  fitToView,
  clearMeasurements
})
</script>

<style scoped>
.empty-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  pointer-events: none;
}

.empty-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 24px 0 8px 0;
}

.empty-desc {
  font-size: 14px;
  margin: 0 0 8px 0;
}

.empty-hint {
  font-size: 12px;
  color: var(--accent-cyan);
  margin: 0;
  opacity: 0.8;
}

.coordinates-display {
  position: absolute;
  bottom: 12px;
  left: 12px;
  background: rgba(0, 0, 0, 0.7);
  padding: 6px 12px;
  border-radius: 4px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  color: var(--accent-cyan);
  pointer-events: none;
}

.measurements-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.measurement-label {
  position: absolute;
  background: var(--accent-red);
  color: white;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: 'Consolas', monospace;
  transform: translate(8px, -8px);
  white-space: nowrap;
}
</style>
