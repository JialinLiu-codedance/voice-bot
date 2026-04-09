import { useEffect, useRef } from 'react';
import type { TranscriptEntry } from '../types';

interface TranscriptPanelProps {
  /** 对话记录列表 */
  entries: TranscriptEntry[];
}

/**
 * 对话文本面板
 * 显示用户和 AI 的对话记录，自动滚动到最新消息
 */
export function TranscriptPanel({ entries }: TranscriptPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 自动滚动到最新消息
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto custom-scrollbar space-y-3 px-1"
    >
      {entries.length === 0 ? (
        // 空状态提示
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-slate-500">开始对话后，消息会显示在这里...</p>
        </div>
      ) : (
        entries.map((entry) => (
          <div
            key={entry.id}
            className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`
                max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed
                ${
                  entry.role === 'user'
                    ? 'bg-purple-600/30 text-purple-100 rounded-br-sm'
                    : 'bg-white/10 text-slate-200 rounded-bl-sm'
                }
              `}
            >
              {/* 角色标签 */}
              <div
                className={`text-[10px] font-medium mb-1 ${
                  entry.role === 'user' ? 'text-purple-300' : 'text-indigo-300'
                }`}
              >
                {entry.role === 'user' ? '你' : 'AI'}
              </div>

              {/* 消息内容 */}
              <p className="whitespace-pre-wrap break-words">
                {entry.text}
                {/* 未完成的消息显示闪烁光标 */}
                {!entry.isFinal && (
                  <span className="inline-block w-1.5 h-4 ml-1 bg-current align-middle animate-blink-cursor" />
                )}
              </p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
