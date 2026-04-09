import type { EmotionType } from '../types';
import { EMOTION_LABELS } from '../types';

interface EmotionTunerProps {
  /** 当前语速 */
  speed: number;
  /** 当前音调 */
  pitch: number;
  /** 当前情绪 */
  emotion: EmotionType;
  /** 配置变更回调 */
  onChange: (config: { speed: number; pitch: number; emotion: EmotionType }) => void;
}

/** 可选的情绪列表 */
const EMOTION_OPTIONS: EmotionType[] = [
  'neutral',
  'gentle',
  'happy',
  'sad',
  'angry',
  'apologetic',
  'comforting',
];

/**
 * 情绪微调面板
 * 包含语速、音调滑块和情绪选择
 */
export function EmotionTuner({ speed, pitch, emotion, onChange }: EmotionTunerProps) {
  return (
    <div className="space-y-4">
      {/* 语速滑块 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-slate-400">语速</label>
          <span className="text-xs text-purple-300 font-mono">{speed.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={speed}
          onChange={(e) => onChange({ speed: parseFloat(e.target.value), pitch, emotion })}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer
            bg-slate-700
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-purple-500
            [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:shadow-purple-500/30
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110"
        />
      </div>

      {/* 音调滑块 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-slate-400">音调</label>
          <span className="text-xs text-purple-300 font-mono">{pitch.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.1"
          value={pitch}
          onChange={(e) => onChange({ speed, pitch: parseFloat(e.target.value), emotion })}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer
            bg-slate-700
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-indigo-500
            [&::-webkit-slider-thumb]:shadow-lg
            [&::-webkit-slider-thumb]:shadow-indigo-500/30
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-110"
        />
      </div>

      {/* 情绪选择 */}
      <div>
        <label className="text-xs text-slate-400 mb-2 block">情绪</label>
        <div className="flex flex-wrap gap-1.5">
          {EMOTION_OPTIONS.map((em) => {
            const isSelected = emotion === em;
            return (
              <button
                key={em}
                onClick={() => onChange({ speed, pitch, emotion: em })}
                className={`
                  px-2.5 py-1 text-xs rounded-lg transition-all duration-150
                  ${
                    isSelected
                      ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-300'
                  }
                `}
              >
                {EMOTION_LABELS[em]}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
