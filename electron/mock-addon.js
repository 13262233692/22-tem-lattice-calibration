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
  shutdownThreadPool
};
