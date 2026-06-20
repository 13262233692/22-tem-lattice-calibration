<template>
  <div class="fft-panel">
    <el-card shadow="never" class="spectrum-card">
      <template #header>
        <div class="panel-header">
          <div class="panel-title">
            <el-icon class="icon"><Cpu /></el-icon>
            <span>FFT 衍射频谱图</span>
            <el-tag v-if="webglEnabled" type="success" size="small" style="margin-left: 8px;">
              WebGL 加速
            </el-tag>
            <el-tag v-else type="warning" size="small" style="margin-left: 8px;">
              Canvas 2D
            </el-tag>
          </div>
          <div class="header-stats">
            <span v-if="fpsVisible" class="fps-counter" :class="fpsClass">{{ fpsDisplay }} FPS</span>
            <span v-if="imageStore.fftComputeTimeMs > 0" class="compute-time">
              计算耗时: {{ imageStore.fftComputeTimeMs }}ms
            </span>
          </div>
        </div>
      </template>
      
      <div v-if="isLoading" class="fft-loading">
        <div class="loading-spinner"></div>
        <div class="loading-text">{{ imageStore.loadingText }}</div>
        <el-progress 
          v-if="imageStore.loadingProgress > 0" 
          :percentage="imageStore.loadingProgress" 
          :stroke-width="6"
          :show-text="false"
          style="width: 240px; margin-top: 16px;"
        />
        <div class="fft-hint">
          <p>C++ Worker 线程池异步执行，不阻塞 UI</p>
          <p>频谱数据通过共享内存零拷贝传输</p>
        </div>
      </div>
      
      <div v-else-if="!fftResult" class="fft-empty">
        <el-icon size="48" style="color: var(--accent-blue);"><TrendCharts /></el-icon>
        <p class="empty-title">等待 FFT 分析</p>
        <p class="empty-desc">加载图像后点击「执行 2D-FFT」</p>
        <p class="empty-tip">支持 16K 超大型图像，异步线程池加速</p>
      </div>
      
      <div v-else class="fft-content">
        <div 
          class="fft-canvas-wrapper" 
          ref="wrapperRef"
          @mousedown="handleMouseDown"
          @mousemove="handleMouseMove"
          @mouseup="handleMouseUp"
          @mouseleave="handleMouseUp"
          @wheel="handleWheel"
        >
          <canvas ref="canvasRef"></canvas>
          <div 
            v-for="(spot, idx) in displaySpots" 
            :key="idx"
            class="diffraction-spot"
            :class="{ active: hoverSpot === idx }"
            :style="getSpotStyle(spot)"
            @mouseenter="hoverSpot = idx"
            @mouseleave="hoverSpot = -1"
          ></div>
          
          <div v-if="hoverSpot >= 0 && hoverSpot < displaySpots.length" class="spot-tooltip" :style="tooltipStyle">
            <div>斑点 #{{ hoverSpot + 1 }}</div>
            <div>坐标: ({{ displaySpots[hoverSpot].x }}, {{ displaySpots[hoverSpot].y }})</div>
            <div>距中心: {{ getSpotDistance(hoverSpot).toFixed(1) }} px</div>
          </div>
        </div>
        
        <div class="spectrum-toolbar">
          <button class="toolbar-btn" @click="resetView" title="重置视图">
            <el-icon><Refresh /></el-icon>
          </button>
          <button class="toolbar-btn" @click="zoomIn" title="放大">
            <el-icon><ZoomIn /></el-icon>
          </button>
          <button class="toolbar-btn" @click="zoomOut" title="缩小">
            <el-icon><ZoomOut /></el-icon>
          </button>
          <button class="toolbar-btn" @click="fitView" title="适应窗口">
            <el-icon><FullScreen /></el-icon>
          </button>
          <div class="toolbar-divider"></div>
          <span class="zoom-display">{{ (scale * 100).toFixed(0) }}%</span>
        </div>
        
        <div class="spot-count">
          检测到 <span class="highlight">{{ fftResult.diffractionSpots.length }}</span> 个衍射斑点
          <span class="separator">·</span>
          分辨率 <span class="highlight">{{ fftResult.width }} × {{ fftResult.height }}</span>
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
          <div class="spot-list">
            <div 
              v-for="(spot, idx) in topSpots" 
              :key="idx"
              class="spot-item"
              :class="{ active: hoverSpot === idx }"
              @mouseenter="hoverSpot = idx"
              @mouseleave="hoverSpot = -1"
            >
              <span class="spot-index">{{ idx + 1 }}</span>
              <span class="spot-coord">({{ spot.x }}, {{ spot.y }})</span>
              <span class="spot-dist">{{ getSpotDistance(idx).toFixed(1) }}</span>
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

