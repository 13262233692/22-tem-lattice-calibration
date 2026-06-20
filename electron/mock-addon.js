const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const mockSharedMemory = new Map();
let mockSpectrumCounter = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadTiff(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (filePath && (filePath.endsWith('.tif') || filePath.endsWith('.tiff') || filePath.endsWith('.TIFF'))) {
          resolve({
            width: 8192,
            height: 8192,
            bitDepth: 16,
            channels: 1,
            minValue: 0,
            maxValue: 65535,
            pixelFormat: 'CV_16UC1'
          });
        } else {
          resolve({
            width: 8192,
            height: 8192,
            bitDepth: 16,
            channels: 1,
            minValue: 1024,
            maxValue: 65000,
            pixelFormat: 'CV_16UC1'
          });
        }
      } else {
        resolve({
          width: 8192,
          height: 8192,
          bitDepth: 16,
          channels: 1,
          minValue: 1024,
          maxValue: 65000,
          pixelFormat: 'CV_16UC1'
        });
      }
    });
  });
}

function generateLatticePattern(width, height, spacing = 40) {
  const data = new Uint8ClampedArray(width * height * 4);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      value += Math.sin(2 * Math.PI * x / spacing) * 50;
      value += Math.sin(2 * Math.PI * y / spacing) * 50;
      value += Math.sin(2 * Math.PI * (x + y) / (spacing * Math.SQRT2) * 30);
      value += Math.random() * 20 - 10;
      value = Math.max(0, Math.min(255, Math.floor(value + 128)));
      data[idx++] = value;
      data[idx++] = value;
      data[idx++] = value;
      data[idx++] = 255;
    }
  }
  return data;
}

function encodeToPNG(width, height, rgbaData) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgbaData);
  return PNG.sync.write(png);
}

function getImageWebP(filePath, quality = 90) {
  const width = 4096;
  const height = 4096;
  const rgbaData = generateLatticePattern(width, height, 40);
  const pngBuffer = encodeToPNG(width, height, rgbaData);
  return {
    data: Array.from(pngBuffer),
    type: 'image/png'
  };
}

function getImageTiles(filePath, tileSize = 1024) {
  const tiles = [];
  const cols = Math.ceil(4096 / tileSize);
  const rows = Math.ceil(4096 / tileSize);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rgbaData = generateLatticePattern(tileSize, tileSize, 40 + row * 5);
      const pngBuffer = encodeToPNG(tileSize, tileSize, rgbaData);
      tiles.push(Array.from(pngBuffer));
    }
  }
  return tiles;
}

function computeFFTMagnitude(width, height) {
  const magnitude = new Float32Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      let value = 0;
      for (let k = 1; k <= 3; k++) {
        const radius = 50 * k;
        const gaussian = Math.exp(-Math.pow(dist - radius, 2) / 200);
        const angular = Math.pow(Math.cos(angle * 4), 4);
        value += gaussian * (0.5 + angular * 0.5);
      }
      const centerDist = Math.sqrt(dx * dx + dy * dy);
      if (centerDist < 20) {
        value += 2 * (1 - centerDist / 20);
      }
      value += Math.random() * 0.02;
      value = Math.min(1, value);
      magnitude[idx++] = value;
    }
  }
  return magnitude;
}

function detectSpots(magnitude, width, height, numSpots = 50) {
  const spots = [];
  const cx = width / 2;
  const cy = height / 2;
  const values = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < 400) continue;
      values.push({ x, y, value: magnitude[idx] });
    }
  }
  values.sort((a, b) => b.value - a.value);
  const minDist = 25;
  for (const v of values) {
    if (spots.length >= numSpots) break;
    let tooClose = false;
    for (const s of spots) {
      const dx = v.x - s.x;
      const dy = v.y - s.y;
      if (dx * dx + dy * dy < minDist * minDist) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      spots.push({ x: v.x, y: v.y });
    }
  }
  return spots;
}

function generateSpectrumBGRA(width, height) {
  const magnitude = computeFFTMagnitude(width, height);
  let maxVal = 0;
  for (let i = 0; i < magnitude.length; i++) {
    if (magnitude[i] > maxVal) maxVal = magnitude[i];
  }
  const data = new Uint8ClampedArray(width * height * 4);
  let idx = 0;
  for (let i = 0; i < magnitude.length; i++) {
    const v = Math.floor(magnitude[i] / maxVal * 255);
    data[idx++] = v;
    data[idx++] = v;
    data[idx++] = v;
    data[idx++] = 255;
  }
  const spots = detectSpots(magnitude, width, height);
  return { data, spots };
}

function computeFFT(filePath) {
  const width = 4096;
  const height = 4096;
  const { data, spots } = generateSpectrumBGRA(width, height);
  return {
    width,
    height,
    spectrumData: Array.from(data),
    diffractionSpots: spots,
    dominantFrequency: 0.012207,
    latticeSpacing: 81.92
  };
}

