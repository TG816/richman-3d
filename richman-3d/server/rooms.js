import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { AVATARS } from './game/constants.js';
import { GameEngine } from './game/engine.js';

const SAVE_DIR = fileURLToPath(new URL('../saves/', import.meta.url));

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 断线后保留席位的宽限期（毫秒）：客户端在此窗口内重连即可恢复，超过才移除/破产
const DISCONNECT_GRACE_MS = 60_000;

function makeCode(existing, saved) {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < config.CODE_LEN; j++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!existing.has(c) && !saved.has(c)) return c;
  }
  return null;
}

/**
 * 房间管理器：联机、开局、回合计时、事件分发。
 * 与传输层解耦 —— 对外只暴露 handle(socket, event, payload) 与 emitTo(roomCode, event, data)，
 * 将来搬到独立进程/服务器时把这两处换成 Redis/消息服务即可（预留接口）。
 */
export class RoomManager {
  constructor(io, saveDir = SAVE_DIR) {
    this.io = io;
    this.rooms = new Map(); // code -> room
    this.saveDir = saveDir;
  }

  /* ---------- 生命周期 ---------- */

  newRoom(code) {
    const room = {
      code,
      createdAt: Date.now(),
      players: [],           // [{sid,id,name,avatarId}]
      engine: null,
      started: false,
      timer: null,
      turnDeadline: null,
      vote: null,            // 结束对局投票 {id,by,byName,mode,deadline,votes,total}
      voteTimer: null,
      fromSave: false,
      savedSeats: null,      // 存档恢复时的席位
      chat: [],              // 最近聊天记录（新人进房补发）
      broadcast: (event, data) => this.io.to(code).emit(event, { __room: code, ...data }),
    };
    this.rooms.set(code, room);
    return room;
  }

  createRoom(host) {
    const savedCodes = new Set(this.listSaves().map((save) => save.code));
    const code = makeCode(this.rooms, savedCodes);
    const room = this.newRoom(code);
    this.joinRoom(code, host);
    return room;
  }

  joinRoom(code, player) {
    const room = this.rooms.get(code);
    if (!room) return { error: '房间不存在或已解散' };
    if (room.players.length >= config.MAX_PLAYERS) return { error: '房间已满' };
    if (room.started) return { error: '对局已开始，无法加入' };
    const used = new Set(room.players.map((p) => p.avatarId));
    const avatar = AVATARS.find((a) => a.id === player.avatarId && !used.has(a.id))
      || AVATARS.find((a) => !used.has(a.id));
    room.players.push({
      sid: player.sid,
      id: player.id || randomUUID(),
      name: player.name?.trim().slice(0, 12) || '玩家',
      avatarId: avatar.id,
    });
    return { room };
  }

  /** 主动离开：立即移除席位（区别于掉线宽限） */
  removePlayer(code, sid) {
    const room = this.rooms.get(code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.sid === sid);
    if (idx === -1) return;
    const [p] = room.players.splice(idx, 1);
    if (room.engine && room.started) {
      const gp = room.engine.players.find((x) => x.id === p.id);
      if (gp && !gp.bankrupt && room.engine.phase !== 'gameover') {
        room.engine.bankruptPlayer(gp, null);
        room.broadcast('game:events', { events: room.engine.drainEvents() });
        room.broadcast('game:state', { state: room.engine.snapshot() });
      }
    }
    if (room.players.length === 0) return this.destroyRoom(code);
    this.reconcileVote(room);
    room.broadcast('room:state', this.roomState(room));
  }

  /** 掉线：保留席位 60 秒等待重连，期间对局照常由超时器托管 */
  leaveRoom(code, sid) {
    const room = this.rooms.get(code);
    if (!room) return;
    const p = room.players.find((x) => x.sid === sid);
    if (!p || p.disconnected) return;
    p.disconnected = true;
    p.sid = null;
    p.discAt = Date.now();
    if (room.players.every((x) => x.disconnected)) return this.destroyRoom(code);
    this.reconcileVote(room);
    room.broadcast('room:state', this.roomState(room));
    this.broadcastChat(room, { system: true, text: `${p.name} 掉线了，60 秒内可重连…` });
    clearTimeout(room.sweepTimer);
    room.sweepTimer = setTimeout(() => this.sweepDisconnected(code), DISCONNECT_GRACE_MS);
  }

