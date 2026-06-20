#include "TiffProcessor.h"
#include <opencv2/imgcodecs.hpp>
#include <opencv2/imgproc.hpp>
#include <iostream>
#include <sstream>

TiffProcessor::TiffProcessor() : m_loaded(false) {}

TiffProcessor::~TiffProcessor() {}

TiffInfo TiffProcessor::loadTiff(const std::string& filePath) {
    m_rawImage = cv::imread(filePath, cv::IMREAD_UNCHANGED);
    
    if (m_rawImage.empty()) {
        throw std::runtime_error("Failed to load TIFF image: " + filePath);
    }

    m_info.width = m_rawImage.cols;
    m_info.height = m_rawImage.rows;
    m_info.channels = m_rawImage.channels();
    m_info.bitDepth = m_rawImage.depth() == CV_16U ? 16 : 
                      m_rawImage.depth() == CV_8U ? 8 : 
                      m_rawImage.depth() == CV_32F ? 32 : 0;
    
    std::ostringstream fmt;
    fmt << "CV_" << m_info.bitDepth;
    if (m_info.channels == 1) fmt << "C1";
    else if (m_info.channels == 3) fmt << "C3";
    else fmt << "C" << m_info.channels;
    m_info.pixelFormat = fmt.str();

    double minVal, maxVal;
    cv::minMaxLoc(m_rawImage, &minVal, &maxVal);
    m_info.minValue = minVal;
    m_info.maxValue = maxVal;

    normalize16BitTo8Bit();
    m_loaded = true;

    return m_info;
}

void TiffProcessor::normalize16BitTo8Bit() {
    if (m_rawImage.depth() == CV_16U) {
        cv::Mat temp;
        m_rawImage.convertTo(temp, CV_8U, 255.0 / 65535.0);
        cv::cvtColor(temp, m_normalizedImage, cv::COLOR_GRAY2BGRA);
    } else if (m_rawImage.depth() == CV_8U) {
        if (m_rawImage.channels() == 1) {
            cv::cvtColor(m_rawImage, m_normalizedImage, cv::COLOR_GRAY2BGRA);
        } else {
            cv::cvtColor(m_rawImage, m_normalizedImage, cv::COLOR_BGR2BGRA);
        }
    } else {
        m_normalizedImage = m_rawImage.clone();
    }
}

cv::Mat TiffProcessor::getRawImage() const {
    return m_rawImage;
}

cv::Mat TiffProcessor::getNormalizedImage() const {
    return m_normalizedImage;
}

std::vector<uint8_t> TiffProcessor::encodeToWebP(const cv::Mat& image, int quality) {
    std::vector<uint8_t> webpData;
    std::vector<int> params = {cv::IMWRITE_WEBP_QUALITY, quality};
    cv::imencode(".webp", image, webpData, params);
    return webpData;
}

std::vector<std::vector<uint8_t>> TiffProcessor::generateTiles(const cv::Mat& image, int tileSize) {
    std::vector<std::vector<uint8_t>> tiles;
    int cols = image.cols;
    int rows = image.rows;

    for (int y = 0; y < rows; y += tileSize) {
        for (int x = 0; x < cols; x += tileSize) {
            int w = std::min(tileSize, cols - x);
            int h = std::min(tileSize, rows - y);
            cv::Rect roi(x, y, w, h);
            cv::Mat tile = image(roi).clone();
            
            if (w < tileSize || h < tileSize) {
                cv::Mat padded(tileSize, tileSize, image.type(), cv::Scalar(0, 0, 0, 0));
                tile.copyTo(padded(cv::Rect(0, 0, w, h)));
                tile = padded;
            }
            
            std::vector<uint8_t> webpTile;
            std::vector<int> params = {cv::IMWRITE_WEBP_QUALITY, 85};
            cv::imencode(".webp", tile, webpTile, params);
            tiles.push_back(webpTile);
        }
    }

    return tiles;
}

cv::Mat TiffProcessor::convertTo8Bit(const cv::Mat& image, double minVal, double maxVal) {
    cv::Mat result;
    if (image.depth() == CV_16U) {
        image.convertTo(result, CV_8U, 255.0 / (maxVal - minVal), -255.0 * minVal / (maxVal - minVal));
    } else {
        image.convertTo(result, CV_8U);
    }
    return result;
}
