import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { AVATARS } from './game/constants.js';
import { GameEngine } from './game/engine.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(existing) {
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let j = 0; j < config.CODE_LEN; j++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!existing.has(c)) return c;
  }
  return null;
}

/**
 * 房间管理器：联机、开局、回合计时、事件分发。
 * 与传输层解耦 —— 对外只暴露 handle(socket, event, payload) 与 emitTo(roomCode, event, data)，
 * 将来搬到独立进程/服务器时把这两处换成 Redis/消息服务即可（预留接口）。
 */
export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // code -> room
  }

  /* ---------- 生命周期 ---------- */

  createRoom(host) {
    const code = makeCode(this.rooms);
    const room = {
      code,
      createdAt: Date.now(),
      players: [],           // [{sid,id,name,avatarId}]
      engine: null,
      started: false,
      timer: null,
      turnDeadline: null,
      chat: [],              // 最近聊天记录（新人进房补发）
      broadcast: (event, data) => this.io.to(code).emit(event, data),
    };
    this.rooms.set(code, room);
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

  leaveRoom(code, sid) {
    const room = this.rooms.get(code);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.sid === sid);
    if (idx === -1) return;
    const [p] = room.players.splice(idx, 1);
    if (room.started && room.engine) {
      // 对局中离开 = 破产出局
      const gp = room.engine.players.find((x) => x.id === p.id);
      if (gp && !gp.bankrupt && room.engine.phase !== 'gameover') {
        room.engine.bankruptPlayer(gp, null);
        room.broadcast('game:events', { events: room.engine.drainEvents() });
        room.broadcast('game:state', { state: room.engine.snapshot() });
      }
    }
    if (room.players.length === 0) {
      this.destroyRoom(code);
    } else {
      room.broadcast('room:state', this.roomState(room));
    }
  }

  destroyRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    if (room.timer) clearTimeout(room.timer);
    this.rooms.delete(code);
  }

  roomState(room) {
    return {
      code: room.code,
      started: room.started,
      players: room.players.map((p) => ({ id: p.id, name: p.name, avatarId: p.avatarId })),
      hostSid: room.players[0]?.sid ?? null,
      maxPlayers: config.MAX_PLAYERS,
    };
  }

  /* ---------- 对局 ---------- */

  startGame(room) {
    if (room.started || room.players.length < 2) return false;
    room.started = true;
    room.engine = new GameEngine(room.players.map((p) => ({
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
