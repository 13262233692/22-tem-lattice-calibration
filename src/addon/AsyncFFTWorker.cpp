#include "AsyncFFTWorker.h"
#include "TiffProcessor.h"
#include <chrono>
#include <random>
#include <sstream>
#include <iostream>

ThreadPool& ThreadPool::getInstance() {
    static ThreadPool instance(std::thread::hardware_concurrency() > 0 ? 
                                std::min(4u, std::thread::hardware_concurrency()) : 4u);
    return instance;
}

ThreadPool::ThreadPool(size_t numThreads) : stop(false) {
    for (size_t i = 0; i < numThreads; ++i) {
        workers.emplace_back([this] {
            for (;;) {
                std::function<void()> task;
                {
                    std::unique_lock<std::mutex> lock(this->queueMutex);
                    this->condition.wait(lock, [this] {
                        return this->stop || !this->tasks.empty();
                    });
                    if (this->stop && this->tasks.empty()) return;
                    task = std::move(this->tasks.front());
                    this->tasks.pop();
                }
                try {
                    task();
                } catch (const std::exception& e) {
                    std::cerr << "ThreadPool task exception: " << e.what() << std::endl;
                }
            }
        });
    }
}

ThreadPool::~ThreadPool() {
    shutdown();
}

void ThreadPool::enqueue(std::function<void()> task) {
    {
        std::unique_lock<std::mutex> lock(queueMutex);
        tasks.emplace(std::move(task));
    }
    condition.notify_one();
}

void ThreadPool::shutdown() {
    {
        std::unique_lock<std::mutex> lock(queueMutex);
        stop = true;
    }
    condition.notify_all();
    for (std::thread& worker : workers) {
        if (worker.joinable()) worker.join();
    }
    workers.clear();
}

std::string GenerateSpectrumMemName() {
    static std::atomic<uint64_t> counter(0);
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<uint64_t> dis(100000, 999999);
    std::ostringstream oss;
    oss << "Local\\TEM_FFT_Spectrum_" << dis(gen) << "_" << counter.fetch_add(1);
    return oss.str();
}

bool WriteSpectrumToSharedMemory(const std::string& memName, const cv::Mat& spectrumBGRA) {
    SharedMemoryManager shm;
    size_t dataSize = spectrumBGRA.total() * spectrumBGRA.elemSize();
    SharedMemoryHandle handle = shm.create(memName, dataSize);
    
    if (!handle.created) {
        std::cerr << "Failed to create shared memory for spectrum: " << memName << std::endl;
        return false;
    }
    
    shm.writeMat(handle, spectrumBGRA);
    shm.close(handle);
    return true;
}

AsyncFFTResult DoComputeFFT(const std::string& filePath, bool useSharedMemory) {
    auto startTime = std::chrono::high_resolution_clock::now();
    AsyncFFTResult result;
    result.success = false;
    
    try {
        TiffProcessor tiffProcessor;
        TiffInfo tiffInfo = tiffProcessor.loadTiff(filePath);
        cv::Mat rawImage = tiffProcessor.getRawImage();
        
        FFTProcessor fftProcessor;
        FFTResult fftResult = fftProcessor.compute2DFFT(rawImage);
        
        result.spectrumWidth = fftResult.width;
        result.spectrumHeight = fftResult.height;
        result.diffractionSpots = fftResult.diffractionSpots;
        result.dominantFrequency = fftResult.dominantFrequency;
        result.latticeSpacing = fftResult.latticeSpacing;
        
        if (useSharedMemory) {
            cv::Mat spectrumBGRA(fftResult.height, fftResult.width, CV_8UC4, fftResult.spectrumData.data());
            result.spectrumMemName = GenerateSpectrumMemName();
            
            if (!WriteSpectrumToSharedMemory(result.spectrumMemName, spectrumBGRA)) {
                result.errorMessage = "Failed to write spectrum to shared memory";
                return result;
            }
        }
        
        auto endTime = std::chrono::high_resolution_clock::now();
        result.computeTimeMs = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime).count();
        result.success = true;
        
    } catch (const std::exception& e) {
        result.errorMessage = e.what();
    }
    
    return result;
}

