import * as THREE from 'three';
import { createScene } from './three/scene.js';
import { buildBoard, attachPicking, tileWorldPos, setTileOwner, setTileHouses, moveHighlight, pulseTile } from './three/board.js';
import { Tokens } from './three/tokens.js';
import { Dice } from './three/dice.js';
import { Effects } from './three/effects.js';
import { socket, on } from './net/socket.js';
import { store, emit, on as onBus, toast, playerById, currentPlayer } from './game/store.js';
import { initLobby, backToLobby } from './ui/lobby.js';
import { initHud, renderAll, announce, showCard, openDeed, gameOver } from './ui/hud.js';
import { initChat } from './ui/chat.js';
import { voice } from './net/voice.js';
import { sfx } from './audio/sfx.js';
window.__openDeed = openDeed; // 自动化测试句柄

/* ================= 3D 初始化 ================= */
const canvas = document.getElementById('gl');
const scene3 = createScene(canvas);
const board = buildBoard(scene3.scene);
const tokens = new Tokens(scene3.scene);
const dice = new Dice(scene3.scene);
const effects = new Effects(scene3.scene);
scene3.tickers.push((dt) => dice.update(dt));
scene3.tickers.push((dt) => effects.update(dt));
scene3.tickers.push((dt, t) => tokens.update(dt, t)); // 棋子动画（待机/跳跃）
scene3.setAutoRotate(true);

attachPicking(scene3.camera, canvas, board, (tileIndex) => {
  if (store.screen === 'game' && store.snap) openDeed(tileIndex);
});

/* ================= UI 初始化 ================= */
try {
  initLobby();
  initHud();
  initChat();
  voice.wire();
} catch (err) {
  console.error('[init]', err);
  window.__initError = (err?.stack || String(err));
}

/* 音频解锁（浏览器手势策略） */
let unlocked = false;
addEventListener('pointerdown', () => {
  if (!unlocked) { sfx.unlock(); unlocked = true; }
}, { once: false });

document.getElementById('btnSound').onclick = (e) => {
  store.soundOn = !store.soundOn;
  sfx.setEnabled(store.soundOn);
  e.currentTarget.textContent = store.soundOn ? '🔊' : '🔇';
  e.currentTarget.classList.toggle('off', !store.soundOn);
};
document.getElementById('btnMic').onclick = async (e) => {
  sfx.unlock();
  const onNow = await voice.toggleMic();
  e.currentTarget.textContent = onNow ? '🎙️' : '🔇';
  e.currentTarget.classList.toggle('on', onNow);
  e.currentTarget.classList.toggle('off', !onNow);
};

/* 换房间时清空旧房间残留（动画队列、弹窗、高亮） */
onBus('room-switch', () => {
  director.queue.length = 0;
  director.busy = false;
  director.ff = false;
  dice.hide();
  moveHighlight(board, -1);
  document.getElementById('overModal').classList.add('hidden');
  document.getElementById('deedModal').classList.add('hidden');
});

/* ================= Socket 事件 ================= */
socket.connect(); // autoConnect 关闭，这里显式建链

on('room:state', (room) => {
  if (room.__room !== store.room?.code) return; // 丢弃旧房间残留广播
  const wasStarted = store.room.started;
  store.room = room;
  emit('room', room);
  if (room.started && !wasStarted) enterGame();
});

on('game:state', (payload) => {
  if (payload.__room !== store.room?.code) return;
  const state = payload.state;
  store.snap = state;
  applyState(state);
  emit('state', state);
  if (store.screen === 'lobby') enterGame();
});

on('game:events', (payload) => {
  if (payload.__room !== store.room?.code) return;
  director.push(payload.events);
  emit('events', payload.events); // UI 层（公告等）订阅
});
on('game:timer', (t) => {
  if (t.__room !== store.room?.code) return;
  emit('timer', t);
});
on('chat:msg', (msg) => emit('chat', msg));

