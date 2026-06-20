#pragma once

#include <napi.h>
#include <opencv2/opencv.hpp>
#include <string>
#include <vector>
#include <thread>
#include <mutex>
#include <queue>
#include <condition_variable>
#include <functional>
#include "FFTProcessor.h"
#include "SharedMemory.h"

struct AsyncFFTResult {
    bool success;
    std::string errorMessage;
    std::string spectrumMemName;
    int spectrumWidth;
    int spectrumHeight;
    std::vector<std::pair<int, int>> diffractionSpots;
    double dominantFrequency;
    double latticeSpacing;
    uint64_t computeTimeMs;
};

class FFTPromise : public Napi::Promise::Deferred {
public:
    FFTPromise(const Napi::Env& env) : Napi::Promise::Deferred(env) {}
    AsyncFFTResult result;
};

class ThreadPool {
public:
    static ThreadPool& getInstance();
    
    void enqueue(std::function<void()> task);
    void shutdown();
    
private:
    ThreadPool(size_t numThreads = 4);
    ~ThreadPool();
    
    std::vector<std::thread> workers;
    std::queue<std::function<void()>> tasks;
    std::mutex queueMutex;
    std::condition_variable condition;
    bool stop;
};

void ComputeFFTAsyncWorker(
    Napi::Env env,
    Napi::Promise::Deferred deferred,
    const std::string& filePath,
    bool useSharedMemory
);

void ComputeFFTFromSharedMemoryAsyncWorker(
    Napi::Env env,
    Napi::Promise::Deferred deferred,
    const std::string& memName,
    int width,
    int height
);

AsyncFFTResult DoComputeFFT(const std::string& filePath, bool useSharedMemory);
AsyncFFTResult DoComputeFFTFromSharedMemory(const std::string& memName, int width, int height);

std::string GenerateSpectrumMemName();
bool WriteSpectrumToSharedMemory(
    const std::string& memName,
    const cv::Mat& spectrumBGRA
);
