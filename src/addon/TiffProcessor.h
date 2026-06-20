#pragma once

#include <napi.h>
#include <opencv2/opencv.hpp>
#include <string>
#include <vector>

struct TiffInfo {
    int width;
    int height;
    int bitDepth;
    int channels;
    double minValue;
    double maxValue;
    std::string pixelFormat;
};

class TiffProcessor {
public:
    TiffProcessor();
    ~TiffProcessor();

    TiffInfo loadTiff(const std::string& filePath);
    cv::Mat getRawImage() const;
    cv::Mat getNormalizedImage() const;
    std::vector<uint8_t> encodeToWebP(const cv::Mat& image, int quality = 90);
    std::vector<std::vector<uint8_t>> generateTiles(const cv::Mat& image, int tileSize = 1024);
    cv::Mat convertTo8Bit(const cv::Mat& image, double minVal, double maxVal);

private:
    cv::Mat m_rawImage;
    cv::Mat m_normalizedImage;
    TiffInfo m_info;
    bool m_loaded;

    void normalize16BitTo8Bit();
};