  /** 宽限期结束：仍未重连则正式移除（对局中按破产处理） */
  sweepDisconnected(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    const gone = room.players.filter((p) => p.disconnected);
    room.players = room.players.filter((p) => !p.disconnected);
    for (const p of gone) {
      if (room.engine && room.started) {
        const gp = room.engine.players.find((x) => x.id === p.id);
        if (gp && !gp.bankrupt && room.engine.phase !== 'gameover') {
          room.engine.bankruptPlayer(gp, null);
        }
        this.reconcileVote(room);
      }
    }
    if (room.engine && room.started) {
      room.broadcast('game:events', { events: room.engine.drainEvents() });
      room.broadcast('game:state', { state: room.engine.snapshot() });
      if (room.engine.phase !== 'gameover') this.armTurnTimer(room);
    }
    if (room.players.length === 0) return this.destroyRoom(code);
    room.broadcast('room:state', this.roomState(room));
  }

  /** 重连：按持久化的 playerId 找回席位 */
  rejoin(code, playerId, sid) {
    const room = this.rooms.get(code);
    if (!room) return { error: '房间不存在或已解散' };
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return { error: '你已不在该房间中' };
    p.sid = sid;
    p.disconnected = false;
    clearTimeout(room.sweepTimer);
    room.broadcast('room:state', this.roomState(room));
    this.broadcastChat(room, { system: true, text: `${p.name} 重新连接了` });
    return { room };
  }