<script setup>import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useImageStore } from '../stores/imageStore';
const imageStore = useImageStore();
const wrapperRef = ref(null);
const canvasRef = ref(null);
const hoverSpot = ref(-1);
const calibration = ref(1.0);
const scale = ref(1);
const offsetX = ref(0);
const offsetY = ref(0);
const isDragging = ref(false);
const lastMouseX = ref(0);
const lastMouseY = ref(0);
const mouseX = ref(0);
const mouseY = ref(0);
const webglEnabled = ref(false);
let gl = null;
let texture = null;
let program = null;
let vao = null;
let animFrameId = null;
const fpsVisible = ref(true);
let fpsCounter = 0;
let fpsLastTime = performance.now();
const fpsDisplay = ref(60);
const fpsClass = computed(() => {
 if (fpsDisplay.value >= 55)
 return 'fps-good';
 if (fpsDisplay.value >= 30)
 return 'fps-ok';
 return 'fps-bad';
});
const fftResult = computed(() => imageStore.fftResult);
const displaySpots = computed(() => {
 if (!fftResult.value)
 return [];
 return fftResult.value.diffractionSpots.slice(0, 30);
});
const topSpots = computed(() => {
 if (!fftResult.value)
 return [];
 return fftResult.value.diffractionSpots.slice(0, 10);
});
const tooltipStyle = computed(() => {
 if (hoverSpot.value < 0 || hoverSpot.value >= displaySpots.value.length) {
 return { display: 'none' };
 }
 const spot = displaySpots.value[hoverSpot.value];
 if (!fftResult.value)
 return { display: 'none' };
 const { width, height } = fftResult.value;
 const wrapper = wrapperRef.value;
 if (!wrapper)
 return { display: 'none' };
 const wrapperRect = wrapper.getBoundingClientRect();
 const px = (spot.x / width) * wrapperRect.width;
 const py = (spot.y / height) * wrapperRect.height;
 const left = Math.min(px + 12, wrapperRect.width - 140);
 const top = Math.min(py + 12, wrapperRect.height - 80);
 return { left: left + 'px', top: top + 'px' };
});
const VERT_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
uniform vec2 u_resolution;
uniform vec2 u_offset;
uniform float u_scale;
out vec2 v_texCoord;
void main() {
 vec2 pos = a_position * u_scale + u_offset;
 vec2 clipSpace = (pos / u_resolution) * 2.0 - 1.0;
 gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
 v_texCoord = a_texCoord;
}
`;
const FRAG_SHADER = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 outColor;
void main() {
 outColor = texture(u_texture, v_texCoord);
}
`;
function createShader(gl, type, source) {
 const shader = gl.createShader(type);
 gl.shaderSource(shader, source);
 gl.compileShader(shader);
 if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
 console.error('Shader compile error:', gl.getShaderInfoLog(shader));
 gl.deleteShader(shader);
 return null;
 }
 return shader;
}
function createProgram(gl, vs, fs) {
 const vertShader = createShader(gl, gl.VERTEX_SHADER, vs);
 const fragShader = createShader(gl, gl.FRAGMENT_SHADER, fs);
 if (!vertShader || !fragShader)
 return null;
 const p = gl.createProgram();
 gl.attachShader(p, vertShader);
 gl.attachShader(p, fragShader);
 gl.linkProgram(p);
 if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
 console.error('Program link error:', gl.getProgramInfoLog(p));
 gl.deleteProgram(p);
 return null;
 }
 return p;
}
function initWebGL() {
 const canvas = canvasRef.value;
 if (!canvas)
 return false;
 gl = canvas.getContext('webgl2', {
 antialias: false,
 preserveDrawingBuffer: false,
 premultipliedAlpha: false
 });
 if (!gl) {
 console.warn('WebGL2 not available, falling back to 2D canvas');
 webglEnabled.value = false;
 return false;
 }
 webglEnabled.value = true;
 program = createProgram(gl, VERT_SHADER, FRAG_SHADER);
 if (!program) {
 webglEnabled.value = false;
 return false;
 }
 const positions = new Float32Array([
 0, 0, 0, 1,
 1, 0, 0, 0,
 0, 1, 1, 1,
 1, 1, 1, 0
 ]);
 const vbo = gl.createBuffer();
 gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
 gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
 vao = gl.createVertexArray();
 gl.bindVertexArray(vao);
 const posLoc = gl.getAttribLocation(program, 'a_position');
 const texLoc = gl.getAttribLocation(program, 'a_texCoord');
 gl.enableVertexAttribArray(posLoc);
 gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
 gl.enableVertexAttribArray(texLoc);
 gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
 texture = gl.createTexture();
 gl.bindTexture(gl.TEXTURE_2D, texture);
 gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
 gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
 return true;
}
function resizeCanvas() {
 const wrapper = wrapperRef.value;
 const canvas = canvasRef.value;
 if (!wrapper || !canvas)
 return;
 const dpr = Math.min(window.devicePixelRatio || 1, 2);
 const rect = wrapper.getBoundingClientRect();
 canvas.width = Math.floor(rect.width * dpr);
 canvas.height = Math.floor(rect.height * dpr);
 canvas.style.width = rect.width + 'px';
 canvas.style.height = rect.height + 'px';
 if (gl) {
 gl.viewport(0, 0, canvas.width, canvas.height);
 }
}
function uploadTextureWebGL() {
 if (!gl || !texture || !imageStore.fftSpectrumBuffer || !fftResult.value)
 return;
 const { width, height } = fftResult.value;
 const pixels = imageStore.fftSpectrumBuffer;
 gl.bindTexture(gl.TEXTURE_2D, texture);
 gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
 gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
 try {
 gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
 }
 catch (e) {
 console.error('Failed to upload WebGL texture:', e);
 }
}
function renderWebGL() {
 if (!gl || !program || !vao || !texture)
 return;
 const canvas = canvasRef.value;
 const wrapper = wrapperRef.value;
 if (!canvas || !wrapper)
 return;
 gl.clearColor(0.04, 0.04, 0.08, 1.0);
 gl.clear(gl.COLOR_BUFFER_BIT);
 gl.useProgram(program);
 gl.bindVertexArray(vao);
 gl.activeTexture(gl.TEXTURE0);
 gl.bindTexture(gl.TEXTURE_2D, texture);
 gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
 gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
 if (!fftResult.value) {
 gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
 return;
 }
 const { width: imgW, height: imgH } = fftResult.value;
 const canvasW = canvas.width;
 const canvasH = canvas.height;
 const imgAspect = imgW / imgH;
 const canvasAspect = canvasW / canvasH;
 let baseW, baseH;
 if (imgAspect > canvasAspect) {
 baseW = canvasW;
 baseH = canvasW / imgAspect;
 }
 else {
 baseH = canvasH;
 baseW = canvasH * imgAspect;
 }
 const drawW = baseW * scale.value;
 const drawH = baseH * scale.value;
 const centerX = canvasW / 2 + offsetX.value * (window.devicePixelRatio || 1);
 const centerY = canvasH / 2 + offsetY.value * (window.devicePixelRatio || 1);
 const x = centerX - drawW / 2;
 const y = centerY - drawH / 2;
 gl.uniform2f(gl.getUniformLocation(program, 'u_offset'), x, y);
 gl.uniform1f(gl.getUniformLocation(program, 'u_scale'), drawW);
 const scaleLoc = gl.getUniformLocation(program, 'u_scale');
 gl.uniform1f(scaleLoc, drawW > 0 ? drawW : 1);
 const positions = new Float32Array([
 x, y,
 x, y + drawH,
 x + drawW, y,
 x + drawW, y + drawH
 ]);
 gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
 gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
 const posLoc = gl.getAttribLocation(program, 'a_position');
 const texLoc = gl.getAttribLocation(program, 'a_texCoord');
 gl.enableVertexAttribArray(posLoc);
 gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
 gl.enableVertexAttribArray(texLoc);
 gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);
 gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function uploadTexture2D() {
 const canvas = canvasRef.value;
 if (!canvas || !imageStore.fftSpectrumBuffer || !fftResult.value)
 return;
 const { width, height } = fftResult.value;
 const ctx = canvas.getContext('2d');
 if (!ctx)
 return;
 const tempCanvas = document.createElement('canvas');
 tempCanvas.width = width;
 tempCanvas.height = height;
 const tempCtx = tempCanvas.getContext('2d');
 const imageData = tempCtx.createImageData(width, height);
 imageData.data.set(imageStore.fftSpectrumBuffer);
 tempCtx.putImageData(imageData, 0, 0);
 canvas._sourceImage = tempCanvas;
}
function render2D() {
 const canvas = canvasRef.value;
 const ctx = canvas.getContext('2d');
 if (!canvas || !ctx || !canvas._sourceImage || !fftResult.value)
 return;
 const { width: imgW, height: imgH } = fftResult.value;
 const canvasW = canvas.width;
 const canvasH = canvas.height;
 ctx.fillStyle = '#0a0a15';
 ctx.fillRect(0, 0, canvasW, canvasH);
 const imgAspect = imgW / imgH;
 const canvasAspect = canvasW / canvasH;
 let baseW, baseH;
 if (imgAspect > canvasAspect) {
 baseW = canvasW;
 baseH = canvasW / imgAspect;
 }
 else {
 baseH = canvasH;
 baseW = canvasH * imgAspect;
 }
 const drawW = baseW * scale.value;
 const drawH = baseH * scale.value;
 const centerX = canvasW / 2 + offsetX.value * (window.devicePixelRatio || 1);
 const centerY = canvasH / 2 + offsetY.value * (window.devicePixelRatio || 1);
 const x = centerX - drawW / 2;
 const y = centerY - drawH / 2;
 ctx.imageSmoothingEnabled = true;
 ctx.imageSmoothingQuality = 'high';
 ctx.drawImage(canvas._sourceImage, x, y, drawW, drawH);
}
function renderLoop() {
 fpsCounter++;
 const now = performance.now();
 if (now - fpsLastTime >= 1000) {
 fpsDisplay.value = fpsCounter;
 fpsCounter = 0;
 fpsLastTime = now;
 }
 if (webglEnabled.value) {
 renderWebGL();
 }
 else {
 render2D();
 }
 animFrameId = requestAnimationFrame(renderLoop);
}
function stopRenderLoop() {
 if (animFrameId) {
 cancelAnimationFrame(animFrameId);
 animFrameId = null;
 }
}
function getSpotStyle(spot) {
 if (!fftResult.value || !wrapperRef.value)
 return { display: 'none' };
 const { width, height } = fftResult.value;
 const rect = wrapperRef.value.getBoundingClientRect();
 const { width: imgW, height: imgH } = fftResult.value;
 const canvasAspect = rect.width / rect.height;
 const imgAspect = imgW / imgH;
 let baseW, baseH;
 if (imgAspect > canvasAspect) {
 baseW = rect.width;
 baseH = rect.width / imgAspect;
 }
 else {
 baseH = rect.height;
 baseW = rect.height * imgAspect;
 }
 const drawW = baseW * scale.value;
 const drawH = baseH * scale.value;
 const centerX = rect.width / 2 + offsetX.value;
 const centerY = rect.height / 2 + offsetY.value;
 const imgX = (spot.x / width) * drawW;
 const imgY = (spot.y / height) * drawH;
 const px = centerX - drawW / 2 + imgX;
 const py = centerY - drawH / 2 + imgY;
 return {
 left: px + 'px',
 top: py + 'px',
 display: (px >= -20 && px <= rect.width + 20 && py >= -20 && py <= rect.height + 20) ? 'block' : 'none'
 };
}
function getSpotDistance(idx) {
 if (!fftResult.value || !displaySpots.value[idx])
 return 0;
 const spot = displaySpots.value[idx];
 const cx = fftResult.value.width / 2;
 const cy = fftResult.value.height / 2;
 return Math.sqrt((spot.x - cx) ** 2 + (spot.y - cy) ** 2);
}
function handleMouseDown(e) {
 if (!fftResult.value)
 return;
 isDragging.value = true;
 lastMouseX.value = e.clientX;
 lastMouseY.value = e.clientY;
}
function handleMouseMove(e) {
 mouseX.value = e.clientX;
 mouseY.value = e.clientY;
 if (!isDragging.value || !fftResult.value)
 return;
 const dx = e.clientX - lastMouseX.value;
 const dy = e.clientY - lastMouseY.value;
 offsetX.value += dx;
 offsetY.value += dy;
 lastMouseX.value = e.clientX;
 lastMouseY.value = e.clientY;
}
function handleMouseUp() {
 isDragging.value = false;
}
function handleWheel(e) {
 if (!fftResult.value)
 return;
 e.preventDefault();
 const wrapper = wrapperRef.value;
 if (!wrapper)
 return;
 const rect = wrapper.getBoundingClientRect();
 const mx = e.clientX - rect.left - rect.width / 2;
 const my = e.clientY - rect.top - rect.height / 2;
 const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
 const newScale = Math.max(0.1, Math.min(40, scale.value * factor));
 const ratio = newScale / scale.value;
 offsetX.value = mx - (mx - offsetX.value) * ratio;
 offsetY.value = my - (my - offsetY.value) * ratio;
 scale.value = newScale;
}
function zoomIn() {
 scale.value = Math.min(40, scale.value * 1.3);
}
function zoomOut() {
 scale.value = Math.max(0.1, scale.value / 1.3);
}
function resetView() {
 scale.value = 1;
 offsetX.value = 0;
 offsetY.value = 0;
}
function fitView() {
 resetView();
}
function updateLatticeSpacing() {
 if (fftResult.value) {
 const freq = fftResult.value.dominantFrequency;
 fftResult.value.latticeSpacing = freq > 0 ? calibration.value / freq : 0;
 }
}
watch(() => imageStore.fftSpectrumBuffer, async (buf) => {
 if (buf && fftResult.value) {
 await nextTick();
 resizeCanvas();
 if (webglEnabled.value) {
 uploadTextureWebGL();
 }
 else {
 uploadTexture2D();
 }
 resetView();
 }
}, { immediate: false });
watch(fftResult, async (val) => {
 if (val && imageStore.fftSpectrumBuffer) {
 await nextTick();
 resizeCanvas();
 if (webglEnabled.value) {
 uploadTextureWebGL();
 }
 else {
 uploadTexture2D();
 }
 resetView();
 }
});
let resizeObserver = null;
onMounted(async () => {
 await nextTick();
 if (canvasRef.value) {
 const ok = initWebGL();
 if (!ok) {
 webglEnabled.value = false;
 }
 resizeCanvas();
 stopRenderLoop();
 renderLoop();
 }
 if (wrapperRef.value) {
 resizeObserver = new ResizeObserver(() => {
 resizeCanvas();
 });
 resizeObserver.observe(wrapperRef.value);
 }
});
onBeforeUnmount(() => {
 stopRenderLoop();
 if (resizeObserver) {
 resizeObserver.disconnect();
 }
 if (texture && gl)
 gl.deleteTexture(texture);
 if (program && gl)
 gl.deleteProgram(program);
 if (vao && gl)
 gl.deleteVertexArray(vao);
 gl = null;
});
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

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-stats {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: 'Consolas', monospace;
}

