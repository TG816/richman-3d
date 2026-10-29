import { io } from 'socket.io-client';
import { NET } from './config.js';

export const socket = io(NET.serverUrl || undefined, {
  autoConnect: false,
  reconnection: true,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
});

/** 带确认的请求（服务端 ack 回包 {ok, ...} / {ok:false, error}） */
export function emitAck(event, payload = {}) {
  return new Promise((resolve) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) return resolve({ ok: false, error: '网络超时，请重试' });
      resolve(res || { ok: false, error: '无响应' });
    });
  });
}

export const on = (event, fn) => socket.on(event, fn);
export const off = (event, fn) => socket.off(event, fn);
