#pragma once

#include <napi.h>
#include <opencv2/opencv.hpp>
#include <vector>

struct FFTResult {
    int width;
    int height;
    std::vector<uint8_t> spectrumData;
    std::vector<std::pair<int, int>> diffractionSpots;
    double dominantFrequency;
    double latticeSpacing;
};

class FFTProcessor {
public:
    FFTProcessor();
    ~FFTProcessor();

    FFTResult compute2DFFT(const cv::Mat& image);
    FFTResult compute2DFFTFromSharedMemory(const std::string& memName, int width, int height);

private:
    cv::Mat computeFFTMagnitude(const cv::Mat& src);
    cv::Mat fftShift(const cv::Mat& src);
    std::vector<std::pair<int, int>> detectDiffractionSpots(const cv::Mat& magnitude, int numSpots = 50);
    double calculateDominantFrequency(const cv::Mat& magnitude);
    double calculateLatticeSpacing(double frequency, double calibration = 1.0);
    cv::Mat normalizeSpectrum(const cv::Mat& magnitude);
};
