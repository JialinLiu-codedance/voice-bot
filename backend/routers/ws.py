"""WebSocket 端点

处理与前端的 WebSocket 长连接，接收音频流和控制消息，
通过 VoicePipeline 处理后返回识别文本、回复文本和 TTS 音频。
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from config import settings
from models.roles import get_role
from models.schemas import SessionConfig
from services.pipeline import VoicePipeline

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """WebSocket 主端点

    消息协议:
    - 前端 → 后端（JSON 控制消息）:
        - {"type": "config", "role": "...", "emotion": "...", "speed": 1.0, "pitch": 1.0}
        - {"type": "audio_start"}
        - {"type": "audio_end"}
        - {"type": "interrupt"}
    - 前端 → 后端（二进制音频帧）: PCM 16kHz 16bit mono 原始字节
    - 后端 → 前端（JSON 消息）:
        - {"type": "transcription", "text": "...", "is_final": false}
        - {"type": "reply_text", "text": "...", "is_final": false}
        - {"type": "status", "state": "listening|thinking|speaking|idle"}
        - {"type": "error", "message": "..."}
    - 后端 → 前端（二进制音频帧）: MP3 音频数据
    """
    await ws.accept()
    logger.info("WebSocket 连接已建立")

    # 当前会话状态
    session_config: dict = {
        "role": "gentle_sister",
        "voice_type": "BV700_V2_streaming",
        "emotion": "gentle",
        "speed": 1.0,
        "pitch": 1.0,
        "history": [],
    }
    pipeline: VoicePipeline | None = None
    pipeline_task: asyncio.Task | None = None
    audio_queue: asyncio.Queue | None = None
    heartbeat_task: asyncio.Task | None = None

    async def ws_send(message) -> None:
        """安全发送消息给前端

        Args:
            message: dict 类型发送 JSON，bytes 类型直接发送二进制
        """
        try:
            if isinstance(message, dict):
                await ws.send_json(message)
            elif isinstance(message, bytes):
                await ws.send_bytes(message)
        except Exception as e:
            logger.warning("发送 WebSocket 消息失败: %s", e)

    async def heartbeat() -> None:
        """心跳保活，每 30 秒发送一次 ping"""
        try:
            while True:
                await asyncio.sleep(30)
                try:
                    await ws.send_json({"type": "ping"})
                except Exception:
                    break
        except asyncio.CancelledError:
            pass

    try:
        # 启动心跳任务
        heartbeat_task = asyncio.create_task(heartbeat())

        while True:
            # 接收消息（文本或二进制）
            try:
                raw = await ws.receive()
            except Exception as e:
                logger.warning("接收消息异常: %s", e)
                break

            # 处理文本消息（JSON 控制消息）
            if "text" in raw and raw["text"] is not None:
                try:
                    msg = json.loads(raw["text"])
                except json.JSONDecodeError:
                    logger.warning("无效的 JSON 消息: %s", raw["text"][:200])
                    continue

                msg_type = msg.get("type", "")
                logger.info("收到控制消息: type=%s", msg_type)

                if msg_type == "config":
                    # 更新会话配置
                    config = SessionConfig(**msg)
                    role = get_role(config.role)
                    if role:
                        session_config["role"] = config.role
                        session_config["voice_type"] = role.voice_type
                        session_config["emotion"] = config.emotion
                        session_config["speed"] = config.speed
                        session_config["pitch"] = config.pitch
                        logger.info("会话配置已更新: role=%s", config.role)
                    else:
                        await ws_send({
                            "type": "error",
                            "message": f"未知角色: {config.role}",
                        })

                elif msg_type == "audio_start":
                    # 开始新一轮音频输入
                    # 如果有正在进行的任务，先取消
                    if pipeline_task and not pipeline_task.done():
                        pipeline.cancel()
                        try:
                            await asyncio.wait_for(pipeline_task, timeout=3.0)
                        except (asyncio.TimeoutError, Exception):
                            pipeline_task.cancel()

                    # 创建新的音频队列和管道
                    audio_queue = asyncio.Queue()
                    role = get_role(session_config["role"])
                    system_prompt = role.system_prompt if role else "你是一个友好的助手。"

                    pipeline = VoicePipeline({
                        "api_key": settings.VOLC_ARK_API_KEY,
                        "endpoint_id": settings.VOLC_ARK_ENDPOINT_ID,
                        "system_prompt": system_prompt,
                    })

                    # 启动管道处理任务
                    pipeline_task = asyncio.create_task(
                        pipeline.process_audio(
                            audio_stream=audio_queue,
                            ws_send_callback=ws_send,
                            session_config=session_config,
                        )
                    )
                    logger.info("音频处理管道已启动")

                elif msg_type == "audio_end":
                    # 音频输入结束
                    if audio_queue is not None:
                        await audio_queue.put(None)  # 发送结束信号
                        logger.info("音频输入已结束")

                elif msg_type == "interrupt":
                    # 用户打断
                    if pipeline_task and not pipeline_task.done():
                        pipeline.cancel()
                        logger.info("用户打断，管道已取消")
                    # 清空音频队列
                    if audio_queue is not None:
                        while not audio_queue.empty():
                            try:
                                audio_queue.get_nowait()
                            except asyncio.QueueEmpty:
                                break
                        await audio_queue.put(None)

                elif msg_type == "pong":
                    # 心跳响应，忽略
                    pass

                else:
                    logger.warning("未知的消息类型: %s", msg_type)

            # 处理二进制消息（音频帧）
            elif "bytes" in raw and raw["bytes"] is not None:
                audio_data = raw["bytes"]
                if audio_queue is not None:
                    await audio_queue.put(audio_data)

    except WebSocketDisconnect:
        logger.info("WebSocket 连接已断开")
    except Exception as e:
        logger.error("WebSocket 处理异常: %s", e, exc_info=True)
    finally:
        # 清理资源
        if heartbeat_task and not heartbeat_task.done():
            heartbeat_task.cancel()
        if pipeline_task and not pipeline_task.done():
            if pipeline:
                pipeline.cancel()
            pipeline_task.cancel()
        logger.info("WebSocket 连接清理完成")
