/** 角色信息 */
export interface Role {
  id: string;
  name: string;
  voice_type: string;
  description: string;
  avatar: string;
  default_emotion: EmotionType;
  default_speed: number;
  default_pitch: number;
}

/** 情绪类型 */
export type EmotionType =
  | 'gentle'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'neutral'
  | 'apologetic'
  | 'comforting';

/** 情绪中文名映射 */
export const EMOTION_LABELS: Record<EmotionType, string> = {
  gentle: '温柔',
  happy: '开心',
  sad: '悲伤',
  angry: '愤怒',
  neutral: '平静',
  apologetic: '抱歉',
  comforting: '安慰',
};

/** 会话配置（发送给服务端） */
export interface SessionConfig {
  role: string;
  emotion: EmotionType;
  speed: number;
  pitch: number;
}

/* ---------- WebSocket 消息类型 ---------- */

/** 客户端→服务端消息 */
export type ClientMessage =
  | { type: 'config'; role: string; emotion: EmotionType; speed: number; pitch: number }
  | { type: 'audio_start' }
  | { type: 'audio_end' }
  | { type: 'interrupt' };

/** 服务端→客户端状态消息 */
export type ServerStatus = 'listening' | 'thinking' | 'speaking';

/** 服务端→客户端消息（JSON 部分） */
export type ServerMessage =
  | { type: 'transcription'; text: string; is_final: boolean }
  | { type: 'reply_text'; text: string; is_final: boolean }
  | { type: 'status'; state: ServerStatus }
  | { type: 'error'; message: string };

/** 对话记录条目 */
export interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

/** WebSocket 连接状态 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/** 语音对话整体状态 */
export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';
