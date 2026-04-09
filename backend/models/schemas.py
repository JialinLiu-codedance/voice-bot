"""WebSocket 消息模型"""

from pydantic import BaseModel


class SessionConfig(BaseModel):
    """会话配置（角色 + 情绪参数）"""
    type: str = "config"
    role: str = "gentle_sister"
    emotion: str = "gentle"
    speed: float = 1.0
    pitch: float = 1.0


class AudioControl(BaseModel):
    """音频控制消息"""
    type: str  # audio_start | audio_end | interrupt


class Transcription(BaseModel):
    """ASR 识别结果"""
    type: str = "transcription"
    text: str
    is_final: bool = False


class ReplyText(BaseModel):
    """LLM 文本回复"""
    type: str = "reply_text"
    text: str
    is_final: bool = False


class StatusMessage(BaseModel):
    """状态消息"""
    type: str = "status"
    state: str  # listening | thinking | speaking


class ErrorMessage(BaseModel):
    """错误消息"""
    type: str = "error"
    message: str
