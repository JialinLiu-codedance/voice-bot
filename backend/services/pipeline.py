"""核心管道编排: ASR → LLM → TTS 句子级流水线

将语音识别、大语言模型推理、语音合成串联成完整的对话流水线。
采用句子级流水线设计: LLM 每产出一个句子就立即送入 TTS 合成，
无需等待完整回复，最大化降低首字响应延迟。
"""

import asyncio
import logging

from services.asr_client import VolcASRClient
from services.llm_client import VolcLLMClient
from services.tts_client import VolcTTSClient

logger = logging.getLogger(__name__)


class VoicePipeline:
    """语音对话管道

    编排 ASR → LLM → TTS 的完整对话流程:
    1. 接收前端音频流，送入 ASR 识别
    2. 识别完成后，将文本送入 LLM
    3. LLM 流式回复，按句子粒度切分
    4. 每个句子立即送入 TTS 合成
    5. TTS 音频块通过回调发送给前端
    """

    def __init__(self, config: dict):
        """初始化管道

        Args:
            config: 配置字典，包含以下字段:
                - api_key: 火山方舟 API Key
                - endpoint_id: 推理接入点 ID
                - system_prompt: 系统提示词
                - voice_type: TTS 音色 ID
                - emotion: 情感风格
                - speed: 语速
                - pitch: 音调
        """
        self._config = config
        self._cancel_event = asyncio.Event()

    async def process_audio(
        self,
        audio_stream: asyncio.Queue,
        ws_send_callback,
        session_config: dict,
    ) -> None:
        """处理一轮完整的音频对话

        流程: 音频流 → ASR 识别 → LLM 推理 → TTS 合成 → 音频回传

        Args:
            audio_stream: 音频队列，前端通过 put() 投递音频块，
                          结束时 put(None) 表示音频结束
            ws_send_callback: 发送消息给前端的回调函数
            session_config: 会话配置（角色参数等）
        """
        self._cancel_event.clear()

        # 从会话配置中提取参数
        voice_type = session_config.get("voice_type", "BV700_V2_streaming")
        emotion = session_config.get("emotion", "gentle")
        speed = session_config.get("speed", 1.0)
        pitch = session_config.get("pitch", 1.0)
        history = session_config.get("history", [])

        asr_client = VolcASRClient()
        llm_client = VolcLLMClient(
            api_key=self._config["api_key"],
            endpoint_id=self._config["endpoint_id"],
            system_prompt=self._config["system_prompt"],
        )
        tts_client = VolcTTSClient()

        try:
            # ========== 阶段 1: ASR 语音识别 ==========
            await ws_send_callback({"type": "status", "state": "listening"})
            logger.info("[Pipeline] 阶段 1: 开始 ASR 识别")

            await asr_client.connect()

            # 同时进行音频发送和结果接收
            send_task = asyncio.create_task(
                self._feed_audio_to_asr(asr_client, audio_stream)
            )
            recv_task = asyncio.create_task(asr_client.recv_transcription())

            # 等待两个任务完成
            await send_task
            user_text = await recv_task

            if self._cancel_event.is_set():
                logger.info("[Pipeline] 已取消，跳过后续流程")
                return

            # 发送识别结果给前端
            await ws_send_callback({
                "type": "transcription",
                "text": user_text,
                "is_final": True,
            })

            if not user_text.strip():
                logger.warning("[Pipeline] ASR 识别结果为空，跳过后续流程")
                await ws_send_callback({
                    "type": "status",
                    "state": "idle",
                })
                return

            # ========== 阶段 2: LLM 推理 + TTS 合成 ==========
            await ws_send_callback({"type": "status", "state": "thinking"})
            logger.info("[Pipeline] 阶段 2: 开始 LLM 推理, 用户文本: %s", user_text[:100])

            # 连接 TTS 服务
            await tts_client.connect()
            await ws_send_callback({"type": "status", "state": "speaking"})

            full_reply = ""

            # 流式接收 LLM 回复，按句子送入 TTS
            async for sentence in llm_client.chat_stream(user_text, history):
                if self._cancel_event.is_set():
                    logger.info("[Pipeline] 已取消，中断 LLM 流式接收")
                    break

                full_reply += sentence

                # 发送文本给前端
                await ws_send_callback({
                    "type": "reply_text",
                    "text": sentence,
                    "is_final": False,
                })

                # 将句子送入 TTS 合成
                await tts_client.synthesize(
                    text=sentence,
                    speaker=voice_type,
                    speed=speed,
                    pitch=pitch,
                    emotion=emotion,
                )

                # 接收 TTS 音频并发送给前端
                async for audio_chunk in tts_client.recv_audio():
                    if self._cancel_event.is_set():
                        break
                    await ws_send_callback(audio_chunk)  # 二进制音频数据

            # 发送最终回复文本标记
            await ws_send_callback({
                "type": "reply_text",
                "text": "",
                "is_final": True,
            })

            # 更新对话历史
            history.append({"role": "user", "content": user_text})
            history.append({"role": "assistant", "content": full_reply})

            logger.info("[Pipeline] 对话完成，回复长度: %d 字", len(full_reply))

        except asyncio.CancelledError:
            logger.info("[Pipeline] 任务被取消")
        except Exception as e:
            logger.error("[Pipeline] 处理异常: %s", e, exc_info=True)
            await ws_send_callback({
                "type": "error",
                "message": f"处理失败: {str(e)}",
            })
        finally:
            # 清理连接
            await self._safe_close(asr_client)
            await self._safe_close(tts_client)
            await ws_send_callback({"type": "status", "state": "idle"})

    async def cancel(self) -> None:
        """取消当前正在进行的处理

        设置取消事件，通知所有阶段停止工作。
        """
        logger.info("[Pipeline] 收到取消请求")
        self._cancel_event.set()

    async def _feed_audio_to_asr(
        self, asr_client: VolcASRClient, audio_queue: asyncio.Queue
    ) -> None:
        """从队列中取出音频数据并发送给 ASR

        Args:
            asr_client: ASR 客户端
            audio_queue: 音频队列，None 表示音频结束
        """
        try:
            while True:
                # 带超时的获取，以便响应取消
                try:
                    data = await asyncio.wait_for(audio_queue.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if self._cancel_event.is_set():
                        logger.info("[Pipeline] ASR 音频发送被取消")
                        return
                    continue

                if data is None:
                    # 音频流结束，发送最后一帧
                    await asr_client.send_audio(b"", is_last=True)
                    break

                await asr_client.send_audio(data, is_last=False)

                if self._cancel_event.is_set():
                    return

        except Exception as e:
            logger.error("[Pipeline] ASR 音频发送异常: %s", e)

    @staticmethod
    async def _safe_close(client) -> None:
        """安全关闭客户端连接，忽略异常"""
        try:
            if hasattr(client, "close"):
                await client.close()
        except Exception as e:
            logger.warning("关闭客户端连接时出错: %s", e)
