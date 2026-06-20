{
  "targets": [
    {
      "target_name": "tem_image_processor",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "C:/opencv/build/include",
        "C:/opencv/build/include/opencv2"
      ],
      "libraries": [
        "-LC:/opencv/build/x64/vc16/lib",
        "-lopencv_world490"
      ],
      "sources": [
        "src/addon/main.cpp",
        "src/addon/TiffProcessor.cpp",
        "src/addon/FFTProcessor.cpp",
        "src/addon/SharedMemory.cpp"
      ],
      "conditions": [
        ["OS==\"win\"", {
          "libraries": [
            "-lpsapi"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalIncludeDirectories": [
                "C:/opencv/build/include",
                "C:/opencv/build/include/opencv2"
              ]
            },
            "VCLinkerTool": {
              "AdditionalLibraryDirectories": [
                "C:/opencv/build/x64/vc16/lib"
              ],
              "AdditionalDependencies": [
                "opencv_world490.lib",
                "psapi.lib"
              ]
            }
          }
        }]
      ]
    }
  ]
}
