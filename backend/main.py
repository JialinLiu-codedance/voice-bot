"""FastAPI 应用入口

初始化 FastAPI 应用，配置 CORS、挂载路由、启动 uvicorn 服务。
"""

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from models.roles import list_roles
from routers.ws import router as ws_router

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# 创建 FastAPI 应用实例
app = FastAPI(
    title="Voice Bot",
    description="语音对话机器人后端服务",
    version="1.0.0",
)

# 配置 CORS 跨域中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载 WebSocket 路由
app.include_router(ws_router)


@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {"status": "ok"}


@app.get("/roles")
async def get_roles():
    """获取所有可用角色列表"""
    roles = list_roles()
    return [
        {
            "id": role.id,
            "name": role.name,
            "description": role.description,
            "avatar": role.avatar,
        }
        for role in roles
    ]


if __name__ == "__main__":
    logger.info(
        "启动 Voice Bot 服务: %s:%d",
        settings.SERVER_HOST,
        settings.SERVER_PORT,
    )
    uvicorn.run(
        "backend.main:app",
        host=settings.SERVER_HOST,
        port=settings.SERVER_PORT,
        reload=True,
        log_level="info",
    )
