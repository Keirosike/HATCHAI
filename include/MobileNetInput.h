#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
namespace HatchMobileNet {
constexpr int Width = 160, Height = 160, Channels = 3;
// Direct bilinear RGB resize, half-pixel centers. Model contains normalization.
// int8 tensor scale=1, zero=-128: quantized channel = RGB byte - 128.
inline bool prepare(const uint8_t *rgb, int width, int height, int8_t *output,
                    size_t capacity) {
  if (!rgb || !output || width < 1 || height < 1 ||
      capacity < size_t(Width * Height * Channels))
    return false;
  for (int y = 0; y < Height; y++) {
    float sy = (y + .5f) * height / Height - .5f;
    if (sy < 0)
      sy = 0;
    int y0 = int(sy), y1 = y0 + 1 < height ? y0 + 1 : y0;
    const float dy = sy - y0;
    for (int x = 0; x < Width; x++) {
      float sx = (x + .5f) * width / Width - .5f;
      if (sx < 0)
        sx = 0;
      int x0 = int(sx), x1 = x0 + 1 < width ? x0 + 1 : x0;
      const float dx = sx - x0;
      for (int c = 0; c < 3; c++) {
        const float a = rgb[(y0 * width + x0) * 3 + c] * (1 - dx) +
                        rgb[(y0 * width + x1) * 3 + c] * dx;
        const float b = rgb[(y1 * width + x0) * 3 + c] * (1 - dx) +
                        rgb[(y1 * width + x1) * 3 + c] * dx;
        int v = int(a * (1 - dy) + b * dy + .5f);
        if (v < 0)
          v = 0;
        if (v > 255)
          v = 255;
        output[(y * Width + x) * 3 + c] = int8_t(v - 128);
      }
    }
  }
  return true;
}
inline bool usable(const uint8_t *rgb, int width, int height) {
  if (!rgb || width < 1 || height < 1)
    return false;
  int lo[3] = {255, 255, 255}, hi[3] = {0, 0, 0};
  const size_t count = size_t(width) * height, step = count / 4096 + 1;
  for (size_t i = 0; i < count; i += step)
    for (int c = 0; c < 3; c++) {
      const int value = rgb[i * 3 + c];
      if (value < lo[c])
        lo[c] = value;
      if (value > hi[c])
        hi[c] = value;
    }
  return hi[0] - lo[0] >= 8 || hi[1] - lo[1] >= 8 || hi[2] - lo[2] >= 8;
}
inline float probability(int8_t value) { return (int(value) + 128) / 256.0f; }
} // namespace HatchMobileNet
