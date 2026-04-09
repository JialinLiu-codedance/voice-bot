import { useRef, useEffect } from 'react';
import type { VoiceState } from '../types';

interface WaveformProps {
  /** 音量级别 0-1 */
  audioLevel: number;
  /** 当前语音状态，用于改变波形颜色 */
  state: VoiceState;
}

/** 不同状态对应的渐变色 */
const STATE_GRADIENTS: Record<VoiceState, [string, string]> = {
  idle: ['#475569', '#64748b'],         // 灰色
  connecting: ['#eab308', '#f59e0b'],    // 黄色
  listening: ['#22c55e', '#10b981'],     // 绿色
  thinking: ['#a855f7', '#7c3aed'],      // 紫色
  speaking: ['#3b82f6', '#6366f1'],      // 蓝色
};

/**
 * 波形可视化组件
 * 使用 Canvas 2D 绘制实时音频波形
 */
export function Waveform({ audioLevel, state }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  // 平滑过渡的音量值
  const smoothedLevelRef = useRef(0);
  // 历史波形数据（用于绘制连续波形）
  const barsRef = useRef<number[]>(new Array(40).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const [colorStart, colorEnd] = STATE_GRADIENTS[state];

    const draw = () => {
      const { width, height } = canvas;

      // 平滑过渡音量值
      const target = audioLevel;
      smoothedLevelRef.current += (target - smoothedLevelRef.current) * 0.15;
      const level = smoothedLevelRef.current;

      // 更新波形柱状数据
      const bars = barsRef.current;
      // 每帧推进一位
      for (let i = 0; i < bars.length - 1; i++) {
        bars[i] = bars[i + 1]!;
      }
      // 新的柱高，加入少量随机抖动模拟真实波形
      const jitter = (Math.random() - 0.5) * 0.1;
      bars[bars.length - 1] = Math.max(0.02, level + jitter);

      // 清空画布
      ctx.clearRect(0, 0, width, height);

      // 绘制波形柱
      const barCount = bars.length;
      const barWidth = width / barCount;
      const gap = 2;
      const midY = height / 2;

      for (let i = 0; i < barCount; i++) {
        const barHeight = bars[i]! * height * 0.8;
        const x = i * barWidth + gap / 2;
        const actualBarWidth = barWidth - gap;

        // 创建渐变色
        const gradient = ctx.createLinearGradient(0, midY - barHeight / 2, 0, midY + barHeight / 2);
        gradient.addColorStop(0, colorStart);
        gradient.addColorStop(1, colorEnd);

        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.3 + bars[i]! * 0.7;

        // 绘制上下对称的柱状
        const radius = Math.min(actualBarWidth / 2, 3);
        // 上半部分
        roundRect(
          ctx,
          x,
          midY - barHeight / 2,
          actualBarWidth,
          barHeight,
          radius,
        );
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      animFrameRef.current = requestAnimationFrame(draw);
    };

    // 设置画布实际分辨率
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    draw();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [audioLevel, state]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-16 rounded-xl"
      style={{ display: 'block' }}
    />
  );
}

/** 绘制圆角矩形 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
