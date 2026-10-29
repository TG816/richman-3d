import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'socket.io';
import { config } from './config.js';
import { RoomManager } from './rooms.js';
import { AVATARS } from './game/constants.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: config.CORS_ORIGIN },
  maxHttpBufferSize: 1e6,
});

const rooms = new RoomManager(io);

/* ---------- REST API（预留：前后端分离部署时的健康检查/房间查询接口） ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), version: '1.0.0' });
});
app.get('/api/config', (_req, res) => {
  res.json({
    maxPlayers: config.MAX_PLAYERS,
    turnSeconds: config.TURN_SECONDS,
    roundLimit: config.ROUND_LIMIT,
    startMoney: config.START_MONEY,
    avatars: AVATARS,
  });
});
app.get('/api/rooms', (_req, res) => {
  res.json({
    rooms: [...rooms.rooms.values()]
      .filter((r) => !r.started)
      .map((r) => ({ code: r.code, players: r.players.length, maxPlayers: config.MAX_PLAYERS })),
  });
});

/* ---------- 生产模式：托管前端构建产物（前后端同域部署） ---------- */
if (config.SERVE_CLIENT) {
  const dist = config.CLIENT_DIST;
  const indexHtml = path.join(dist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(express.static(dist));
    app.get(/^\/(?!api|socket\.io).*/, (_req, res) => res.sendFile(indexHtml));
    console.log('[static] serving client/dist');
  }
}

/* ---------- Socket.IO 实时协议 ---------- */
io.on('connection', (socket) => {
  let roomCode = null;

  const bind = (code) => {
    socket.join(code);
    roomCode = code;
  };

  socket.on('room:create', ({ name, avatarId } = {}, ack) => {
    try {
      const room = rooms.createRoom({ sid: socket.id, name, avatarId });
      bind(room.code);
      ack?.({ ok: true, code: room.code, me: room.players.at(-1), room: rooms.roomState(room), chat: [] });
      console.log(`[room] ${room.code} created by ${name}`);
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on('room:join', ({ code, name, avatarId } = {}, ack) => {
    try {
      const res = rooms.joinRoom(String(code || '').toUpperCase(), { sid: socket.id, name, avatarId });
      if (res.error) return ack?.({ ok: false, error: res.error });
      bind(res.room.code);
      socket.to(res.room.code).emit('room:state', rooms.roomState(res.room));
      ack?.({ ok: true, code: res.room.code, me: res.room.players.at(-1), room: rooms.roomState(res.room), chat: res.room.chat });
      console.log(`[room] ${res.room.code} joined by ${name}`);
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on('room:state', (_payload, ack) => {
    const room = rooms.rooms.get(roomCode);
    if (!room) return ack?.({ ok: false, error: 'not in room' });
    ack?.({ ok: true, room: rooms.roomState(room), chat: room.chat, started: room.started });
  });

  socket.on('game:start', (_payload, ack) => {
    const room = rooms.rooms.get(roomCode);
    if (!room) return ack?.({ ok: false, error: 'not in room' });
    if (room.players[0]?.sid !== socket.id) return ack?.({ ok: false, error: '只有房主能开始对局' });
    if (room.players.length < 2) return ack?.({ ok: false, error: '至少需要 2 名玩家' });
    rooms.startGame(room);
    ack?.({ ok: true });
    console.log(`[game] ${room.code} started with ${room.players.length} players`);
  });

  socket.on('game:action', ({ action, ...payload } = {}) => {
    const room = rooms.rooms.get(roomCode);
    if (room?.started) rooms.action(room, socket.id, action, payload);
  });

  /* ---------- 文字聊天 ---------- */
  socket.on('chat:msg', ({ text } = {}) => {
    const room = rooms.rooms.get(roomCode);
    if (!room || !text?.trim()) return;
    const player = room.players.find((p) => p.sid === socket.id);
    if (!player) return;
    const msg = {
      id: randomMsgId(),
      from: player.id,
      name: player.name,
      avatarId: player.avatarId,
      text: String(text).slice(0, 200),
      ts: Date.now(),
    };
    room.chat.push(msg);
    if (room.chat.length > 200) room.chat.shift();
    io.to(room.code).emit('chat:msg', msg);
  });

  /* ---------- 语音信令（WebRTC P2P，服务器只转发信令） ---------- */
  socket.on('voice:hello', () => {
    const room = rooms.rooms.get(roomCode);
    if (!room) return;
    socket.to(room.code).emit('voice:peer-joined', { peer: socket.id });
    socket.emit('voice:peers', { peers: room.players.filter((p) => p.sid !== socket.id).map((p) => p.sid) });
  });
  socket.on('voice:signal', ({ to, data } = {}) => {
    if (to) io.to(to).emit('voice:signal', { from: socket.id, data });
  });
  socket.on('voice:mute', ({ muted }) => {
    const room = rooms.rooms.get(roomCode);
    if (room) socket.to(room.code).emit('voice:mute', { peer: socket.id, muted: !!muted });
  });

  socket.on('room:rejoin', ({ code, playerId } = {}, ack) => {
    try {
      const res = rooms.rejoin(String(code || '').toUpperCase(), playerId, socket.id);
      if (res.error) return ack?.({ ok: false, error: res.error });
      bind(res.room.code);
      if (res.room.started && res.room.engine) {
        socket.emit('game:state', { state: res.room.engine.snapshot() });
        socket.emit('game:timer', { deadline: res.room.turnDeadline, seconds: config.TURN_SECONDS });
      }
      ack?.({ ok: true, me: res.room.players.find((p) => p.id === playerId), room: rooms.roomState(res.room), chat: res.room.chat });
    } catch (e) {
      ack?.({ ok: false, error: e.message });
    }
  });

  socket.on('room:leave', () => {
    if (roomCode) {
      rooms.removePlayer(roomCode, socket.id);
      socket.leave(roomCode);
      roomCode = null;
    }
  });

  socket.on('disconnect', () => {
    if (roomCode) rooms.leaveRoom(roomCode, socket.id);
  });
});

function randomMsgId() {
  return Math.random().toString(36).slice(2, 10);
}

server.listen(config.PORT, config.HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   大富翁 3D · Richman 3D  server up!      ║');
  console.log(`  ║   http://localhost:${String(config.PORT).padEnd(21)}║`);
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
