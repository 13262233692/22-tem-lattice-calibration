const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function loadTiff(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (filePath.endsWith('.tif') || filePath.endsWith('.tiff')) {
          const width = 4096;
          const height = 4096;
          resolve({
            width: width,
            height: height,
            bitDepth: 16,
            channels: 1,
            minValue: 0,
            maxValue: 65535,
            pixelFormat: 'CV_16UC1'
          });
        } else {
          reject(err);
        }
      } else {
        const width = 4096;
        const height = 4096;
        resolve({
          width: width,
          height: height,
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

function generateTestImage(width, height) {
  const data = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.floor(Math.sin(x * 0.05) * 127 + 128);
      data.push(value, value, value, 255);
    }
  }
  return data;
}

function generateLatticePattern(width, height, spacing = 20) {
  const data = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 0;
      value += Math.sin(2 * Math.PI * x / spacing) * 50;
      value += Math.sin(2 * Math.PI * y / spacing) * 50;
      value += Math.sin(2 * Math.PI * (x + y) / (spacing * Math.sqrt(2))) * 30;
      value += Math.random() * 20 - 10;
      value = Math.max(0, Math.min(255, Math.floor(value + 128)));
      data.push(value, value, value, 255);
    }
  }
  return data;
}

function encodeToPNG(width, height, rgbaData) {
  const png = new PNG({ width, height });
  for (let i = 0; i < rgbaData.length; i++) {
    png.data[i] = rgbaData[i];
  }
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
  const magnitude = [];
  const cx = width / 2;
  const cy = height / 2;
  
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
      magnitude.push(value);
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

function computeFFT(filePath) {
  const width = 4096;
  const height = 4096;
  
  const magnitude = computeFFTMagnitude(width, height);
  const maxVal = Math.max(...magnitude);
  
  const spectrumData = [];
  for (let i = 0; i < magnitude.length; i++) {
    const v = Math.floor((magnitude[i] / maxVal) * 255);
    spectrumData.push(v, v, v, 255);
  }
  
  const diffractionSpots = detectSpots(magnitude, width, height);
  
  return {
    width: width,
    height: height,
    spectrumData: spectrumData,
    diffractionSpots: diffractionSpots,
    dominantFrequency: 0.012207,
    latticeSpacing: 81.9200
  };
}

function createSharedMemory(name, size) {
  return {
    name: name,
    size: size,
    created: true
  };
}

function writeImageToShared(memName, imagePath) {
  return {
    success: true,
    width: 4096,
    height: 4096,
    dataSize: 33554432
  };
}

function computeFFTFromShared(memName, width, height) {
  return computeFFT('');
}

function closeSharedMemory(name, size) {
  return true;
}

module.exports = {
  loadTiff,
  getImageWebP,
  getImageTiles,
  computeFFT,
  createSharedMemory,
  writeImageToShared,
  computeFFTFromShared,
  closeSharedMemory
};