socket.on('connect', async () => {
  // 每次建链（含重连）都向服务器对齐房间状态：找回席位 / 补发漏掉的广播
  try {
    const sess = JSON.parse(sessionStorage.getItem('richman.session') || 'null')
      ?? (store.room ? { code: store.room.code, playerId: store.me?.id } : null);
    if (!sess?.code || !sess?.playerId) return;
    const { emitAck } = await import('./net/socket.js');
    const res = await emitAck('room:rejoin', sess);
    if (res.ok) {
      const wasInGame = store.screen === 'game';
      store.room = res.room;
      store.me = res.me;
      if (res.chat?.length && !store.chat.length) store.chat.push(...res.chat);
      emit('room', res.room); // 通知语音层进房
      if (!wasInGame) toast('已连接到房间 ' + res.room.code);
      if (res.room.started) {
        enterGame();
      } else {
        document.getElementById('lobbyForm').classList.add('hidden');
        document.getElementById('lobbyRoom').classList.remove('hidden');
        emit('room', res.room);
      }
    } else if (!store.room) {
      sessionStorage.removeItem('richman.session');
    }
  } catch { /* 忽略 */ }
});
socket.on('disconnect', () => {
  toast('与服务器的连接断开，请刷新重连', true);
});
socket.on('connect_error', () => {
  if (store.screen === 'lobby') {
    document.getElementById('lobbyError').textContent = '无法连接服务器，请确认服务端已启动 (npm run dev)';
  }
});

/* ================= 进入对局 ================= */
function enterGame() {
  store.screen = 'game';
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  scene3.setAutoRotate(false);
  const cur = currentPlayer();
  if (cur) scene3.focusOn(tileWorldPos(cur.pos, 0), true);
  renderAll();
  sfx.turn();
}

/* ================= 状态 → 3D ================= */
function applyState(state) {
  tokens.syncPlayers(state.players);
  for (const p of state.players) tokens.updateMoney(p);
  for (let i = 0; i < 40; i++) {
    const info = state.props[i];
    if (info) {
      const owner = state.players.find((p) => p.id === info.owner);
      setTileOwner(board, i, info.mortgaged ? '#5a6078' : owner?.color);
      setTileHouses(board, i, info.houses);
    } else {
      setTileOwner(board, i, null);
      setTileHouses(board, i, 0);
    }
  }
  if (state.phase === 'gameover') {
    moveHighlight(board, -1);
    if (state.winner && document.getElementById('overModal').classList.contains('hidden')) {
      gameOver(state.ranking || [], state.winner);
    }
  } else {
    const cur = state.players[state.turn];
    moveHighlight(board, cur?.pos ?? -1);
  }
  if (!director.busy) {
    snapTokens(state);
    renderAll();
  } // 忙碌时延迟到动画队列结束再刷新（见 Director.run）
}

function snapTokens(state) {
  for (const p of state.players) tokens.snapTo(p.id, p.pos);
}