AsyncFFTResult DoComputeFFTFromSharedMemory(const std::string& memName, int width, int height) {
    auto startTime = std::chrono::high_resolution_clock::now();
    AsyncFFTResult result;
    result.success = false;
    
    try {
        FFTProcessor fftProcessor;
        FFTResult fftResult = fftProcessor.compute2DFFTFromSharedMemory(memName, width, height);
        
        result.spectrumWidth = fftResult.width;
        result.spectrumHeight = fftResult.height;
        result.diffractionSpots = fftResult.diffractionSpots;
        result.dominantFrequency = fftResult.dominantFrequency;
        result.latticeSpacing = fftResult.latticeSpacing;
        
        cv::Mat spectrumBGRA(fftResult.height, fftResult.width, CV_8UC4, fftResult.spectrumData.data());
        result.spectrumMemName = GenerateSpectrumMemName();
        
        if (!WriteSpectrumToSharedMemory(result.spectrumMemName, spectrumBGRA)) {
            result.errorMessage = "Failed to write spectrum to shared memory";
            return result;
        }
        
        auto endTime = std::chrono::high_resolution_clock::now();
        result.computeTimeMs = std::chrono::duration_cast<std::chrono::milliseconds>(endTime - startTime).count();
        result.success = true;
        
    } catch (const std::exception& e) {
        result.errorMessage = e.what();
    }
    
    return result;
}

void ComputeFFTAsyncWorker(
    Napi::Env env,
    Napi::Promise::Deferred deferred,
    const std::string& filePath,
    bool useSharedMemory
) {
    ThreadPool::getInstance().enqueue([env, deferred, filePath, useSharedMemory]() {
        AsyncFFTResult asyncResult = DoComputeFFT(filePath, useSharedMemory);
        
        Napi::HandleScope scope(env);
        
        if (asyncResult.success) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, true));
            result.Set("spectrumMemName", Napi::String::New(env, asyncResult.spectrumMemName));
            result.Set("spectrumWidth", Napi::Number::New(env, asyncResult.spectrumWidth));
            result.Set("spectrumHeight", Napi::Number::New(env, asyncResult.spectrumHeight));
            result.Set("dominantFrequency", Napi::Number::New(env, asyncResult.dominantFrequency));
            result.Set("latticeSpacing", Napi::Number::New(env, asyncResult.latticeSpacing));
            result.Set("computeTimeMs", Napi::Number::New(env, static_cast<double>(asyncResult.computeTimeMs)));
            
            Napi::Array spotsArray = Napi::Array::New(env, asyncResult.diffractionSpots.size());
            for (size_t i = 0; i < asyncResult.diffractionSpots.size(); i++) {
                Napi::Object spot = Napi::Object::New(env);
                spot.Set("x", Napi::Number::New(env, asyncResult.diffractionSpots[i].first));
                spot.Set("y", Napi::Number::New(env, asyncResult.diffractionSpots[i].second));
                spotsArray.Set(i, spot);
            }
            result.Set("diffractionSpots", spotsArray);
            
            deferred.Resolve(result);
        } else {
            Napi::Error err = Napi::Error::New(env, asyncResult.errorMessage);
            deferred.Reject(err.Value());
        }
    });
}

void ComputeFFTFromSharedMemoryAsyncWorker(
    Napi::Env env,
    Napi::Promise::Deferred deferred,
    const std::string& memName,
    int width,
    int height
) {
    ThreadPool::getInstance().enqueue([env, deferred, memName, width, height]() {
        AsyncFFTResult asyncResult = DoComputeFFTFromSharedMemory(memName, width, height);
        
        Napi::HandleScope scope(env);
        
        if (asyncResult.success) {
            Napi::Object result = Napi::Object::New(env);
            result.Set("success", Napi::Boolean::New(env, true));
            result.Set("spectrumMemName", Napi::String::New(env, asyncResult.spectrumMemName));
            result.Set("spectrumWidth", Napi::Number::New(env, asyncResult.spectrumWidth));
            result.Set("spectrumHeight", Napi::Number::New(env, asyncResult.spectrumHeight));
            result.Set("dominantFrequency", Napi::Number::New(env, asyncResult.dominantFrequency));
            result.Set("latticeSpacing", Napi::Number::New(env, asyncResult.latticeSpacing));
            result.Set("computeTimeMs", Napi::Number::New(env, static_cast<double>(asyncResult.computeTimeMs)));
            
            Napi::Array spotsArray = Napi::Array::New(env, asyncResult.diffractionSpots.size());
            for (size_t i = 0; i < asyncResult.diffractionSpots.size(); i++) {
                Napi::Object spot = Napi::Object::New(env);
                spot.Set("x", Napi::Number::New(env, asyncResult.diffractionSpots[i].first));
                spot.Set("y", Napi::Number::New(env, asyncResult.diffractionSpots[i].second));
                spotsArray.Set(i, spot);
            }
            result.Set("diffractionSpots", spotsArray);
            
            deferred.Resolve(result);
        } else {
            Napi::Error err = Napi::Error::New(env, asyncResult.errorMessage);
            deferred.Reject(err.Value());
        }
    });
}
