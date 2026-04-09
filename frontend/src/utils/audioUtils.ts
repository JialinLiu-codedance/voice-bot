/**
 * 音频工具函数
 * 处理音频格式转换和重采样
 */

/**
 * 将 Float32 音频数据转换为 Int16 PCM 格式
 * VAD 输出的 Float32 范围是 [-1, 1]，需要转换到 Int16 范围 [-32768, 32767]
 */
export function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    // 限幅到 [-1, 1]
    const s = Math.max(-1, Math.min(1, float32Array[i]!));
    // 映射到 Int16 范围
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * 音频重采样（线性插值法）
 * 将采样率从 fromRate 转换到 toRate
 * 例如：48kHz → 16kHz
 */
export function resampleAudio(
  data: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  // 采样率相同则直接返回
  if (fromRate === toRate) {
    return data;
  }

  const ratio = fromRate / toRate;
  const newLength = Math.round(data.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    // 线性插值
    const srcIndex = i * ratio;
    const srcFloor = Math.floor(srcIndex);
    const srcCeil = Math.min(srcFloor + 1, data.length - 1);
    const fraction = srcIndex - srcFloor;

    result[i] = data[srcFloor]! * (1 - fraction) + data[srcCeil]! * fraction;
  }

  return result;
}
