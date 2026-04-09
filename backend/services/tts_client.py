"""火山云 TTS V3 双向流式客户端

使用火山引擎语音合成 V3 版本的二进制 WebSocket 协议。
协议格式与 ASR 相同: 4字节 header [message_type(1B)][flags(1B)][serial(2B BE)] + payload
服务端在 event=260 时返回 MP3 音频数据。
"""

import asyncio
import json
import logging
import struct
import uuid
from typing import AsyncGenerator

import websockets

from config import settings

logger = logging.getLogger(__name__)

# 消息类型
MSG_TYPE_FULL_REQUEST = 0x01  # 完整 JSON 请求
MSG_TYPE_AUDIO_ONLY = 0x09  # 音频数据（TTS 中不使用）
MSG_TYPE_LAST_AUDIO = 0x0F  # 最后音频（TTS 中不使用）

# TTS 事件常量
EVENT_START_CONNECTION = 1  # 客户端 → 开始连接
EVENT_CONNECTION_STARTED = 50  # 服务端 → 连接已建立
EVENT_START_SESSION = 100  # 客户端 → 开始会话
EVENT_SESSION_STARTED = 150  # 服务端 → 会话已建立
EVENT_TASK_REQUEST = 200  # 客户端 → 请求合成任务
EVENT_TTS_SENTENCE_START = 250  # 服务端 → 句子合成开始
EVENT_TTS_RESPONSE = 260  # 服务端 → TTS 音频数据（payload 为 MP3）
EVENT_TTS_SENTENCE_END = 270  # 服务端 → 句子合成结束
EVENT_FINISH_SESSION = 300  # 客户端 → 结束会话
EVENT_SESSION_FINISHED = 350  # 服务端 → 会话已结束
EVENT_FINISH_CONNECTION = 400  # 客户端 → 结束连接
EVENT_CONNECTION_FINISHED = 450  # 服务端 → 连接已结束

# 错误事件
EVENT_CONNECTION_FAILED = 51
EVENT_SESSION_FAILED = 151
EVENT_TTS_ERROR = 261