  broadcastChat(room, msg) {
    const m = { id: randomUUID().slice(0, 8), ts: Date.now(), name: '系统', avatarId: 'sys', ...msg };
    room.chat.push(m);
    if (room.chat.length > 200) room.chat.shift();
    room.broadcast('chat:msg', m);
  }

  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);
    if (room.sweepTimer) clearTimeout(room.sweepTimer);
    if (room.voteTimer) clearTimeout(room.voteTimer);
    this.rooms.delete(code);
  }

  /* ---------- 结束对局投票（全员同意 → 保存存档或直接退出） ---------- */

  connectedCount(room) {
    return room.players.filter((p) => !p.disconnected).length;
  }

  requestVote(room, sid, mode) {
    if (!room.started || !room.engine) return { error: '对局未开始' };
    if (room.engine.phase === 'gameover') return { error: '对局已结束' };
    if (room.vote) return { error: '已有进行中的投票' };
    if (mode !== 'save' && mode !== 'quit') return { error: '结束方式无效' };
    const p = room.players.find((x) => x.sid === sid);
    if (!p) return { error: 'not in room' };
    if (this.connectedCount(room) < 2) return { error: '没有其他玩家可投票' };
    const vote = {
      id: randomUUID().slice(0, 8),
      by: p.id, byName: p.name,
      mode,
      deadline: Date.now() + 30_000,
      votes: { [p.id]: true },
      total: this.connectedCount(room),
      done: false,
    };
    room.vote = vote;
    room.broadcast('game:vote', { vote: { ...vote, votes: { ...vote.votes } } });
    room.voteTimer = setTimeout(() => this.expireVote(room), 30_000);
    return { ok: true };
  }

  castVote(room, sid, agree) {
    const vote = room.vote;
    if (!vote || vote.done) return { error: '当前没有进行中的投票' };
    const p = room.players.find((x) => x.sid === sid);
    if (!p) return { error: '你不在该房间中' };
    if (p.id === vote.by) return { error: '发起者已自动同意，无需再次投票' };
    if (p.id in vote.votes) return { error: '你已经投过票了' };
    vote.votes[p.id] = !!agree;
    if (!agree) {
      this.resolveVote(room);
      return { ok: true };
    }
    // 全部在线玩家都已表态同意 → 通过
    const pending = room.players.filter((x) => !x.disconnected && !(x.id in vote.votes));
    vote.total = Math.max(vote.total, this.connectedCount(room));
    if (pending.length === 0) this.resolveVote(room);
    else room.broadcast('game:vote', { vote: { ...vote, votes: { ...vote.votes } } });
    return { ok: true };
  }

  reconcileVote(room) {
    const vote = room.vote;
    if (!vote || vote.done) return;
    const connected = room.players.filter((p) => !p.disconnected);
    vote.total = Math.max(connected.length, Object.keys(vote.votes).length);
    if (connected.length && connected.every((p) => vote.votes[p.id] === true)) this.resolveVote(room);
    else room.broadcast('game:vote', { vote: { ...vote, votes: { ...vote.votes } } });
  }

  cancelVote(room, sid) {
    const vote = room.vote;
    if (!vote || vote.done) return;
    const p = room.players.find((x) => x.sid === sid);
    if (!p || p.id !== vote.by) return;
    clearTimeout(room.voteTimer);
    room.vote = null;
    room.broadcast('game:vote', { vote: { ...vote, done: true, passed: false, cancelled: true } });
  }

  expireVote(room) {
    const vote = room.vote;
    if (!vote || vote.done) return;
    clearTimeout(room.voteTimer);
    room.vote = null;
    room.broadcast('game:vote', { vote: { ...vote, done: true, passed: false, expired: true } });
  }

  resolveVote(room) {
    const vote = room.vote;
    if (!vote || vote.done) return;
    clearTimeout(room.voteTimer);
    if (room.engine?.phase === 'gameover') {
      vote.done = true;
      vote.passed = false;
      vote.gameEnded = true;
      room.vote = null;
      room.broadcast('game:vote', { vote: { ...vote } });
      return;
    }
    const passed = Object.values(vote.votes).every(Boolean);
    vote.done = true;
    vote.passed = passed;
    room.vote = null;
    if (!passed) {
      room.broadcast('game:vote', { vote: { ...vote } });
      return;
    }
    if (vote.mode === 'save') {
      const saved = this.saveGame(room);
      if (!saved) {
        room.broadcast('game:vote', { vote: { ...vote, passed: false, saveFailed: true } });
        return;
      }
      room.broadcast('game:vote', { vote: { ...vote, savedCode: saved.code } });
      room.broadcast('room:closed', { reason: 'saved', code: saved.code });
    } else {
      room.broadcast('game:vote', { vote: { ...vote } });
      room.broadcast('room:closed', { reason: 'quit' });
    }
    this.destroyRoom(room.code);
  }

  /* ---------- 存档（保存 / 列表 / 恢复） ---------- */

  saveGame(room) {
    try {
      fs.mkdirSync(this.saveDir, { recursive: true });
      const data = { code: room.code, savedAt: Date.now(), snapshot: room.engine.snapshot() };
      const file = path.join(this.saveDir, `${room.code}.json`);
      const temp = path.join(this.saveDir, `.${room.code}-${randomUUID()}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(data), { flag: 'wx' });
      fs.renameSync(temp, file);
      return { code: room.code, savedAt: data.savedAt };
    } catch (err) {
      console.error('[save] failed:', err);
      return null;
    }
  }

  listSaves() {
    try {
      if (!fs.existsSync(this.saveDir)) return [];
      return fs.readdirSync(this.saveDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const d = JSON.parse(fs.readFileSync(path.join(this.saveDir, f), 'utf8'));
            return {
              code: d.code,
              savedAt: d.savedAt,
              round: d.snapshot ? d.snapshot.round : null,
              players: d.snapshot && d.snapshot.players
                ? d.snapshot.players.map((p) => ({ name: p.name, avatarId: p.avatarId, bankrupt: p.bankrupt }))
                : [],
            };
          } catch (err) {
            console.error(`[save] unable to read ${f}:`, err);
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch (err) {
      console.error('[save] unable to list saves:', err);
      return [];
    }
  }

  loadSave(code) {
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(this.saveDir, `${code}.json`), 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.error(`[save] unable to load ${code}:`, err);
      return null;
    }
  }

  /** 用存档重建房间（幂等：已重建过则直接返回该房间） */
  resumeRoom(code) {
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(code)) return { error: '存档码格式错误' };
    const existing = this.rooms.get(code);
    if (existing) {
      if (existing.fromSave) return { room: existing };
      return { error: '该房间码正在对局中' };
    }
    const data = this.loadSave(code);
    if (!data || data.code !== code || !data.snapshot || !Array.isArray(data.snapshot.players)) {
      return { error: '存档不存在或已损坏' };
    }
    try {
      const room = this.newRoom(code);
      room.started = true;
      room.fromSave = true;
      room.engine = GameEngine.fromSnapshot(data.snapshot);
      room.savedSeats = data.snapshot.players.map((p) => ({
        id: p.id, name: p.name, avatarId: p.avatarId, bankrupt: p.bankrupt, claimed: !!p.bankrupt,
      }));
      return { room };
    } catch (err) {
      this.rooms.delete(code);
      console.error(`[save] unable to restore ${code}:`, err);
      return { error: '存档数据无效，无法恢复' };
    }
  }

  /** 认领存档席位：优先按原 playerId，其次按空位顺序 */
  resumeJoin(code, opts) {
    const playerId = opts.playerId;
    const sid = opts.sid;
    const room = this.rooms.get(code);
    if (!room || !room.fromSave) return { error: '存档不存在' };
    if (room.players.some((p) => p.sid === sid)) return { error: '你已在对局中' };
    let seat = null;
    if (playerId) {
      seat = room.savedSeats.find((x) => x.id === playerId);
      if (seat?.claimed) return { error: '该存档席位已被认领' };
    }
    if (!seat) seat = room.savedSeats.find((x) => !x.claimed && !x.bankrupt);
    if (!seat) return { error: '存档席位已满' };
    seat.claimed = true;
    room.players.push({ sid, id: seat.id, name: seat.name, avatarId: seat.avatarId });
    room.broadcast('room:state', this.roomState(room));
    if (room.savedSeats.filter((x) => !x.bankrupt).every((x) => x.claimed) && !room.timer
      && room.engine.phase !== 'gameover') this.armTurnTimer(room);
    return { room, me: room.players[room.players.length - 1] };
  }

  roomState(room) {
    return {
      code: room.code,
      started: room.started,
      players: room.players.map((p) => ({
        id: p.id, name: p.name, avatarId: p.avatarId, disconnected: !!p.disconnected,
      })),
      hostSid: room.players[0]?.sid ?? null,
      maxPlayers: config.MAX_PLAYERS,
      resumeWaiting: !!room.fromSave && room.savedSeats.some((seat) => !seat.bankrupt && !seat.claimed),
    };
  }

  /* ---------- 对局 ---------- */

  startGame(room) {
    const online = room.players.filter((p) => !p.disconnected);
    if (room.started || online.length < 2) return false;
    room.started = true;
    room.engine = new GameEngine(online.map((p) => ({
      id: p.id, name: p.name, avatarId: p.avatarId,
      color: AVATARS.find((a) => a.id === p.avatarId)?.color || '#e2504a',
    })));
    room.broadcast('game:events', { events: room.engine.drainEvents() });
    room.broadcast('game:state', { state: room.engine.snapshot() });
    this.armTurnTimer(room);
    return true;
  }

  /** 玩家动作入口：校验 → 引擎执行 → 广播事件与状态 */
  action(room, sid, action, payload = {}) {
    const engine = room.engine;
    if (!engine || engine.phase === 'gameover') return;
    const player = room.players.find((p) => p.sid === sid);
    if (!player) return;
    const pid = player.id;

    const before = engine.phase;
    switch (action) {
      case 'roll': if (engine.can(pid, 'roll')) engine.roll(); break;
      case 'buy': if (engine.can(pid, 'buy')) engine.buy(); break;
      case 'decline': if (engine.can(pid, 'decline')) engine.decline(); break;
      case 'build': engine.can(pid, 'build') && engine.build(pid, payload.tile); break;
      case 'sellHouse': engine.can(pid, 'sellHouse') && engine.sellHouse(pid, payload.tile); break;
      case 'mortgage': engine.can(pid, 'mortgage') && engine.mortgage(pid, payload.tile); break;
      case 'unmortgage': engine.can(pid, 'unmortgage') && engine.unmortgage(pid, payload.tile); break;
      case 'payJail': engine.can(pid, 'payJail') && engine.payJail(); break;
      case 'useCard': engine.can(pid, 'useCard') && engine.useCard(); break;
      case 'endTurn': if (engine.can(pid, 'endTurn')) engine.endTurn(); break;
      default: return;
    }
    const changed = engine.phase !== before || engine.events.length > 0;
    if (!changed) return;

    room.broadcast('game:events', { events: engine.drainEvents() });
    room.broadcast('game:state', { state: engine.snapshot() });
    if (engine.phase === 'gameover') {
      if (room.timer) clearTimeout(room.timer);
    } else {
      this.armTurnTimer(room);
    }
  }

  /** 回合超时自动行动（挂机保护），保证对局永不卡死 */
  armTurnTimer(room) {
    if (room.timer) clearTimeout(room.timer);
    const seconds = config.TURN_SECONDS;
    room.turnDeadline = Date.now() + seconds * 1000;
    room.broadcast('game:timer', { deadline: room.turnDeadline, seconds });
    room.timer = setTimeout(() => {
      const engine = room.engine;
      if (!engine || engine.phase === 'gameover') return;
      const current = room.players.find((p) => p.id === engine.players[engine.turn]?.id);
      if (!current) return;
      try {
        if (engine.phase === 'buy') engine.decline();
        else if (engine.phase === 'end') engine.endTurn();
        else if (engine.phase === 'roll') engine.roll();
        room.broadcast('game:events', { events: engine.drainEvents() });
        room.broadcast('game:state', { state: engine.snapshot() });
        if (engine.phase !== 'gameover') this.armTurnTimer(room);
      } catch (err) {
        console.error('[timer] auto-act failed:', err);
      }
    }, seconds * 1000);
  }
}
