"""火山云 ASR V3 流式识别客户端

使用火山引擎语音服务 V3 版本的二进制 WebSocket 协议进行流式语音识别。
协议格式: 4字节 header [message_type(1B)][flags(1B)][serial(2B BE)] + payload
"""

import json
import logging
import struct
import uuid

import websockets

from config import settings

logger = logging.getLogger(__name__)

# 二进制协议消息类型
MSG_TYPE_FULL_REQUEST = 0x01  # 完整请求（JSON 配置）
MSG_TYPE_AUDIO_ONLY = 0x09  # 仅音频数据
MSG_TYPE_LAST_AUDIO = 0x0F  # 最后一帧音频


class VolcASRClient:
    """火山云 ASR V3 流式识别客户端

    通过 WebSocket 连接火山引擎语音服务，发送 PCM 音频数据并接收识别结果。
    音频格式要求: PCM 16kHz 16bit mono
    """

    WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"

    def __init__(self):
        self._ws = None
        self._request_id = uuid.uuid4().hex

    async def connect(self) -> None:
        """建立 WebSocket 连接并发送初始配置

        连接火山云 ASR 服务，通过 HTTP headers 完成认证，
        连接成功后发送 JSON 格式的识别配置。
        """
        # 构建认证 headers
        headers = {
            "X-Api-Resource-Id": "volc.bigasr.sauc.duration",
            "X-Api-Access-Key": settings.VOLC_ASR_ACCESS_KEY,
            "X-Api-App-Key": settings.VOLC_ASR_APP_KEY,
            "X-Api-Request-Id": self._request_id,
        }

        logger.info("正在连接火山云 ASR 服务...")
        self._ws = await websockets.connect(
            self.WS_URL,
            additional_headers=headers,
            max_size=None,  # 不限制消息大小
            ping_interval=30,  # 每 30 秒发送心跳
            ping_timeout=10,
        )

        # 发送初始配置（JSON 格式）
        config = {
            "user": {"uid": self._request_id},
            "audio": {
                "format": "pcm",
                "codec": "raw",
                "rate": 16000,
                "bits": 16,
                "channel": 1,
            },
            "request": {
                "reqid": self._request_id,
                "sequence": 1,
                "nbest": 1,
                "show_utterances": True,
                "result_type": "single",
            },
        }
        payload = json.dumps(config).encode("utf-8")
        header = self._build_header(MSG_TYPE_FULL_REQUEST, flags=0x01)
        await self._ws.send(header + payload)
        logger.info("ASR 连接已建立，配置已发送")

    async def send_audio(self, data: bytes, is_last: bool = False) -> None:
        """发送音频数据

        Args:
            data: PCM 音频原始字节（16kHz 16bit mono）
            is_last: 是否为最后一帧音频，为 True 时发送结束标记
        """
        if self._ws is None:
            raise RuntimeError("ASR 连接未建立，请先调用 connect()")

        msg_type = MSG_TYPE_LAST_AUDIO if is_last else MSG_TYPE_AUDIO_ONLY
        header = self._build_header(msg_type, flags=0x01)
        await self._ws.send(header + data)

        if is_last:
            logger.debug("已发送最后一帧音频")

    async def recv_transcription(self) -> str:
        """接收识别结果

        持续接收服务端返回的识别文本，直到收到最终结果。
        服务端响应为文本帧（JSON 字符串），payload.result 数组中包含识别结果。

        Returns:
            完整的识别文本
        """
        if self._ws is None:
            raise RuntimeError("ASR 连接未建立，请先调用 connect()")

        full_text = ""

        try:
            async for message in self._ws:
                # 服务端返回的是文本帧（JSON 字符串）
                if isinstance(message, bytes):
                    # 如果是二进制帧，跳过 4 字节 header 后解析
                    text = message[4:].decode("utf-8")
                else:
                    text = message

                try:
                    resp = json.loads(text)
                except json.JSONDecodeError:
                    logger.warning("ASR 返回非 JSON 数据: %s", text[:200])
                    continue

                # 从 payload.result 数组中提取识别文本
                payload = resp.get("payload", {})
                result_list = payload.get("result", [])

                for item in result_list:
                    text_content = item.get("text", "")
                    if text_content:
                        full_text += text_content
                        logger.debug("ASR 中间结果: %s", text_content)

                # 检查是否为最终结果
                is_final = payload.get("is_final", False)
                if is_final:
                    logger.info("ASR 最终识别结果: %s", full_text)
                    break

        except websockets.exceptions.ConnectionClosed as e:
            logger.warning("ASR 连接已关闭: code=%s, reason=%s", e.code, e.reason)

        return full_text

    async def close(self) -> None:
        """关闭 ASR 连接"""
        if self._ws is not None:
            await self._ws.close()
            self._ws = None
            logger.info("ASR 连接已关闭")

    @staticmethod
    def _build_header(message_type: int, flags: int = 0x01, serial: int = 0) -> bytes:
        """构建二进制协议 4 字节 header

        格式: [message_type(1B)][flags(1B)][serial_number(2B, 大端序)]

        Args:
            message_type: 消息类型（0x01/0x09/0x0F）
            flags: 标志位（0x01 表示后续有 payload）
            serial: 序列号

        Returns:
            4 字节的 header
        """
        return struct.pack(">BBH", message_type, flags, serial)