/* ================= 事件导演：按顺序播放动画 ================= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Director {
  constructor() {
    this.queue = [];
    this.busy = false;
  }
  push(events) {
    this.queue.push(...events);
    if (this.queue.length > 24) this.ff = true; // 积压过多 → 快进
    if (!this.busy) this.run();
  }
  async run() {
    this.busy = true;
    while (this.queue.length) {
      const e = this.queue.shift();
      const ff = this.ff;
      try {
        await this.play(e, ff);
      } catch (err) {
        console.warn('[director]', e?.type, err);
      }
    }
    this.ff = false;
    this.busy = false;
    if (store.snap) {
      snapTokens(store.snap);
      renderAll(); // 动画播完后才亮出操作按钮，节奏更从容
    }
  }

  tokenPos(id) {
    return tokens.map.get(id)?.group.position ?? tileWorldPos(0, 0);
  }
  nameOf(id) { return playerById(id)?.name ?? '玩家'; }

  /** 快进：跳过动画直取结果（标签页休眠积压 / 长队尾） */
  applyInstant(e) {
    switch (e.type) {
      case 'move': tokens.snapTo(e.player, e.path[e.path.length - 1]); break;
      case 'jail': tokens.snapTo(e.player, 10); break;
      case 'buy': {
        const owner = playerById(e.player);
        setTileOwner(board, e.tile, owner?.color);
        break;
      }
      case 'build': setTileHouses(board, e.tile, e.houses); break;
      case 'mortgage': {
        const info = store.snap?.props?.[e.tile];
        const owner = info && playerById(info.owner);
        setTileOwner(board, e.tile, e.mortgaged ? '#5a6078' : owner?.color);
        break;
      }
      case 'turn': {
        const p = playerById(e.player);
        if (p) { moveHighlight(board, p.pos); scene3.focusOn(tileWorldPos(p.pos, 0)); }
        break;
      }
      case 'card': showCard(this.nameOf(e.player), e.card, e.deck); break;
      case 'win': gameOver(e.ranking, e.winner); break;
      case 'toast': toast(e.text, true); break;
      default: break;
    }
  }

  async play(e, ff = false) {
    if (ff) return this.applyInstant(e);
    const fmtMoney = (n) => '¥' + n.toLocaleString('en-US');
    switch (e.type) {
      case 'dice': {
        scene3.focusOn(new THREE.Vector3(0, 0.6, 0));
        await dice.roll(e.dice);
        break;
      }
      case 'move': {
        await tokens.walk(e.player, e.path);
        break;
      }
      case 'salary': {
        effects.floatText('+' + fmtMoney(e.amount), '#f0c96a', this.tokenPos(e.player));
        sfx.coin();
        await sleep(500);
        break;
      }
      case 'money': {
        if (e.from) effects.floatText('-' + fmtMoney(e.amount), '#ff8a80', this.tokenPos(e.from));
        if (e.to) effects.floatText('+' + fmtMoney(e.amount), '#7be3a5', this.tokenPos(e.to));
        if (e.from) sfx.pay(); else sfx.coin();
        await sleep(420);
        break;
      }
      case 'rent': {
        pulseTile(scene3.scene, e.tile, 0xef5a52);
        await sleep(250);
        break;
      }
      case 'card': {
        sfx.card();
        showCard(this.nameOf(e.player), e.card, e.deck);
        await sleep(2300);
        break;
      }
      case 'buy': {
        const owner = playerById(e.player);
        setTileOwner(board, e.tile, owner?.color);
        effects.floatText('-' + fmtMoney(e.price), '#ff8a80', tileWorldPos(e.tile, 0.4));
        pulseTile(scene3.scene, e.tile, 0xf0c96a);
        sfx.coin();
        await sleep(500);
        break;
      }
      case 'build': {
        setTileHouses(board, e.tile, e.houses);
        sfx.build();
        await sleep(350);
        break;
      }
      case 'mortgage': {
        const snap = store.snap;
        const info = snap?.props?.[e.tile];
        const owner = info && playerById(info.owner);
        setTileOwner(board, e.tile, e.mortgaged ? '#5a6078' : owner?.color);
        await sleep(200);
        break;
      }
      case 'offer': {
        scene3.focusOn(tileWorldPos(e.tile, 0));
        pulseTile(scene3.scene, e.tile, 0xf0c96a);
        await sleep(300);
        break;
      }
      case 'tax': {
        effects.floatText('-' + fmtMoney(e.amount), '#ff8a80', this.tokenPos(e.player));
        sfx.pay();
        await sleep(400);
        break;
      }
      case 'jail': {
        await tokens.jumpTo(e.player, 10, 3.4);
        sfx.jail();
        announce('⛓️ 入狱！', 'bad');
        await sleep(300);
        break;
      }
      case 'jailOut':
        announce('自由了！', 'gold');
        break;
      case 'turn': {
        const p = playerById(e.player);
        if (p) {
          moveHighlight(board, p.pos);
          scene3.focusOn(tileWorldPos(p.pos, 0));
        }
        sfx.turn();
        break;
      }
      case 'bankrupt': {
        tokens.fall(e.player);
        sfx.lose();
        await sleep(700);
        break;
      }
      case 'win': {
        dice.hide();
        effects.burstConfetti();
        sfx.win();
        await sleep(900);
        gameOver(e.ranking, e.winner);
        break;
      }
      case 'toast':
        toast(e.text, true);
        break;
      default:
        break;
    }
  }
}

const director = new Director();

// 调试/自动化测试句柄（挂载在文件末尾，确保所有模块就绪）
window.__richman = { socket, store, tokens, dice, board, effects, scene3, director };
window.__richmanEvents = [];
on('game:events', ({ events }) => window.__richmanEvents.push(...events.map(e => e.type)));
