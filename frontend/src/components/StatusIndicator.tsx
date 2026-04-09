import type { VoiceState } from '../types';

interface StatusIndicatorProps {
  state: VoiceState;
}

/** 状态对应的配置 */
const STATE_CONFIG: Record<VoiceState, { label: string; color: string; bgClass: string }> = {
  idle: {
    label: '就绪',
    color: 'text-slate-400',
    bgClass: 'bg-slate-500',
  },
  connecting: {
    label: '连接中',
    color: 'text-yellow-400',
    bgClass: 'bg-yellow-500',
  },
  listening: {
    label: '聆听中',
    color: 'text-green-400',
    bgClass: 'bg-green-500',
  },
  thinking: {
    label: '思考中',
    color: 'text-purple-400',
    bgClass: 'bg-purple-500',
  },
  speaking: {
    label: '回答中',
    color: 'text-blue-400',
    bgClass: 'bg-blue-500',
  },
};

/**
 * 状态指示器组件
 * 显示当前语音对话状态，不同状态有不同颜色和动画
 */
export function StatusIndicator({ state }: StatusIndicatorProps) {
  const config = STATE_CONFIG[state];

  return (
    <div className="flex items-center gap-3">
      {/* 状态圆点 + 动画 */}
      <div className="relative flex items-center justify-center w-4 h-4">
        {/* 脉冲光晕（listening 状态） */}
        {state === 'listening' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75 animate-ping" />
        )}
        {/* 旋转光晕（thinking 状态） */}
        {state === 'thinking' && (
          <span className="absolute inline-flex h-6 w-6 rounded-full border-2 border-purple-400 border-t-transparent animate-spin-slow" />
        )}
        {/* 呼吸光晕（speaking 状态） */}
        {state === 'speaking' && (
          <span className="absolute inline-flex h-5 w-5 rounded-full bg-blue-500 animate-breathe" />
        )}
        {/* 连接中光晕 */}
        {state === 'connecting' && (
          <span className="absolute inline-flex h-5 w-5 rounded-full bg-yellow-500 animate-pulse" />
        )}
        {/* 核心圆点 */}
        <span className={`relative inline-flex rounded-full h-3 w-3 ${config.bgClass}`} />
      </div>

      {/* 状态文字 */}
      <span className={`text-sm font-medium ${config.color}`}>
        {config.label}
      </span>
    </div>
  );
}
