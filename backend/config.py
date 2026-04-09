"""环境变量配置"""

import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ASR
    VOLC_ASR_ACCESS_KEY: str = os.getenv("VOLC_ASR_ACCESS_KEY", "")
    VOLC_ASR_APP_KEY: str = os.getenv("VOLC_ASR_APP_KEY", "")

    # TTS
    VOLC_TTS_APP_ID: str = os.getenv("VOLC_TTS_APP_ID", "")
    VOLC_TTS_TOKEN: str = os.getenv("VOLC_TTS_TOKEN", "")

    # LLM
    VOLC_ARK_API_KEY: str = os.getenv("VOLC_ARK_API_KEY", "")
    VOLC_ARK_ENDPOINT_ID: str = os.getenv("VOLC_ARK_ENDPOINT_ID", "")

    # 服务
    SERVER_HOST: str = os.getenv("SERVER_HOST", "0.0.0.0")
    SERVER_PORT: int = int(os.getenv("SERVER_PORT", "8000"))
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")


settings = Settings()
