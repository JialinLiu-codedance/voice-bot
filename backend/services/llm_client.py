"""火山方舟 LLM 客户端

基于 OpenAI SDK 兼容接口，连接火山方舟大模型推理服务。
使用流式输出，按句子粒度 yield 给调用方。
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncGenerator
from typing import Dict, List

from openai import AsyncOpenAI

from config import settings

logger = logging.getLogger(__name__)

# 中文句子终止标点，遇到这些立即 yield
SENTENCE_END_PATTERN = re.compile(r"[。？！\.\?!]")
# 中文逗号，超过 20 字时遇到逗号也可以切分
COMMA_PATTERN = re.compile(r"[，,]")
# 最大缓冲长度，超过此长度无标点则强制切分
MAX_BUFFER_LEN = 50


class VolcLLMClient:
    """火山方舟 LLM 客户端

    通过 OpenAI SDK 兼容的接口连接火山方舟，支持流式输出。
    流式结果按句子粒度切分后 yield，方便下游 TTS 逐句合成。
    """

    def __init__(self, api_key: str, endpoint_id: str, system_prompt: str):
        """初始化 LLM 客户端

        Args:
            api_key: 火山方舟 API Key
            endpoint_id: 推理接入点 ID（格式: ep-xxxx）
            system_prompt: 系统提示词，定义角色人设
        """
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://ark.cn-beijing.volces.com/api/v3",
        )
        self._endpoint_id = endpoint_id
        self._system_prompt = system_prompt

    async def chat_stream(
        self, user_text: str, history: list[dict]
    ) -> AsyncGenerator[str, None]:
        """流式对话，按句子粒度 yield

        将用户文本和历史对话发送给 LLM，流式接收回复。
        遇到句子终止标点时立即 yield 该句子，保证 TTS 可以尽快开始合成。

        句子分割策略:
        - 遇到 。？！ 等终止标点 → 立即 yield
        - 遇到 ，且缓冲区超过 20 字 → yield
        - 缓冲区超过 50 字无标点 → 强制 yield

        Args:
            user_text: 用户输入的文本
            history: 对话历史，格式 [{"role": "user/assistant", "content": "..."}]

        Yields:
            str: 一个完整的句子
        """
        # 组装消息列表
        messages = [{"role": "system", "content": self._system_prompt}]
        messages.extend(history)
        messages.append({"role": "user", "content": user_text})

        logger.info("LLM 请求发送，用户文本: %s", user_text[:100])

        try:
            response = await self._client.chat.completions.create(
                model=self._endpoint_id,
                messages=messages,
                stream=True,
                temperature=0.7,
                max_tokens=1024,
            )

            buffer = ""  # 句子缓冲区

            async for chunk in response:
                # 提取增量文本
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if not delta.content:
                    continue

                buffer += delta.content

                # 尝试按句子切分
                while buffer:
                    sentence, remaining = self._split_sentence(buffer)
                    if sentence:
                        logger.debug("LLM yield 句子: %s", sentence)
                        yield sentence
                        buffer = remaining
                    else:
                        # 还没凑成一个完整句子，继续缓冲
                        break

            # 流结束，输出缓冲区剩余内容
            if buffer.strip():
                logger.debug("LLM yield 最后一段: %s", buffer)
                yield buffer

        except Exception as e:
            logger.error("LLM 调用失败: %s", e)
            raise

    @staticmethod
    def _split_sentence(buffer: str) -> tuple[str, str]:
        """从缓冲区中切分出一个句子

        按优先级尝试不同的切分规则:
        1. 遇到终止标点（。？！）→ 在标点后切分
        2. 遇到逗号且长度 > 20 → 在逗号后切分
        3. 长度 > 50 无标点 → 强制切分

        Args:
            buffer: 当前缓冲区文本

        Returns:
            (sentence, remaining) - 如果能切分则返回句子和剩余文本，
            否则返回 ("", buffer) 表示继续缓冲
        """
        # 规则 1: 遇到终止标点
        match = SENTENCE_END_PATTERN.search(buffer)
        if match:
            end_pos = match.end()
            return buffer[:end_pos], buffer[end_pos:]

        # 规则 2: 遇到逗号且超过 20 字
        if len(buffer) > 20:
            match = COMMA_PATTERN.search(buffer)
            if match:
                end_pos = match.end()
                return buffer[:end_pos], buffer[end_pos:]

        # 规则 3: 超过 50 字无标点，强制切分
        if len(buffer) > MAX_BUFFER_LEN:
            # 从后往前找一个合适的切分点
            return buffer, ""

        # 还不够切分
        return "", buffer
