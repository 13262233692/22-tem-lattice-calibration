#pragma once

#include <napi.h>
#include <opencv2/opencv.hpp>
#include <string>
#include <Windows.h>

struct SharedMemoryHandle {
    HANDLE hMapFile;
    LPVOID pData;
    std::string name;
    size_t size;
    bool created;
};

class SharedMemoryManager {
public:
    SharedMemoryManager();
    ~SharedMemoryManager();

    SharedMemoryHandle create(const std::string& name, size_t size);
    SharedMemoryHandle open(const std::string& name, size_t size);
    void close(SharedMemoryHandle& handle);
    void writeMat(const SharedMemoryHandle& handle, const cv::Mat& image);
    cv::Mat readMat(const SharedMemoryHandle& handle, int width, int height, int type);
    bool exists(const std::string& name);

private:
    std::string generateName(const std::string& base);
};
