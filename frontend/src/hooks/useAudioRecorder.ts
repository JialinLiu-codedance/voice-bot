import { useRef, useState, useCallback } from 'react';
import { resampleAudio, float32ToInt16 } from '../utils/audioUtils';

interface UseAudioRecorderOptions {
  /** 收到 PCM 音频数据时的回调 (Int16Array, 16kHz mono) */
  onAudioData: (data: Int16Array) => void;
  /** 采样率，默认 16000 */
  targetSampleRate?: number;
}

/**
 * 录音 Hook
 * 使用 AudioWorklet（优先）或 ScriptProcessorNode 获取原始 PCM 数据
 * 输出 16kHz 单声道 Int16 PCM
 */
export function useAudioRecorder(options: UseAudioRecorderOptions) {
  const { onAudioData, targetSampleRate = 16000 } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);

  // 保持回调引用最新
  const onAudioDataRef = useRef(onAudioData);
  onAudioDataRef.current = onAudioData;

  /** 处理录音数据：重采样 + 转换为 Int16 */
  const processAudioData = useCallback(
    (float32Data: Float32Array, inputSampleRate: number) => {
      // 重采样到目标采样率
      const resampled = resampleAudio(float32Data, inputSampleRate, targetSampleRate);
      // 转换为 Int16
      const int16Data = float32ToInt16(resampled);
      onAudioDataRef.current(int16Data);
    },
    [targetSampleRate],
  );

  /** 请求麦克风权限并开始录音 */
  const startRecording = useCallback(async () => {
    try {
      setError(null);

      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 创建 AudioContext
      const audioContext = new AudioContext({ sampleRate: targetSampleRate });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      // 尝试使用 AudioWorklet（更现代、无阻塞）
      try {
        // 创建内联 worklet 代码
        const workletBlob = new Blob(
          [
            `
            class PCMProcessor extends AudioWorkletProcessor {
              process(inputs) {
                const input = inputs[0];
                if (input && input[0]) {
                  this.port.postMessage(input[0]);
                }
                return true;
              }
            }
            registerProcessor('pcm-processor', PCMProcessor);
            `,
          ],
          { type: 'application/javascript' },
        );
        const workletUrl = URL.createObjectURL(workletBlob);
        await audioContext.audioWorklet.addModule(workletUrl);

        const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
        workletNode.port.onmessage = (event) => {
          if (event.data instanceof Float32Array) {
            processAudioData(event.data, audioContext.sampleRate);
          }
        };
        source.connect(workletNode);
        workletNode.connect(audioContext.destination);
        workletNodeRef.current = workletNode;

        console.log('[AudioRecorder] 使用 AudioWorklet');
      } catch {
        // 降级到 ScriptProcessorNode
        console.warn('[AudioRecorder] AudioWorklet 不可用，降级到 ScriptProcessorNode');

        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        processor.onaudioprocess = (event) => {
          const inputData = event.inputBuffer.getChannelData(0);
          // 复制数据，因为 buffer 会被复用
          const copied = new Float32Array(inputData);
          processAudioData(copied, audioContext.sampleRate);
        };
        source.connect(processor);
        processor.connect(audioContext.destination);
        processorNodeRef.current = processor;
      }

      setIsRecording(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : '无法启动录音';
      setError(message);
      console.error('[AudioRecorder] 启动失败:', err);
    }
  }, [processAudioData, targetSampleRate]);

  /** 停止录音并释放资源 */
  const stopRecording = useCallback(() => {
    // 断开 AudioWorklet
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

    // 断开 ScriptProcessorNode
    if (processorNodeRef.current) {
      processorNodeRef.current.disconnect();
      processorNodeRef.current = null;
    }

    // 断开 SourceNode
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    // 关闭 AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 停止媒体流
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    setIsRecording(false);
  }, []);

  return {
    isRecording,
    error,
    startRecording,
    stopRecording,
  };
}
