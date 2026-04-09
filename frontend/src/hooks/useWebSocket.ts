import { useRef, useState, useCallback, useEffect } from 'react';
import type { ConnectionState } from '../types';

interface UseWebSocketOptions {
  /** 收到文本消息时的回调 */
  onMessage?: (data: string) => void;
  /** 收到二进制消息时的回调 */
  onBinaryMessage?: (data: ArrayBuffer) => void;
  /** 连接断开时的回调 */
  onDisconnect?: () => void;
}

/**
 * WebSocket 管理 Hook
 * 支持自动重连（指数退避）、心跳检测
 */
export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { onMessage, onBinaryMessage, onDisconnect } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);

  // 重连相关
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectDelay = 30_000; // 最大重连间隔 30 秒
  const urlRef = useRef<string>('');

  // 心跳相关
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatInterval = 30_000; // 每 30 秒发送一次 ping

  // 保存回调的最新引用，避免闭包问题
  const onMessageRef = useRef(onMessage);
  const onBinaryMessageRef = useRef(onBinaryMessage);
  const onDisconnectRef = useRef(onDisconnect);
  onMessageRef.current = onMessage;
  onBinaryMessageRef.current = onBinaryMessage;
  onDisconnectRef.current = onDisconnect;

  /** 清理心跳定时器 */
  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = null;
    }
  }, []);

  /** 启动心跳 */
  const startHeartbeat = useCallback(() => {
    clearHeartbeat();

    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // 发送 ping
        ws.send(JSON.stringify({ type: 'ping' }));

        // 如果 pong 没在 10 秒内收到，视为连接断开
        heartbeatTimeoutRef.current = setTimeout(() => {
          console.warn('[WebSocket] 心跳超时，关闭连接');
          ws.close();
        }, 10_000);
      }
    }, heartbeatInterval);
  }, [clearHeartbeat]);

  /** 计算重连延迟（指数退避 1s → 2s → 4s → ... → max 30s） */
  const getReconnectDelay = useCallback(() => {
    const baseDelay = 1000;
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttemptsRef.current), maxReconnectDelay);
    reconnectAttemptsRef.current += 1;
    return delay;
  }, []);

  /** 尝试重连 */
  const tryReconnect = useCallback(() => {
    if (!urlRef.current) return;

    const delay = getReconnectDelay();
    console.log(`[WebSocket] ${delay}ms 后尝试第 ${reconnectAttemptsRef.current} 次重连...`);

    reconnectTimerRef.current = setTimeout(() => {
      connect(urlRef.current);
    }, delay);
  }, [getReconnectDelay]);

  /** 建立 WebSocket 连接 */
  const connect = useCallback((url: string) => {
    // 保存 URL 用于重连
    urlRef.current = url;

    // 先断开已有连接
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // 清理重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    setConnectionState('connecting');

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] 已连接');
      setConnectionState('connected');
      reconnectAttemptsRef.current = 0;
      startHeartbeat();
    };

    ws.onmessage = (event: MessageEvent) => {
      // 收到任何消息都重置心跳超时
      if (heartbeatTimeoutRef.current) {
        clearTimeout(heartbeatTimeoutRef.current);
        heartbeatTimeoutRef.current = null;
      }

      if (typeof event.data === 'string') {
        // 忽略 pong 响应
        try {
          const parsed = JSON.parse(event.data as string);
          if (parsed.type === 'pong') return;
        } catch {
          // 非 JSON，正常处理
        }
        onMessageRef.current?.(event.data as string);
      } else if (event.data instanceof ArrayBuffer) {
        onBinaryMessageRef.current?.(event.data as ArrayBuffer);
      }
    };

    ws.onclose = (event) => {
      console.log(`[WebSocket] 连接关闭: code=${event.code}`);
      setConnectionState('disconnected');
      clearHeartbeat();

      // 非正常关闭则尝试重连
      if (event.code !== 1000 && urlRef.current) {
        tryReconnect();
      }

      onDisconnectRef.current?.();
    };

    ws.onerror = (event) => {
      console.error('[WebSocket] 错误:', event);
    };
  }, [startHeartbeat, clearHeartbeat, tryReconnect]);

  /** 主动断开连接 */
  const disconnect = useCallback(() => {
    // 清除重连 URL，阻止自动重连
    urlRef.current = '';

    // 清理定时器
    clearHeartbeat();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    reconnectAttemptsRef.current = 0;

    if (wsRef.current) {
      wsRef.current.close(1000, '主动断开');
      wsRef.current = null;
    }

    setConnectionState('disconnected');
  }, [clearHeartbeat]);

  /** 发送 JSON 消息 */
  const sendJson = useCallback((data: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    } else {
      console.warn('[WebSocket] 连接未就绪，无法发送消息');
    }
  }, []);

  /** 发送二进制数据 */
  const sendBinary = useCallback((data: ArrayBuffer | Int16Array) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data instanceof Int16Array ? data.buffer : data);
    } else {
      console.warn('[WebSocket] 连接未就绪，无法发送二进制数据');
    }
  }, []);

  // 组件卸载时断开连接
  useEffect(() => {
    return () => {
      urlRef.current = '';
      clearHeartbeat();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close(1000, '组件卸载');
      }
    };
  }, [clearHeartbeat]);

  return {
    connectionState,
    connect,
    disconnect,
    sendJson,
    sendBinary,
  };
}
