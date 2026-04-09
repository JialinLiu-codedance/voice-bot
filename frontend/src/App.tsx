import { VoiceChat } from './components/VoiceChat';

/**
 * 主应用组件
 * 深色渐变背景，居中布局
 */
export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4"
         style={{ background: 'linear-gradient(135deg, #1e1040 0%, #0f172a 50%, #0c1445 100%)' }}>
      {/* 标题区域 */}
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-indigo-400 to-blue-400 bg-clip-text text-transparent">
          Voice Bot
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          AI 语音对话助手
        </p>
      </div>

      {/* 语音对话组件 */}
      <VoiceChat />
    </div>
  );
}