function generateSpectrumMemName() {
  mockSpectrumCounter++;
  return `Local\\Mock_FFT_Spectrum_${Date.now()}_${mockSpectrumCounter}`;
}

async function computeFFTAsync(filePath, useSharedMemory = true) {
  const delay = 400 + Math.random() * 300;
  await sleep(delay);
  const width = 4096;
  const height = 4096;
  const { data, spots } = generateSpectrumBGRA(width, height);
  
  let spectrumMemName = null;
  if (useSharedMemory) {
    spectrumMemName = generateSpectrumMemName();
    mockSharedMemory.set(spectrumMemName, {
      width,
      height,
      data: Buffer.from(data)
    });
  }
  
  return {
    success: true,
    spectrumMemName,
    spectrumWidth: width,
    spectrumHeight: height,
    diffractionSpots: spots,
    dominantFrequency: 0.012207,
    latticeSpacing: 81.92,
    computeTimeMs: Math.round(delay)
  };
}

function createSharedMemory(name, size) {
  return { name, size, created: true };
}

function writeImageToSharedMemory(memName, imagePath) {
  return {
    success: true,
    width: 8192,
    height: 8192,
    dataSize: 134217728
  };
}

function computeFFTFromSharedMemory(memName, width, height) {
  return computeFFT('');
}

async function computeFFTFromSharedAsync(memName, width, height) {
  return computeFFTAsync('', true);
}

function readSpectrumFromSharedMemory(memName, width, height) {
  const entry = mockSharedMemory.get(memName);
  if (!entry) {
    throw new Error(`Spectrum shared memory not found: ${memName}`);
  }
  return entry.data;
}

function closeSharedMemory(name, size) {
  mockSharedMemory.delete(name);
  return true;
}

function gaussian(x, y, sigma) {
  return Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
}

function generatePhaseMap(width, height, numDislocations = 2) {
  const phase = new Float32Array(width * height);
  const cx = width / 2;
  const cy = height / 2;
  
  const gx = 1 / 40;
  const gy = 1 / 40;
  
  const dislocations = [];
  for (let i = 0; i < numDislocations; i++) {
    const angle = (i / numDislocations) * Math.PI * 2 + Math.random() * 0.5;
    const radius = Math.min(width, height) * 0.2 + Math.random() * Math.min(width, height) * 0.1;
    dislocations.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      type: i % 2 === 0 ? 'edge' : 'screw',
      burgersAngle: angle + Math.PI / 2 + (Math.random() - 0.5) * 0.3,
      burgersMagnitude: 2.5 + Math.random() * 1.5
    });
  }
  
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let p = 2 * Math.PI * (gx * x + gy * y);
      
      for (const disl of dislocations) {
        const dx = x - disl.x;
        const dy = y - disl.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist > 2) {
          let theta = Math.atan2(dy, dx) - disl.burgersAngle;
          if (disl.type === 'edge') {
            p += Math.atan2(Math.sin(theta), Math.cos(theta) + 0.001) * 0.3;
          } else {
            p += Math.atan2(dy, dx) * 0.25;
          }
        }
        
        const decay = 1 - Math.exp(-dist * dist / 1000);
        p *= decay;
        p += 2 * Math.PI * (gx * x + gy * y) * (1 - decay);
      }
      
      while (p > Math.PI) p -= 2 * Math.PI;
      while (p < -Math.PI) p += 2 * Math.PI;
      
      phase[idx++] = p;
    }
  }
  
  return { phase, dislocations };
}

function computeStrainFromPhase(phase, width, height, gx, gy) {
  const exx = new Float32Array(width * height);
  const eyy = new Float32Array(width * height);
  const exy = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      let dphidx = phase[idx + 1] - phase[idx - 1];
      let dphidy = phase[idx + width] - phase[idx - width];
      
      if (Math.abs(dphidx) > Math.PI) dphidx -= 2 * Math.PI * Math.sign(dphidx);
      if (Math.abs(dphidy) > Math.PI) dphidy -= 2 * Math.PI * Math.sign(dphidy);
      
      dphidx /= 2;
      dphidy /= 2;
      
      exx[idx] = -dphidx / (2 * Math.PI * gx);
      eyy[idx] = -dphidy / (2 * Math.PI * gy);
      exy[idx] = -(dphidx / (2 * Math.PI * gy) + dphidy / (2 * Math.PI * gx)) / 2;
    }
  }
  
  return { exx, eyy, exy };
}

