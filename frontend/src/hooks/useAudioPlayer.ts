import { useRef, useState, useCallback } from 'react';

/**
 * 音频播放 Hook
 * 使用 Web Audio API 播放 MP3 音频块
 * 支持队列播放和打断
 */
export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  // 播放队列：待解码的 MP3 块
  const queueRef = useRef<ArrayBuffer[]>([]);
  // 是否正在处理队列
  const isProcessingRef = useRef(false);
  // 当前正在播放的 source 节点（用于打断）
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  // 分析器节点（用于获取音量级别）
  const analyserRef = useRef<AnalyserNode | null>(null);
  // 动画帧 ID
  const animFrameRef = useRef<number | null>(null);
  // 是否被停止
  const stoppedRef = useRef(false);

  /** 确保 AudioContext 和 Analyser 已初始化 */
  const ensureContext = useCallback(() => {
    if (!audioContextRef.current) {
      const ctx = new AudioContext();
      audioContextRef.current = ctx;

      // 创建分析器
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
    }
    return audioContextRef.current;
  }, []);

  /** 读取当前音量级别并更新 state */
  const updateLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    // 计算 RMS 平均音量 (归一化到 0-1)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = dataArray[i]! / 255;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    setCurrentLevel(rms);

    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, []);

  /** 开始音量级别监控 */
  const startLevelMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    animFrameRef.current = requestAnimationFrame(updateLevel);
  }, [updateLevel]);

  /** 停止音量级别监控 */
  const stopLevelMonitor = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setCurrentLevel(0);
  }, []);

  /** 处理播放队列 */
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    const ctx = audioContextRef.current;
    if (!ctx) {
      isProcessingRef.current = false;
      return;
    }

    while (queueRef.current.length > 0 && !stoppedRef.current) {
      const chunk = queueRef.current.shift()!;

      try {
        // 恢复挂起的 AudioContext（浏览器要求用户交互后才能播放）
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // 解码 MP3 数据
        const audioBuffer = await ctx.decodeAudioData(chunk);

        if (stoppedRef.current) break;

        // 创建播放节点
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        currentSourceRef.current = source;

        // 连接到分析器
        const analyser = analyserRef.current;
        if (analyser) {
          source.connect(analyser);
        }

        setIsPlaying(true);
        startLevelMonitor();

        // 等待播放完成
        await new Promise<void>((resolve) => {
          source.onended = () => {
            resolve();
          };
          source.start();
        });

        if (stoppedRef.current) break;
      } catch (err) {
        console.error('[AudioPlayer] 解码/播放失败:', err);
      }
    }

    currentSourceRef.current = null;
    isProcessingRef.current = false;

    // 队列全部播放完毕
    if (!stoppedRef.current) {
      setIsPlaying(false);
      stopLevelMonitor();
    }
  }, [startLevelMonitor, stopLevelMonitor]);

  /**
   * 将 MP3 音频块加入播放队列
   * 服务端发来的二进制消息可以直接传入
   */
  const enqueueAudio = useCallback(
    (mp3Chunk: ArrayBuffer) => {
      ensureContext();
      stoppedRef.current = false;
      queueRef.current.push(mp3Chunk);
      processQueue();
    },
    [ensureContext, processQueue],
  );

  /**
   * 停止播放并清空队列
   * 用于打断 AI 说话
   */
  const stop = useCallback(() => {
    stoppedRef.current = true;

    // 停止当前播放
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
      } catch {
        // 忽略已经停止的 source
      }
      currentSourceRef.current = null;
    }

    // 清空队列
    queueRef.current = [];
    isProcessingRef.current = false;

    setIsPlaying(false);
    stopLevelMonitor();
  }, [stopLevelMonitor]);

  return {
    isPlaying,
    currentLevel,
    enqueueAudio,
    stop,
  };
}
