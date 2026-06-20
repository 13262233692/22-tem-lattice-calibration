#include <napi.h>
#include "TiffProcessor.h"
#include "FFTProcessor.h"
#include "SharedMemory.h"
#include "AsyncFFTWorker.h"
#include <memory>
#include <vector>
#include <string>

Napi::Value LoadTiff(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    
    try {
        TiffProcessor processor;
        TiffInfo infoData = processor.loadTiff(filePath);
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("width", Napi::Number::New(env, infoData.width));
        result.Set("height", Napi::Number::New(env, infoData.height));
        result.Set("bitDepth", Napi::Number::New(env, infoData.bitDepth));
        result.Set("channels", Napi::Number::New(env, infoData.channels));
        result.Set("minValue", Napi::Number::New(env, infoData.minValue));
        result.Set("maxValue", Napi::Number::New(env, infoData.maxValue));
        result.Set("pixelFormat", Napi::String::New(env, infoData.pixelFormat));
        
        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value GetImageWebP(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    int quality = info.Length() > 1 ? info[1].As<Napi::Number>().Int32Value() : 90;
    
    try {
        TiffProcessor processor;
        processor.loadTiff(filePath);
        cv::Mat normalized = processor.getNormalizedImage();
        std::vector<uint8_t> webpData = processor.encodeToWebP(normalized, quality);
        
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, webpData.data(), webpData.size());
        return buffer;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value GetImageTiles(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    int tileSize = info.Length() > 1 ? info[1].As<Napi::Number>().Int32Value() : 1024;
    
    try {
        TiffProcessor processor;
        processor.loadTiff(filePath);
        cv::Mat normalized = processor.getNormalizedImage();
        std::vector<std::vector<uint8_t>> tiles = processor.generateTiles(normalized, tileSize);
        
        Napi::Array result = Napi::Array::New(env, tiles.size());
        for (size_t i = 0; i < tiles.size(); i++) {
            Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(env, tiles[i].data(), tiles[i].size());
            result.Set(i, buffer);
        }
        
        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value ComputeFFT(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    
    try {
        TiffProcessor tiffProcessor;
        tiffProcessor.loadTiff(filePath);
        cv::Mat rawImage = tiffProcessor.getRawImage();
        
        FFTProcessor fftProcessor;
        FFTResult fftResult = fftProcessor.compute2DFFT(rawImage);
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("width", Napi::Number::New(env, fftResult.width));
        result.Set("height", Napi::Number::New(env, fftResult.height));
        result.Set("dominantFrequency", Napi::Number::New(env, fftResult.dominantFrequency));
        result.Set("latticeSpacing", Napi::Number::New(env, fftResult.latticeSpacing));
        
        Napi::Buffer<uint8_t> spectrumBuffer = Napi::Buffer<uint8_t>::Copy(
            env, fftResult.spectrumData.data(), fftResult.spectrumData.size());
        result.Set("spectrumData", spectrumBuffer);
        
        Napi::Array spotsArray = Napi::Array::New(env, fftResult.diffractionSpots.size());
        for (size_t i = 0; i < fftResult.diffractionSpots.size(); i++) {
            Napi::Object spot = Napi::Object::New(env);
            spot.Set("x", Napi::Number::New(env, fftResult.diffractionSpots[i].first));
            spot.Set("y", Napi::Number::New(env, fftResult.diffractionSpots[i].second));
            spotsArray.Set(i, spot);
        }
        result.Set("diffractionSpots", spotsArray);
        
        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value ComputeFFTAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected (filePath: string, useSharedMemory?: boolean)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    bool useSharedMemory = info.Length() > 1 ? info[1].As<Napi::Boolean>().Value() : true;
    
    auto deferred = Napi::Promise::Deferred::New(env);
    ComputeFFTAsyncWorker(env, deferred, filePath, useSharedMemory);
    return deferred.Promise();
}

Napi::Value ComputeFFTFromSharedMemory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (memName: string, width: number, height: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string memName = info[0].As<Napi::String>().Utf8Value();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    
    try {
        FFTProcessor fftProcessor;
        FFTResult fftResult = fftProcessor.compute2DFFTFromSharedMemory(memName, width, height);
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("width", Napi::Number::New(env, fftResult.width));
        result.Set("height", Napi::Number::New(env, fftResult.height));
        result.Set("dominantFrequency", Napi::Number::New(env, fftResult.dominantFrequency));
        result.Set("latticeSpacing", Napi::Number::New(env, fftResult.latticeSpacing));
        
        Napi::Buffer<uint8_t> spectrumBuffer = Napi::Buffer<uint8_t>::Copy(
            env, fftResult.spectrumData.data(), fftResult.spectrumData.size());
        result.Set("spectrumData", spectrumBuffer);
        
        Napi::Array spotsArray = Napi::Array::New(env, fftResult.diffractionSpots.size());
        for (size_t i = 0; i < fftResult.diffractionSpots.size(); i++) {
            Napi::Object spot = Napi::Object::New(env);
            spot.Set("x", Napi::Number::New(env, fftResult.diffractionSpots[i].first));
            spot.Set("y", Napi::Number::New(env, fftResult.diffractionSpots[i].second));
            spotsArray.Set(i, spot);
        }
        result.Set("diffractionSpots", spotsArray);
        
        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value ComputeFFTFromSharedAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (memName: string, width: number, height: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string memName = info[0].As<Napi::String>().Utf8Value();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    
    auto deferred = Napi::Promise::Deferred::New(env);
    ComputeFFTFromSharedMemoryAsyncWorker(env, deferred, memName, width, height);
    return deferred.Promise();
}

Napi::Value CreateSharedMemory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        Napi::TypeError::New(env, "Expected (name: string, size: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string name = info[0].As<Napi::String>().Utf8Value();
    size_t size = static_cast<size_t>(info[1].As<Napi::Number>().Int64Value());
    
    try {
        SharedMemoryManager shm;
        SharedMemoryHandle handle = shm.create(name, size);
        
        if (!handle.created) {
            Napi::Error::New(env, "Failed to create shared memory").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("name", Napi::String::New(env, handle.name));
        result.Set("size", Napi::Number::New(env, static_cast<double>(handle.size)));
        result.Set("created", Napi::Boolean::New(env, handle.created));
        
        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value WriteImageToSharedMemory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Expected (memName: string, imagePath: string)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string memName = info[0].As<Napi::String>().Utf8Value();
    std::string imagePath = info[1].As<Napi::String>().Utf8Value();
    
    try {
        TiffProcessor processor;
        TiffInfo tiffInfo = processor.loadTiff(imagePath);
        cv::Mat rawImage = processor.getRawImage();
        
        size_t dataSize = rawImage.total() * rawImage.elemSize();
        SharedMemoryManager shm;
        
        if (!shm.exists(memName)) {
            shm.create(memName, dataSize);
        }
        
        SharedMemoryHandle handle = shm.open(memName, dataSize);
        if (handle.pData == nullptr) {
            Napi::Error::New(env, "Failed to open shared memory for writing").ThrowAsJavaScriptException();
            return env.Null();
        }
        
        shm.writeMat(handle, rawImage);
        shm.close(handle);
        
        Napi::Object result = Napi::Object::New(env);
        result.Set("success", Napi::Boolean::New(env, true));
        result.Set("width", Napi::Number::New(env, tiffInfo.width));
        result.Set("height", Napi::Number::New(env, tiffInfo.height));
        result.Set("dataSize", Napi::Number::New(env, static_cast<double>(dataSize)));
        
        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value ReadSpectrumFromSharedMemory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Expected (memName: string, width: number, height: number)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string memName = info[0].As<Napi::String>().Utf8Value();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    size_t dataSize = static_cast<size_t>(width) * height * 4;
    
    try {
        SharedMemoryManager shm;
        SharedMemoryHandle handle = shm.open(memName, dataSize);
        
        if (handle.pData == nullptr) {
            Napi::Error::New(env, "Failed to open spectrum shared memory: " + memName).ThrowAsJavaScriptException();
            return env.Null();
        }
        
        Napi::Buffer<uint8_t> buffer = Napi::Buffer<uint8_t>::Copy(
            env,
            static_cast<const uint8_t*>(handle.pData),
            dataSize
        );
        
        shm.close(handle);
        return buffer;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value CloseSharedMemory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "String expected as first argument").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    std::string name = info[0].As<Napi::String>().Utf8Value();
    size_t size = info.Length() > 1 ? static_cast<size_t>(info[1].As<Napi::Number>().Int64Value()) : 0;
    
    try {
        SharedMemoryManager shm;
        SharedMemoryHandle handle = shm.open(name, size);
        shm.close(handle);
        
        return Napi::Boolean::New(env, true);
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

Napi::Value ShutdownThreadPool(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    ThreadPool::getInstance().shutdown();
    return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "loadTiff"), Napi::Function::New(env, LoadTiff));
    exports.Set(Napi::String::New(env, "getImageWebP"), Napi::Function::New(env, GetImageWebP));
    exports.Set(Napi::String::New(env, "getImageTiles"), Napi::Function::New(env, GetImageTiles));
    exports.Set(Napi::String::New(env, "computeFFT"), Napi::Function::New(env, ComputeFFT));
    exports.Set(Napi::String::New(env, "computeFFTAsync"), Napi::Function::New(env, ComputeFFTAsync));
    exports.Set(Napi::String::New(env, "createSharedMemory"), Napi::Function::New(env, CreateSharedMemory));
    exports.Set(Napi::String::New(env, "writeImageToSharedMemory"), Napi::Function::New(env, WriteImageToSharedMemory));
    exports.Set(Napi::String::New(env, "computeFFTFromSharedMemory"), Napi::Function::New(env, ComputeFFTFromSharedMemory));
    exports.Set(Napi::String::New(env, "computeFFTFromSharedAsync"), Napi::Function::New(env, ComputeFFTFromSharedAsync));
    exports.Set(Napi::String::New(env, "readSpectrumFromSharedMemory"), Napi::Function::New(env, ReadSpectrumFromSharedMemory));
    exports.Set(Napi::String::New(env, "closeSharedMemory"), Napi::Function::New(env, CloseSharedMemory));
    exports.Set(Napi::String::New(env, "shutdownThreadPool"), Napi::Function::New(env, ShutdownThreadPool));
    
    return exports;
}

NODE_API_MODULE(tem_image_processor, Init)