function detectDislocationLines(strain, width, height) {
  const { exx, eyy, exy } = strain;
  const lines = [];
  
  const cx = width / 2;
  const cy = height / 2;
  
  const numLines = 2;
  for (let i = 0; i < numLines; i++) {
    const type = i % 2 === 0 ? 'edge' : 'screw';
    const startAngle = i * Math.PI + Math.random() * 0.5;
    const endAngle = startAngle + Math.PI * 0.6 + Math.random() * 0.4;
    
    const radius = Math.min(width, height) * 0.25;
    
    const points = [];
    const numPoints = 20;
    for (let j = 0; j <= numPoints; j++) {
      const t = j / numPoints;
      const angle = startAngle + (endAngle - startAngle) * t;
      const r = radius + Math.sin(t * Math.PI * 3) * 15 + Math.random() * 5;
      points.push({
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r
      });
    }
    
    const startIdx = 0;
    const burgersVec = {
      x: Math.cos(startAngle + Math.PI / 2) * 2.8,
      y: Math.sin(startAngle + Math.PI / 2) * 2.8
    };
    
    const endIdx = points.length - 1;
    const burgersVecEnd = {
      x: Math.cos(endAngle + Math.PI / 2) * 2.8,
      y: Math.sin(endAngle + Math.PI / 2) * 2.8
    };
    
    const midIdx = Math.floor(points.length / 2);
    const burgersMagnitude = 2.5 + Math.random() * 1.5;
    
    lines.push({
      id: i,
      type,
      points,
      burgersVector: burgersVec,
      burgersMagnitude,
      burgersMagnitudeEnd: burgersMagnitude * (0.9 + Math.random() * 0.2),
      startPoint: points[startIdx],
      endPoint: points[endIdx],
      midPoint: points[midIdx],
      startAngle,
      endAngle
    });
  }
  
  return lines;
}

async function analyzeDislocations(filePath, roiPolygon, options = {}) {
  const delay = 600 + Math.random() * 400;
  await sleep(delay);
  
  const roiWidth = options.roiWidth || 512;
  const roiHeight = options.roiHeight || 512;
  
  const { phase, dislocations } = generatePhaseMap(roiWidth, roiHeight, 2);
  
  const gx = 1 / 40;
  const gy = 1 / 40;
  
  const strain = computeStrainFromPhase(phase, roiWidth, roiHeight, gx, gy);
  
  const dislocationLines = detectDislocationLines(strain, roiWidth, roiHeight);
  
  const phaseImage = new Uint8ClampedArray(roiWidth * roiHeight * 4);
  let pIdx = 0;
  for (let i = 0; i < phase.length; i++) {
    const normalized = (phase[i] + Math.PI) / (2 * Math.PI);
    const v = Math.floor(normalized * 255);
    phaseImage[pIdx++] = v;
    phaseImage[pIdx++] = v;
    phaseImage[pIdx++] = v;
    phaseImage[pIdx++] = 255;
  }
  
  const strainMap = new Uint8ClampedArray(roiWidth * roiHeight * 4);
  let sIdx = 0;
  for (let i = 0; i < strain.exx.length; i++) {
    const exxVal = strain.exx[i];
    const eyyVal = strain.eyy[i];
    const exyVal = strain.exy[i];
    
    const r = Math.floor(Math.max(0, Math.min(255, 128 + exxVal * 5000)));
    const g = Math.floor(Math.max(0, Math.min(255, 128 + eyyVal * 5000)));
    const b = Math.floor(Math.max(0, Math.min(255, 128 + exyVal * 5000)));
    
    strainMap[sIdx++] = r;
    strainMap[sIdx++] = g;
    strainMap[sIdx++] = b;
    strainMap[sIdx++] = 255;
  }
  
  return {
    success: true,
    roiWidth,
    roiHeight,
    computeTimeMs: Math.round(delay),
    numDislocations: dislocationLines.length,
    dislocationLines: dislocationLines.map(line => ({
      id: line.id,
      type: line.type,
      typeName: line.type === 'edge' ? '刃位错' : '螺位错',
      points: line.points,
      burgersVector: line.burgersVector,
      burgersMagnitude_angstrom: line.burgersMagnitude,
      burgersMagnitudeEnd_angstrom: line.burgersMagnitudeEnd,
      startPoint: line.startPoint,
      endPoint: line.endPoint,
      midPoint: line.midPoint,
      startAngle: line.startAngle,
      endAngle: line.endAngle
    })),
    method: 'GPA (Geometric Phase Analysis)',
    gx,
    gy,
    phaseImage: Array.from(phaseImage),
    strainImage: Array.from(strainMap),
    maxStrain_exx: Math.max(...strain.exx),
    maxStrain_eyy: Math.max(...strain.eyy),
    maxStrain_exy: Math.max(...strain.exy)
  };
}

async function analyzeDislocationsFromShared(memName, width, height, roiPolygon, options) {
  return analyzeDislocations('', roiPolygon, options);
}

function shutdownThreadPool() {
  return undefined;
}

module.exports = {
  loadTiff,
  getImageWebP,
  getImageTiles,
  computeFFT,
  computeFFTAsync,
  createSharedMemory,
  writeImageToSharedMemory,
  computeFFTFromSharedMemory,
  computeFFTFromSharedAsync,
  readSpectrumFromSharedMemory,
  closeSharedMemory,
  analyzeDislocations,
  analyzeDislocationsFromShared,
  shutdownThreadPool
};
