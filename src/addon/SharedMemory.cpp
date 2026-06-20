#include "SharedMemory.h"
#include <iostream>
#include <sstream>
#include <random>

SharedMemoryManager::SharedMemoryManager() {}

SharedMemoryManager::~SharedMemoryManager() {}

std::string SharedMemoryManager::generateName(const std::string& base) {
    std::random_device rd;
    std::mt19937 gen(rd());
    std::uniform_int_distribution<> dis(1000, 9999);
    std::ostringstream oss;
    oss << "Local\\" << base << "_" << dis(gen);
    return oss.str();
}

SharedMemoryHandle SharedMemoryManager::create(const std::string& name, size_t size) {
    SharedMemoryHandle handle;
    handle.name = name;
    handle.size = size;
    handle.created = false;
    handle.hMapFile = nullptr;
    handle.pData = nullptr;

    handle.hMapFile = CreateFileMappingA(
        INVALID_HANDLE_VALUE,
        NULL,
        PAGE_READWRITE,
        0,
        static_cast<DWORD>(size),
        name.c_str()
    );

    if (handle.hMapFile == NULL) {
        std::cerr << "CreateFileMapping failed: " << GetLastError() << std::endl;
        return handle;
    }

    handle.pData = MapViewOfFile(
        handle.hMapFile,
        FILE_MAP_ALL_ACCESS,
        0,
        0,
        size
    );

    if (handle.pData == NULL) {
        std::cerr << "MapViewOfFile failed: " << GetLastError() << std::endl;
        CloseHandle(handle.hMapFile);
        handle.hMapFile = nullptr;
        return handle;
    }

    handle.created = true;
    return handle;
}

SharedMemoryHandle SharedMemoryManager::open(const std::string& name, size_t size) {
    SharedMemoryHandle handle;
    handle.name = name;
    handle.size = size;
    handle.created = false;
    handle.hMapFile = nullptr;
    handle.pData = nullptr;

    handle.hMapFile = OpenFileMappingA(
        FILE_MAP_ALL_ACCESS,
        FALSE,
        name.c_str()
    );

    if (handle.hMapFile == NULL) {
        std::cerr << "OpenFileMapping failed: " << GetLastError() << std::endl;
        return handle;
    }

    handle.pData = MapViewOfFile(
        handle.hMapFile,
        FILE_MAP_ALL_ACCESS,
        0,
        0,
        size
    );

    if (handle.pData == NULL) {
        std::cerr << "MapViewOfFile failed: " << GetLastError() << std::endl;
        CloseHandle(handle.hMapFile);
        handle.hMapFile = nullptr;
        return handle;
    }

    return handle;
}

void SharedMemoryManager::close(SharedMemoryHandle& handle) {
    if (handle.pData != nullptr) {
        UnmapViewOfFile(handle.pData);
        handle.pData = nullptr;
    }
    if (handle.hMapFile != nullptr) {
        CloseHandle(handle.hMapFile);
        handle.hMapFile = nullptr;
    }
    handle.created = false;
}

void SharedMemoryManager::writeMat(const SharedMemoryHandle& handle, const cv::Mat& image) {
    if (handle.pData == nullptr || handle.size < image.total() * image.elemSize()) {
        throw std::runtime_error("Shared memory buffer too small or invalid");
    }
    std::memcpy(handle.pData, image.data, image.total() * image.elemSize());
}

cv::Mat SharedMemoryManager::readMat(const SharedMemoryHandle& handle, int width, int height, int type) {
    if (handle.pData == nullptr) {
        throw std::runtime_error("Invalid shared memory handle");
    }
    return cv::Mat(height, width, type, handle.pData).clone();
}

bool SharedMemoryManager::exists(const std::string& name) {
    HANDLE hMap = OpenFileMappingA(FILE_MAP_READ, FALSE, name.c_str());
    if (hMap != NULL) {
        CloseHandle(hMap);
        return true;
    }
    return false;
}
