#include "FFTProcessor.h"
#include "SharedMemory.h"
#include <opencv2/imgproc.hpp>
#include <opencv2/imgcodecs.hpp>
#include <cmath>
#include <algorithm>

FFTProcessor::FFTProcessor() {}

FFTProcessor::~FFTProcessor() {}

cv::Mat FFTProcessor::computeFFTMagnitude(const cv::Mat& src) {
    cv::Mat floatSrc;
    if (src.channels() > 1) {
        cv::cvtColor(src, floatSrc, cv::COLOR_BGRA2GRAY);
        floatSrc.convertTo(floatSrc, CV_32F);
    } else {
        src.convertTo(floatSrc, CV_32F);
    }

    int m = cv::getOptimalDFTSize(floatSrc.rows);
    int n = cv::getOptimalDFTSize(floatSrc.cols);

    cv::Mat padded;
    cv::copyMakeBorder(floatSrc, padded, 0, m - floatSrc.rows, 0, n - floatSrc.cols, cv::BORDER_CONSTANT, cv::Scalar::all(0));

    cv::Mat planes[] = {cv::Mat_<float>(padded), cv::Mat::zeros(padded.size(), CV_32F)};
    cv::Mat complexI;
    cv::merge(planes, 2, complexI);

    cv::dft(complexI, complexI);

    cv::split(complexI, planes);
    cv::magnitude(planes[0], planes[1], planes[0]);
    cv::Mat magI = planes[0];

    magI += cv::Scalar::all(1);
    cv::log(magI, magI);

    return fftShift(magI);
}

cv::Mat FFTProcessor::fftShift(const cv::Mat& src) {
    cv::Mat dst = src.clone();
    int cx = dst.cols / 2;
    int cy = dst.rows / 2;

    cv::Mat q0(dst, cv::Rect(0, 0, cx, cy));
    cv::Mat q1(dst, cv::Rect(cx, 0, cx, cy));
    cv::Mat q2(dst, cv::Rect(0, cy, cx, cy));
    cv::Mat q3(dst, cv::Rect(cx, cy, cx, cy));

    cv::Mat tmp;
    q0.copyTo(tmp);
    q3.copyTo(q0);
    tmp.copyTo(q3);

    q1.copyTo(tmp);
    q2.copyTo(q1);
    tmp.copyTo(q2);

    return dst;
}

cv::Mat FFTProcessor::normalizeSpectrum(const cv::Mat& magnitude) {
    cv::Mat normalized;
    cv::normalize(magnitude, normalized, 0, 255, cv::NORM_MINMAX, CV_8U);
    cv::cvtColor(normalized, normalized, cv::COLOR_GRAY2BGRA);
    return normalized;
}

std::vector<std::pair<int, int>> FFTProcessor::detectDiffractionSpots(const cv::Mat& magnitude, int numSpots) {
    std::vector<std::pair<int, int>> spots;
    std::vector<std::pair<double, std::pair<int, int>>> values;

    int cx = magnitude.cols / 2;
    int cy = magnitude.rows / 2;
    int centerRadius = 20;

    for (int y = 0; y < magnitude.rows; y++) {
        for (int x = 0; x < magnitude.cols; x++) {
            int dx = x - cx;
            int dy = y - cy;
            if (dx * dx + dy * dy < centerRadius * centerRadius) {
                continue;
            }
            double val = magnitude.at<float>(y, x);
            values.push_back({val, {x, y}});
        }
    }

    std::sort(values.begin(), values.end(), [](const auto& a, const auto& b) {
        return a.first > b.first;
    });

    int minDistance = 15;
    for (size_t i = 0; i < values.size() && spots.size() < numSpots; i++) {
        int x = values[i].second.first;
        int y = values[i].second.second;
        bool tooClose = false;
        for (const auto& spot : spots) {
            int dx = x - spot.first;
            int dy = y - spot.second;
            if (dx * dx + dy * dy < minDistance * minDistance) {
                tooClose = true;
                break;
            }
        }
        if (!tooClose) {
            spots.push_back({x, y});
        }
    }

    return spots;
}

double FFTProcessor::calculateDominantFrequency(const cv::Mat& magnitude) {
    int cx = magnitude.cols / 2;
    int cy = magnitude.rows / 2;
    
    double maxVal = 0;
    double dominantFreq = 0;
    int maxRadius = std::min(cx, cy) / 2;

    for (int radius = 10; radius < maxRadius; radius++) {
        double ringSum = 0;
        int ringCount = 0;
        
        for (int angle = 0; angle < 360; angle += 2) {
            double rad = angle * CV_PI / 180.0;
            int x = cx + static_cast<int>(radius * std::cos(rad));
            int y = cy + static_cast<int>(radius * std::sin(rad));
            
            if (x >= 0 && x < magnitude.cols && y >= 0 && y < magnitude.rows) {
                ringSum += magnitude.at<float>(y, x);
                ringCount++;
            }
        }
        
        if (ringCount > 0) {
            double avg = ringSum / ringCount;
            if (avg > maxVal) {
                maxVal = avg;
                dominantFreq = static_cast<double>(radius) / std::min(magnitude.cols, magnitude.rows);
            }
        }
    }

    return dominantFreq;
}

double FFTProcessor::calculateLatticeSpacing(double frequency, double calibration) {
    if (frequency <= 0) return 0;
    return calibration / frequency;
}

FFTResult FFTProcessor::compute2DFFT(const cv::Mat& image) {
    FFTResult result;
    
    cv::Mat magnitude = computeFFTMagnitude(image);
    cv::Mat spectrum = normalizeSpectrum(magnitude);
    
    result.width = spectrum.cols;
    result.height = spectrum.rows;
    
    result.spectrumData.assign(spectrum.data, spectrum.data + spectrum.total() * spectrum.elemSize());
    
    result.diffractionSpots = detectDiffractionSpots(magnitude);
    result.dominantFrequency = calculateDominantFrequency(magnitude);
    result.latticeSpacing = calculateLatticeSpacing(result.dominantFrequency);
    
    return result;
}

FFTResult FFTProcessor::compute2DFFTFromSharedMemory(const std::string& memName, int width, int height) {
    SharedMemoryManager shm;
    SharedMemoryHandle handle = shm.open(memName, static_cast<size_t>(width) * height * 2);
    
    if (handle.pData == nullptr) {
        throw std::runtime_error("Failed to open shared memory: " + memName);
    }
    
    cv::Mat image(height, width, CV_16UC1, handle.pData);
    FFTResult result = compute2DFFT(image);
    
    shm.close(handle);
    return result;
}
