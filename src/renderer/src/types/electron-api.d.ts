export interface ElectronAPI {
  getAddonStatus(): Promise<{ loaded: boolean }>
  
  loadTiff(filePath: string): Promise<{
    width: number
    height: number
    bitDepth: number
    channels: number
    minValue: number
    maxValue: number
    pixelFormat: string
  }>
  
  getTiffWebP(filePath: string, quality?: number): Promise<{
    data: number[]
    type: string
  }>
  
  getTiffTiles(filePath: string, tileSize?: number): Promise<number[][]>
  
  computeFFT(filePath: string): Promise<{
    width: number
    height: number
    spectrumData: number[]
    diffractionSpots: { x: number; y: number }[]
    dominantFrequency: number
    latticeSpacing: number
  }>
  
  createSharedMemory(name: string, size: number): Promise<{
    name: string
    size: number
    created: boolean
  }>
  
  writeImageToShared(memName: string, imagePath: string): Promise<{
    success: boolean
    width: number
    height: number
    dataSize: number
  }>
  
  computeFFTFromShared(memName: string, width: number, height: number): Promise<{
    width: number
    height: number
    spectrumData: number[]
    diffractionSpots: { x: number; y: number }[]
    dominantFrequency: number
    latticeSpacing: number
  }>
  
  closeSharedMemory(name: string, size?: number): Promise<boolean>
  
  getSystemInfo(): Promise<{
    platform: string
    arch: string
    cpus: number
    totalMem: number
    freeMem: number
    tmpdir: string
  }>
  
  onFileSelected(callback: (filePath: string) => void): void
  onComputeFFT(callback: () => void): void
  onComputeFFTShared(callback: () => void): void
  onExportFFT(callback: () => void): void
  
  removeAllListeners(channel: string): void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
