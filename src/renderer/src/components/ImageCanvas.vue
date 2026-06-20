<template>
  <div class="canvas-container" ref="containerRef">
    <canvas 
      ref="canvasRef" 
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
      @wheel="handleWheel"
      @contextmenu.prevent
      @dblclick="handleDoubleClick"
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
  },
  dislocationLines: {
    type: Array,
    default: () => []
  },
  roiOffsetX: {
    type: Number,
    default: 0
  },
  roiOffsetY: {
    type: Number,
    default: 0
  },
  selectedDislocationId: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['update:scale', 'update:offset-x', 'update:offset-y', 'roi:update', 'roi:complete', 'roi:clear', 'dislocation:select'])

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

const roiPolygon = ref([])
const isDrawingRoi = ref(false)
const roiHoverIndex = ref(-1)

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
  
  if (props.toolMode === 'roi' || roiPolygon.value.length > 0) {
    renderROIPolygon(context)
  }
  
  if (props.dislocationLines && props.dislocationLines.length > 0) {
    renderDislocations(context)
  }
  
  if (currentMeasurement.value) {
    renderMeasurement(context, currentMeasurement.value)
  }
  measurements.value.forEach(m => renderMeasurement(context, m))
  
  context.restore()
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

function renderROIPolygon(context) {
  if (!context || !props.imageInfo || roiPolygon.value.length === 0) return
  
  const { width, height } = props.imageInfo
  const points = roiPolygon.value
  
  context.save()
  
  context.fillStyle = 'rgba(255, 215, 0, 0.12)'
  context.strokeStyle = '#ffd700'
  context.lineWidth = 2 / props.scale
  context.setLineDash([8 / props.scale, 4 / props.scale])
  
  context.beginPath()
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x - width / 2
    const py = points[i].y - height / 2
    if (i === 0) {
      context.moveTo(px, py)
    } else {
      context.lineTo(px, py)
    }
  }
  
  if (isDrawingRoi.value && points.length >= 3) {
    context.closePath()
    context.fill()
  }
  context.stroke()
  
  context.setLineDash([])
  
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x - width / 2
    const py = points[i].y - height / 2
    
    context.fillStyle = roiHoverIndex.value === i ? '#ff6b6b' : '#ffd700'
    context.beginPath()
    context.arc(px, py, 5 / props.scale, 0, Math.PI * 2)
    context.fill()
    
    context.strokeStyle = '#ffffff'
    context.lineWidth = 1.5 / props.scale
    context.stroke()
  }
  
  if (isDrawingRoi.value && mouseCoords.value && points.length > 0) {
    const lastPt = points[points.length - 1]
    const mouseX = mouseCoords.value.x - width / 2
    const mouseY = mouseCoords.value.y - height / 2
    
    context.strokeStyle = 'rgba(255, 215, 0, 0.5)'
    context.lineWidth = 1.5 / props.scale
    context.setLineDash([4 / props.scale, 4 / props.scale])
    
    context.beginPath()
    context.moveTo(lastPt.x - width / 2, lastPt.y - height / 2)
    context.lineTo(mouseX, mouseY)
    context.stroke()
    
    if (points.length >= 2) {
      const firstPt = points[0]
      context.beginPath()
      context.moveTo(mouseX, mouseY)
      context.lineTo(firstPt.x - width / 2, firstPt.y - height / 2)
      context.stroke()
    }
  }
  
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
  } else if (props.toolMode === 'roi') {
    if (e.button === 2) {
      finishROI()
      return
    }
    const coords = screenToImage(x, y)
    if (coords) {
      if (!isDrawingRoi.value) {
        roiPolygon.value = []
        isDrawingRoi.value = true
      }
      roiPolygon.value.push({ x: coords.x, y: coords.y })
      emit('roi:update', { polygon: roiPolygon.value, isDrawing: isDrawingRoi.value })
      render()
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

function handleDoubleClick(e) {
  if (props.toolMode === 'roi' && isDrawingRoi.value && roiPolygon.value.length >= 3) {
    roiPolygon.value.pop()
    finishROI()
  }
}

function finishROI() {
  if (roiPolygon.value.length >= 3) {
    isDrawingRoi.value = false
    emit('roi:complete', { polygon: roiPolygon.value })
    render()
  }
}

function clearROI() {
  roiPolygon.value = []
  isDrawingRoi.value = false
  roiHoverIndex.value = -1
  emit('roi:clear')
  render()
}

function getROIBounds() {
  if (roiPolygon.value.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const pt of roiPolygon.value) {
    minX = Math.min(minX, pt.x)
    minY = Math.min(minY, pt.y)
    maxX = Math.max(maxX, pt.x)
    maxY = Math.max(maxY, pt.y)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function gaussianSmoothPath(context, points, offsetX, offsetY, width, height, sigma = 4) {
  if (points.length < 2) return
  
  const offX = offsetX - width / 2
  const offY = offsetY - height / 2
  
  for (let s = sigma; s >= 0; s -= 0.5) {
    const alpha = Math.exp(-s * s / (2 * sigma * sigma))
    context.strokeStyle = `rgba(255, 215, 0, ${alpha * 0.8})`
    context.lineWidth = (s * 2 + 1) / props.scale
    
    context.beginPath()
    for (let i = 0; i < points.length; i++) {
      const px = points[i].x + offX
      const py = points[i].y + offY
      if (i === 0) {
        context.moveTo(px, py)
      } else {
        context.lineTo(px, py)
      }
    }
    context.stroke()
  }
  
  context.strokeStyle = '#fff700'
  context.lineWidth = 2 / props.scale
  context.beginPath()
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x + offX
    const py = points[i].y + offY
    if (i === 0) {
      context.moveTo(px, py)
    } else {
      context.lineTo(px, py)
    }
  }
  context.stroke()
}

function drawArrow(context, x, y, angle, length, color = '#ffd700') {
  const headLen = 8 / props.scale
  const headAngle = Math.PI / 6
  
  const endX = x + Math.cos(angle) * length
  const endY = y + Math.sin(angle) * length
  
  context.strokeStyle = color
  context.lineWidth = 2.5 / props.scale
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(endX, endY)
  context.stroke()
  
  context.fillStyle = color
  context.beginPath()
  context.moveTo(endX, endY)
  context.lineTo(
    endX - headLen * Math.cos(angle - headAngle),
    endY - headLen * Math.sin(angle - headAngle)
  )
  context.lineTo(
    endX - headLen * Math.cos(angle + headAngle),
    endY - headLen * Math.sin(angle + headAngle)
  )
  context.closePath()
  context.fill()
}

function renderDislocations(context) {
  if (!context || !props.imageInfo || props.dislocationLines.length === 0) return
  
  const { width, height } = props.imageInfo
  const offX = props.roiOffsetX
  const offY = props.roiOffsetY
  
  for (const line of props.dislocationLines) {
    const isSelected = line.id === props.selectedDislocationId
    const sigma = isSelected ? 6 : 4
    
    gaussianSmoothPath(context, line.points, offX, offY, width, height, sigma)
    
    const startPt = {
      x: line.startPoint.x + offX - width / 2,
      y: line.startPoint.y + offY - height / 2
    }
    const endPt = {
      x: line.endPoint.x + offX - width / 2,
      y: line.endPoint.y + offY - height / 2
    }
    
    const startAngle = line.startAngle + Math.PI / 2
    const endAngle = line.endAngle + Math.PI / 2
    
    const arrowLen = 20 / props.scale
    
    drawArrow(context, startPt.x, startPt.y, startAngle, arrowLen, '#ff6b6b')
    drawArrow(context, endPt.x, endPt.y, endAngle, arrowLen, '#ff6b6b')
    
    context.fillStyle = 'rgba(0, 0, 0, 0.85)'
    context.strokeStyle = '#ffd700'
    context.lineWidth = 1.5 / props.scale
    
    const labelText = `${line.burgersMagnitude_angstrom.toFixed(2)} Å`
    context.font = `${12 / props.scale}px Consolas, monospace`
    
    const textWidth = context.measureText(labelText).width
    const boxPadding = 6 / props.scale
    const boxWidth = textWidth + boxPadding * 2
    const boxHeight = 20 / props.scale
    
    let labelBoxX = endPt.x + 15 / props.scale
    let labelBoxY = endPt.y - boxHeight / 2
    
    context.fillRect(labelBoxX, labelBoxY, boxWidth, boxHeight)
    context.strokeRect(labelBoxX, labelBoxY, boxWidth, boxHeight)
    
    context.fillStyle = '#ffd700'
    context.fillText(labelText, labelBoxX + boxPadding, labelBoxY + 14 / props.scale)
  }
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
  clearMeasurements,
  clearROI,
  finishROI,
  getROIBounds,
  get roiPolygon() { return roiPolygon.value },
  get isDrawingRoi() { return isDrawingRoi.value }
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