.fps-counter {
  font-weight: 700;
  font-size: 13px;
}

.fps-good {
  color: var(--accent-green);
}

.fps-ok {
  color: var(--warning);
}

.fps-bad {
  color: var(--error);
}

.compute-time {
  color: var(--accent-cyan);
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

.fft-canvas-wrapper {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  background: #0a0a15;
  border-radius: 8px;
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.fft-canvas-wrapper:active {
  cursor: grabbing;
}

.fft-canvas-wrapper canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.diffraction-spot {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 2px solid #e94560;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  box-shadow: 0 0 10px rgba(233, 69, 96, 0.7);
  transition: all 0.15s ease;
  cursor: pointer;
  z-index: 5;
}

.diffraction-spot:hover,
.diffraction-spot.active {
  width: 16px;
  height: 16px;
  border-color: var(--accent-cyan);
  box-shadow: 0 0 16px rgba(0, 212, 255, 0.9);
}

.spot-tooltip {
  position: absolute;
  background: rgba(233, 69, 96, 0.95);
  color: white;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-family: 'Consolas', monospace;
  pointer-events: none;
  z-index: 10;
  line-height: 1.6;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.spectrum-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--secondary-dark);
  border-radius: 6px;
}

.toolbar-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-blue);
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;
  font-size: 14px;
}

.toolbar-btn:hover {
  background: var(--accent-red);
  transform: scale(1.05);
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border-color);
  margin: 0 6px;
}

.zoom-display {
  margin-left: auto;
  font-family: 'Consolas', monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent-cyan);
  padding: 0 8px;
}

.spot-count {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.spot-count .highlight {
  color: var(--accent-cyan);
  font-weight: 700;
  font-size: 15px;
  margin: 0 4px;
}

.spot-count .separator {
  margin: 0 8px;
  color: var(--border-color);
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
  transition: background 0.15s;
  font-family: 'Consolas', monospace;
}

.spot-item:last-child {
  border-bottom: none;
}

.spot-item:hover,
.spot-item.active {
  background: var(--accent-blue);
  color: var(--accent-cyan);
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