class VolcTTSClient:
    """火山云 TTS V3 双向流式客户端

    通过 WebSocket 连接火山引擎 TTS 服务，支持双向流式音频合成。
    连接流程: connect() → StartConnection → StartSession → synthesize() → close()
    """

    WS_URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"

    def __init__(self, app_id: str = "", token: str = ""):
        """初始化 TTS 客户端

        Args:
            app_id: 应用 ID（即 appId）
            token: 访问令牌（即 token）
        """
        self._app_id = app_id or settings.VOLC_TTS_APP_ID
        self._token = token or settings.VOLC_TTS_TOKEN
        self._ws = None
        self._connect_id = uuid.uuid4().hex

    async def connect(self) -> None:
        """建立 WebSocket 连接并完成初始化握手

        连接流程:
        1. 建立 WebSocket 连接（通过 headers 认证）
        2. 发送 StartConnection 消息
        3. 等待 ConnectionStarted 响应
        4. 发送 StartSession 消息
        5. 等待 SessionStarted 响应
        """
        headers = {
            "X-Api-App-Key": self._app_id,
            "X-Api-Access-Key": self._token,
            "X-Api-Resource-Id": "volc.service_type.10029",
            "X-Api-Connect-Id": self._connect_id,
        }

        logger.info("正在连接火山云 TTS 服务...")
        self._ws = await websockets.connect(
            self.WS_URL,
            additional_headers=headers,
            max_size=None,
            ping_interval=30,
            ping_timeout=10,
        )

        # 第一步: 发送 StartConnection
        start_conn_msg = {
            "event": EVENT_START_CONNECTION,
            "req_params": None,
        }
        await self._send_json(start_conn_msg)

        # 等待 ConnectionStarted
        resp = await self._recv_json()
        event = resp.get("event")
        if event == EVENT_CONNECTION_FAILED:
            error_msg = resp.get("payload", {}).get("message", "连接失败")
            raise RuntimeError(f"TTS 连接失败: {error_msg}")
        if event != EVENT_CONNECTION_STARTED:
            raise RuntimeError(f"TTS 未预期的响应事件: {event}")

        logger.info("TTS 连接已建立")

        # 第二步: 发送 StartSession
        start_sess_msg = {
            "event": EVENT_START_SESSION,
            "req_params": {
                "speaker": "BV700_V2_streaming",  # 默认音色，合成时会覆盖
                "audio_config": {
                    "format": "mp3",
                    "sample_rate": 24000,
                    "speed_ratio": 1.0,
                    "volume_ratio": 1.0,
                    "pitch_ratio": 1.0,
                },
                "emotion": "gentle",
            },
        }
        await self._send_json(start_sess_msg)

        # 等待 SessionStarted
        resp = await self._recv_json()
        event = resp.get("event")
        if event == EVENT_SESSION_FAILED:
            error_msg = resp.get("payload", {}).get("message", "会话建立失败")
            raise RuntimeError(f"TTS 会话建立失败: {error_msg}")
        if event != EVENT_SESSION_STARTED:
            raise RuntimeError(f"TTS 未预期的响应事件: {event}")

        logger.info("TTS 会话已建立")

    async def synthesize(
        self,
        text: str,
        speaker: str = "BV700_V2_streaming",
        speed: float = 1.0,
        pitch: float = 1.0,
        emotion: str = "gentle",
    ) -> None:
        """请求合成一段文本的语音

        注意: 此方法发送合成请求，实际音频数据需要通过 recv_audio() 接收。
        本实现使用 TaskRequest 事件发送合成请求。

        Args:
            text: 要合成的文本
            speaker: 音色 ID
            speed: 语速比率（默认 1.0）
            pitch: 音调比率（默认 1.0）
            emotion: 情感风格（默认 gentle）
        """
        if self._ws is None:
            raise RuntimeError("TTS 连接未建立，请先调用 connect()")

        task_msg = {
            "event": EVENT_TASK_REQUEST,
            "req_params": {
                "speaker": speaker,
                "audio_config": {
                    "format": "mp3",
                    "sample_rate": 24000,
                    "speed_ratio": speed,
                    "volume_ratio": 1.0,
                    "pitch_ratio": pitch,
                },
                "emotion": emotion,
            },
            "payload": {
                "text": text,
            },
        }

        await self._send_json(task_msg)
        logger.debug("TTS 合成请求已发送: %s", text[:50])

    async def recv_audio(self) -> AsyncGenerator[bytes, None]:
        """接收合成的音频数据

        持续接收服务端返回的消息，提取 MP3 音频帧并 yield。
        当收到句子结束标记时停止当前句子的接收。

        Yields:
            bytes: MP3 音频数据块
        """
        if self._ws is None:
            raise RuntimeError("TTS 连接未建立，请先调用 connect()")

        while True:
            try:
                message = await self._ws.recv()
            except websockets.exceptions.ConnectionClosed:
                logger.info("TTS 连接已关闭")
                break

            if isinstance(message, bytes):
                # 二进制帧: 4 字节 header + payload
                if len(message) <= 4:
                    continue

                header = message[:4]
                payload = message[4:]

                msg_type = header[0]
                flags = header[1]

                # flags & 0x01 表示 payload 是二进制（音频数据）
                if flags & 0x01 and msg_type == 0x0B:
                    # 音频数据帧
                    yield payload
                else:
                    # 可能是 JSON 控制消息，尝试解析
                    try:
                        json_data = json.loads(payload.decode("utf-8"))
                        event = json_data.get("event")

                        if event == EVENT_TTS_SENTENCE_END:
                            logger.debug("TTS 句子合成完成")
                            break
                        elif event in (EVENT_TTS_ERROR, EVENT_SESSION_FAILED):
                            error_msg = json_data.get("payload", {}).get(
                                "message", "TTS 合成错误"
                            )
                            logger.error("TTS 错误: %s", error_msg)
                            break
                        elif event == EVENT_SESSION_FINISHED:
                            logger.info("TTS 会话已结束")
                            break
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        # 纯二进制音频数据
                        yield payload
            else:
                # 文本帧: JSON 控制消息
                try:
                    json_data = json.loads(message)
                except json.JSONDecodeError:
                    continue

                event = json_data.get("event")

                if event == EVENT_TTS_SENTENCE_START:
                    logger.debug("TTS 句子合成开始")
                elif event == EVENT_TTS_SENTENCE_END:
                    logger.debug("TTS 句子合成完成")
                    break
                elif event in (EVENT_TTS_ERROR, EVENT_SESSION_FAILED):
                    error_msg = json_data.get("payload", {}).get(
                        "message", "TTS 合成错误"
                    )
                    logger.error("TTS 错误: %s", error_msg)
                    break
                elif event == EVENT_SESSION_FINISHED:
                    logger.info("TTS 会话已结束")
                    break

    async def close(self) -> None:
        """关闭 TTS 连接

        发送 FinishSession 消息，等待 SessionFinished 响应，然后关闭 WebSocket。
        """
        if self._ws is None:
            return

        try:
            # 发送结束会话消息
            finish_msg = {"event": EVENT_FINISH_SESSION}
            await self._send_json(finish_msg)

            # 等待会话结束确认（超时不阻塞）
            try:
                resp = await asyncio.wait_for(self._recv_json(), timeout=5.0)
                logger.info("TTS 会话正常结束")
            except (asyncio.TimeoutError, Exception):
                logger.warning("TTS 会话结束超时，直接关闭连接")

        except Exception as e:
            logger.warning("关闭 TTS 会话时出错: %s", e)
        finally:
            await self._ws.close()
            self._ws = None
            logger.info("TTS 连接已关闭")

    async def _send_json(self, data: dict) -> None:
        """发送 JSON 控制消息（带 4 字节 header）"""
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        header = struct.pack(">BBH", MSG_TYPE_FULL_REQUEST, 0x01, 0)
        await self._ws.send(header + payload)

    async def _recv_json(self) -> dict:
        """接收一条 JSON 控制消息"""
        message = await self._ws.recv()
        if isinstance(message, bytes):
            # 跳过 4 字节 header
            text = message[4:].decode("utf-8")
        else:
            text = message
        return json.loads(text)

