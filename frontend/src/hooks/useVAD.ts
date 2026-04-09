import { useRef, useState, useCallback } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

interface UseVADOptions {
  /** 检测到语音开始的回调 */
  onSpeechStart?: () => void;
  /** 检测到语音结束的回调，参数为录音数据 */
  onSpeechEnd?: (audio: Float32Array) => void;
}

/**
 * VAD（Voice Activity Detection）语音检测 Hook
 * 使用 @ricky0123/vad-web 进行端点检测
 */
export function useVAD(options: UseVADOptions = {}) {
  const { onSpeechStart, onSpeechEnd } = options;

  const [isActive, setIsActive] = useState(false);
  const vadRef = useRef<MicVAD | null>(null);

  // 保持回调引用最新
  const onSpeechStartRef = useRef(onSpeechStart);
  const onSpeechEndRef = useRef(onSpeechEnd);
  onSpeechStartRef.current = onSpeechStart;
  onSpeechEndRef.current = onSpeechEnd;

  /**
   * 启动 VAD 检测
   * @param stream 已获取的 MediaStream，若不传则自行请求麦克风
   */
  const start = useCallback(async (stream?: MediaStream) => {
    try {
      // 如果已有实例先销毁
      if (vadRef.current) {
        vadRef.current.destroy();
        vadRef.current = null;
      }

      const vad = await MicVAD.new({
        // 传入已有的 stream，避免重复请求麦克风权限
        stream: stream ?? undefined,

        // 语音检测参数
        positiveSpeechThreshold: 0.5, // 高于此阈值认为在说话
        negativeSpeechThreshold: 0.35, // 低于此阈值认为停止说话
        redemptionMs: 500, // 语音结束后等待多久确认（防抖）
        minSpeechFrames: 3, // 至少 3 帧才算有效语音

        frameSamples: 1536, // 每帧采样数（对应 96ms @16kHz）

        // 语音开始
        onSpeechStart: () => {
          onSpeechStartRef.current?.();
        },

        // 语音结束，audio 是完整的语音录音（Float32）
        onSpeechEnd: (audio) => {
          onSpeechEndRef.current?.(audio);
        },
      });

      vadRef.current = vad;
      vad.start();
      setIsActive(true);

      console.log('[VAD] 已启动');
    } catch (err) {
      console.error('[VAD] 启动失败:', err);
      throw err;
    }
  }, []);

  /** 停止 VAD 检测 */
  const stop = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.destroy();
      vadRef.current = null;
    }
    setIsActive(false);
    console.log('[VAD] 已停止');
  }, []);

  /** 暂停 VAD（不销毁实例） */
  const pause = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.pause();
      setIsActive(false);
    }
  }, []);

  return {
    isActive,
    start,
    stop,
    pause,
  };
}
