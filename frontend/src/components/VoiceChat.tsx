import { useState, useCallback, useRef, useEffect } from 'react';
import type {
  Role,
  EmotionType,
  VoiceState,
  TranscriptEntry,
  ServerMessage,
} from '../types';
import { useWebSocket } from '../hooks/useWebSocket';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { useVAD } from '../hooks/useVAD';
import { float32ToInt16, resampleAudio } from '../utils/audioUtils';
import { StatusIndicator } from './StatusIndicator';
import { Waveform } from './Waveform';
import { RoleSelector } from './RoleSelector';
import { EmotionTuner } from './EmotionTuner';
import { TranscriptPanel } from './TranscriptPanel';

/**
 * 核心语音对话组件
 *
 * 状态机: idle → connecting → listening ⇄ thinking → speaking → listening (循环)
 *
 * 流程:
 * 1. 点击开始 → 建立 WS → 发送 config → 开始录音 + VAD
 * 2. VAD speechEnd → 发送音频 → ASR 识别 → LLM 回复 → TTS 播放
 * 3. 播放期间 VAD 检测到用户说话 → interrupt → 停止播放 → 重新进入 listening
 */
export function VoiceChat() {
  /* ---------- 状态 ---------- */
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [speed, setSpeed] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [emotion, setEmotion] = useState<EmotionType>('neutral');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [showSettings, setShowSettings] = useState(true);

  // 保存最新的非 final 文本条目 ID，用于更新
  const pendingUserEntryRef = useRef<string | null>(null);
  const pendingAIEntryRef = useRef<string | null>(null);

  /* ---------- Hooks ---------- */

  // 音频播放器
  const player = useAudioPlayer();

  // WebSocket 连接
  const ws = useWebSocket({
    onMessage: (data) => {
      try {
        const msg = JSON.parse(data) as ServerMessage;
        handleServerMessage(msg);
      } catch {
        console.warn('[VoiceChat] 解析消息失败:', data);
      }
    },
    onBinaryMessage: (data) => {
      // 二进制 MP3 音频块，加入播放队列
      player.enqueueAudio(data);
    },
    onDisconnect: () => {
      if (voiceState !== 'idle') {
        setVoiceState('idle');
        recorder.stopRecording();
        vad.stop();
      }
    },
  });

  // 音频录制：收集 PCM 数据并发送
  const audioBufferRef = useRef<Int16Array[]>([]);
  const isRecordingRef = useRef(false);

  const recorder = useAudioRecorder({
    onAudioData: (data: Int16Array) => {
      // 录音期间持续收集音频数据
      if (isRecordingRef.current) {
        audioBufferRef.current.push(data);
      }
    },
  });

  // VAD 语音检测
  const vad = useVAD({
    onSpeechStart: () => {
      console.log('[VoiceChat] VAD 检测到语音开始');

      // 如果 AI 正在说话，执行打断
      if (voiceState === 'speaking') {
        handleInterrupt();
      }
    },
    onSpeechEnd: (audio: Float32Array) => {
      console.log('[VoiceChat] VAD 检测到语音结束，发送音频');
      handleSpeechEnd(audio);
    },
  });

  // 保存 voiceState 的最新引用给 VAD 回调使用
  const voiceStateRef = useRef(voiceState);
  voiceStateRef.current = voiceState;

  /* ---------- 服务端消息处理 ---------- */

  const handleServerMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'status': {
          // 服务端状态变更
          const newState = msg.state;
          if (newState === 'listening') {
            setVoiceState('listening');
          } else if (newState === 'thinking') {
            setVoiceState('thinking');
          } else if (newState === 'speaking') {
            setVoiceState('speaking');
          }
          break;
        }

        case 'transcription': {
          // ASR 识别结果
          if (msg.is_final) {
            // 最终结果：更新为已完成
            const entryId = pendingUserEntryRef.current;
            if (entryId) {
              setTranscript((prev) =>
                prev.map((e) =>
                  e.id === entryId ? { ...e, text: msg.text, isFinal: true } : e,
                ),
              );
              pendingUserEntryRef.current = null;
            } else {
              // 没有暂存条目，直接添加
              addTranscriptEntry('user', msg.text, true);
            }
          } else {
            // 中间结果：创建或更新暂存条目
            if (!pendingUserEntryRef.current) {
              const id = addTranscriptEntry('user', msg.text, false);
              pendingUserEntryRef.current = id;
            } else {
              setTranscript((prev) =>
                prev.map((e) =>
                  e.id === pendingUserEntryRef.current ? { ...e, text: msg.text } : e,
                ),
              );
            }
          }
          break;
        }

        case 'reply_text': {
          // LLM 回复文本
          if (msg.is_final) {
            const entryId = pendingAIEntryRef.current;
            if (entryId) {
              setTranscript((prev) =>
                prev.map((e) =>
                  e.id === entryId ? { ...e, text: msg.text, isFinal: true } : e,
                ),
              );
              pendingAIEntryRef.current = null;
            } else {
              addTranscriptEntry('assistant', msg.text, true);
            }
          } else {
            if (!pendingAIEntryRef.current) {
              const id = addTranscriptEntry('assistant', msg.text, false);
              pendingAIEntryRef.current = id;
            } else {
              setTranscript((prev) =>
                prev.map((e) =>
                  e.id === pendingAIEntryRef.current ? { ...e, text: msg.text } : e,
                ),
              );
            }
          }
          break;
        }

        case 'error': {
          console.error('[VoiceChat] 服务端错误:', msg.message);
          break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voiceState],
  );

  /** 添加对话记录条目 */
  const addTranscriptEntry = useCallback(
    (role: 'user' | 'assistant', text: string, isFinal: boolean): string => {
      const id = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry: TranscriptEntry = {
        id,
        role,
        text,
        timestamp: Date.now(),
        isFinal,
      };
      setTranscript((prev) => [...prev, entry]);
      return id;
    },
    [],
  );

  /* ---------- 核心流程 ---------- */

  /** 处理 VAD 检测到的语音结束 */
  const handleSpeechEnd = useCallback(
    (vadAudio: Float32Array) => {
      // 将 VAD 录音转为 Int16 并发送
      const resampled = resampleAudio(vadAudio, 16000, 16000);
      const pcmData = float32ToInt16(resampled);

      // 通知服务端音频开始
      ws.sendJson({ type: 'audio_start' });

      // 发送 VAD 捕获的完整音频
      ws.sendBinary(pcmData.buffer);

      // 同时发送 recorder 收集的所有音频数据
      if (audioBufferRef.current.length > 0) {
        // 合并所有块
        const totalLength = audioBufferRef.current.reduce(
          (sum, chunk) => sum + chunk.length,
          0,
        );
        const merged = new Int16Array(totalLength);
        let offset = 0;
        for (const chunk of audioBufferRef.current) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        ws.sendBinary(merged.buffer);
      }

      // 通知服务端音频结束
      ws.sendJson({ type: 'audio_end' });

      // 清空音频缓冲
      audioBufferRef.current = [];
    },
    [ws],
  );

  /** 处理打断 */
  const handleInterrupt = useCallback(() => {
    console.log('[VoiceChat] 执行打断');
    // 发送打断指令
    ws.sendJson({ type: 'interrupt' });
    // 停止播放
    player.stop();
    // 回到 listening 状态
    setVoiceState('listening');
  }, [ws, player]);

  /** 开始会话 */
  const startSession = useCallback(async () => {
    if (!selectedRole) return;

    setVoiceState('connecting');
    audioBufferRef.current = [];

    // 建立 WebSocket 连接
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws.connect(wsUrl);

    // 等待连接建立（简单轮询）
    await new Promise<void>((resolve) => {
      const check = () => {
        if (ws.connectionState === 'connected') {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      // 超时保护
      const timeout = setTimeout(() => resolve(), 5000);
      check();
      clearTimeout(timeout);
    });

    // 发送配置
    ws.sendJson({
      type: 'config',
      role: selectedRole.id,
      emotion,
      speed,
      pitch,
    });

    // 开始录音
    isRecordingRef.current = true;
    await recorder.startRecording();

    // 启动 VAD（传入 recorder 的 MediaStream）
    await vad.start();

    setVoiceState('listening');
    setShowSettings(false);
  }, [selectedRole, emotion, speed, pitch, ws, recorder, vad]);

  /** 停止会话 */
  const stopSession = useCallback(() => {
    // 停止录音
    isRecordingRef.current = false;
    recorder.stopRecording();

    // 停止 VAD
    vad.stop();

    // 停止播放
    player.stop();

    // 断开 WebSocket
    ws.disconnect();

    setVoiceState('idle');
    setShowSettings(true);
  }, [recorder, vad, player, ws]);

  /** 处理配置变更 */
  const handleConfigChange = useCallback(
    (config: { speed: number; pitch: number; emotion: EmotionType }) => {
      setSpeed(config.speed);
      setPitch(config.pitch);
      setEmotion(config.emotion);

      // 如果正在会话中，实时更新配置
      if (voiceState !== 'idle' && ws.connectionState === 'connected' && selectedRole) {
        ws.sendJson({
          type: 'config',
          role: selectedRole.id,
          emotion: config.emotion,
          speed: config.speed,
          pitch: config.pitch,
        });
      }
    },
    [voiceState, ws, selectedRole],
  );

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
    };
  }, []);

  /* ---------- 渲染 ---------- */

  const isInSession = voiceState !== 'idle';

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-4">
      {/* 状态指示器 */}
      <div className="flex items-center justify-between">
        <StatusIndicator state={voiceState} />
        {isInSession && (
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            {showSettings ? '收起设置' : '展开设置'}
          </button>
        )}
      </div>

      {/* 波形可视化 */}
      <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
        <Waveform audioLevel={player.currentLevel} state={voiceState} />
      </div>

      {/* 设置面板 */}
      {showSettings && (
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10 space-y-5">
          {/* 角色选择 */}
          <div>
            <h3 className="text-xs text-slate-400 mb-3 font-medium">选择角色</h3>
            <RoleSelector
              selectedRoleId={selectedRole?.id ?? null}
              onChange={setSelectedRole}
            />
          </div>

          {/* 情绪微调 */}
          <div>
            <h3 className="text-xs text-slate-400 mb-3 font-medium">声音微调</h3>
            <EmotionTuner
              speed={speed}
              pitch={pitch}
              emotion={emotion}
              onChange={handleConfigChange}
            />
          </div>
        </div>
      )}

      {/* 对话面板 */}
      <div className="bg-white/5 rounded-2xl border border-white/10 flex flex-col overflow-hidden"
           style={{ height: '280px' }}>
        <div className="px-4 pt-3 pb-2 border-b border-white/5">
          <h3 className="text-xs text-slate-400 font-medium">对话记录</h3>
        </div>
        <div className="flex-1 px-4 py-2 overflow-hidden">
          <TranscriptPanel entries={transcript} />
        </div>
      </div>

      {/* 控制按钮 */}
      <div className="flex justify-center">
        {!isInSession ? (
          /* 开始按钮 */
          <button
            onClick={startSession}
            disabled={!selectedRole}
            className={`
              relative w-16 h-16 rounded-full flex items-center justify-center
              transition-all duration-300
              ${
                selectedRole
                  ? 'bg-gradient-to-br from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105 active:scale-95'
                  : 'bg-slate-700 cursor-not-allowed opacity-50'
              }
            `}
          >
            {/* 麦克风图标 */}
            <svg
              className="w-7 h-7 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
          </button>
        ) : (
          /* 停止按钮 */
          <button
            onClick={stopSession}
            className="relative w-16 h-16 rounded-full flex items-center justify-center
              bg-gradient-to-br from-red-500 to-red-600
              hover:from-red-400 hover:to-red-500
              shadow-lg shadow-red-500/30 hover:shadow-red-500/50
              transition-all duration-300 hover:scale-105 active:scale-95"
          >
            {/* 停止图标 */}
            <svg
              className="w-7 h-7 text-white"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>

            {/* 脉冲环 */}
            {voiceState === 'listening' && (
              <span className="absolute inset-0 rounded-full border-2 border-green-400 animate-ping opacity-50" />
            )}
          </button>
        )}
      </div>

      {/* 提示文字 */}
      {!isInSession && (
        <p className="text-center text-xs text-slate-500">
          {selectedRole ? '点击麦克风按钮开始对话' : '请先选择一个角色'}
        </p>
      )}
      {isInSession && voiceState === 'listening' && (
        <p className="text-center text-xs text-slate-500">
          请说话... AI 正在聆听
        </p>
      )}
      {isInSession && voiceState === 'thinking' && (
        <p className="text-center text-xs text-purple-400">
          AI 正在思考回复...
        </p>
      )}
    </div>
  );
}
