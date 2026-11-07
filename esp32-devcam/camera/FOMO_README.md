# Chick-only FOMO camera

The firmware uses the Edge Impulse export in `../edge-impulse-model`.
Keep that folder next to `camera`; its generated files are not modified.
The old ESPDet wrapper and `.espdl` file are retained but not built or embedded.
ESP-DL is still used for JPEG decoding, not for model inference.

## Build and flash

In an activated ESP-IDF 5.4 terminal:

```powershell
cd C:\Users\LENOVO\Desktop\ESP32_S3_CAM_DEVELOPMENT\camera
idf.py build
idf.py -p COM7 flash monitor
```

Exit any other serial monitor with Ctrl+] before flashing.
Look for `Chick-only FOMO ready: 240x240 RGB INT8`.
After opening the page, successful detections print `FOMO: chick ... at (x,y)`.
Classifier errors print `run_classifier failed` with the SDK error code.

## View and test

Connect to Wi-Fi `ESP32-CAM`, password `12345678`, then open
`http://192.168.5.1`. The incubator controller uses `192.168.4.1`;
the camera also joins its network as a station with a separately assigned IP.
Reload the page after flashing.

- This export detects **chicks only**. It does not classify eggs.
- The camera captures 640x480 JPEG. Inference uses the central 480x480
  region resized to 240x240 with the SDK's exported fit-shortest preprocessing.
  The page outlines that region; keep chicks inside it.
- Markers identify FOMO object centres, not precise object boundaries.
- Confidence defaults to the export's 50% threshold. The slider adjusts actual
  FOMO postprocessing from 10% to 90%. Lower settings expose weak candidates
  but can increase false positives. The model weights are unchanged.
- The detector status shows the strongest raw chick score, threshold, and
  detection count, or a specific inference/preprocessing error. The same
  summary is logged every three seconds, even when no chick is detected.
- Video requests and inference run independently, so centre markers can lag
  moving chicks. Results older than two seconds are hidden.
- JPEG input is copied into PSRAM for one background job at a time. The SDK's
  crop scratch buffer is sized for the full intermediate crop to avoid overflow.
- Save photo and browser MP4 recording still include the visible markers.
  MP4 recording requires browser support and is limited to two-minute clips.
- Preview requests are paced at up to 20 FPS, including request/decode time.
  The FPS display measures time between completed frames. Actual speed depends
  on Wi-Fi, lighting, inference load, and the browser. Photos and recordings
  use the capture resolution; verify detection accuracy on hardware.
  Camera and CPU clocks are unchanged. Reduced work does not guarantee a safe
  board temperature; power off an excessively hot board and check its supply,
  wiring, and cooling before retesting.
- Failed station connections retry after 30 seconds to avoid continuous scans
  interfering with the setup hotspot. HTTP runs on core 0, separate from AI
  on core 1. The preview shows request, capture, and AI timings; slow firmware
  responses over 500 ms also log capture time, total time, and JPEG size.

Build success does not establish model accuracy or on-device inference speed.
Test with actual chicks under the intended lighting and camera distance.
