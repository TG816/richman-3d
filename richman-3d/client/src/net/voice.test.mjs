import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// 在隔离环境中执行真实语音模块，模拟浏览器与网络，不连接外部 TURN。
function setup() {
  const sent = [], timers = [], handlers = {};
  const socket = { id: 'self', connected: true, on() {}, emit: (...args) => sent.push(args),
    disconnect() { throw new Error('语音不得断开游戏'); }, connect() { throw new Error('语音不得重连游戏'); } };
  const store = { room: { code: 'TEST', players: [{ sid: 'a' }, { sid: 'b' }] } };
  class Peer {
    constructor() { this.iceConnectionState = 'new'; }
    addTrack() {} close() { this.closed = true; }
  }
  const context = { socket, store, ListeningSettings: class {}, toast() {},
    on: (name, fn) => { handlers[name] = fn; }, addEventListener() {},
    document: { querySelectorAll: () => [], querySelector: () => null },
    RTCPeerConnection: Peer, MediaStream: class {}, console,
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {} };
  vm.createContext(context);
  const source = fs.readFileSync(new URL('./voice.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace('export const voice = new Voice();', 'globalThis.voice = new Voice();');
  vm.runInContext(source, context);
  context.voice.silentTrack = () => ({});
  context.voice.listening = { clear() {}, apply() {} };
  return { ...context, voice: context.voice, sent, timers, handlers };
}

test('单个队友重试到上限只提示失败，不重连游戏或影响另一队友', async () => {
  const { voice } = setup();
  const failed = voice.connectTo('a', true), healthy = voice.connectTo('b', true);
  failed._restartAttempts = 2;
  await voice.restartIce('a');
  assert.equal(voice.getStatus('a'), '连接失败，可重试');
  assert.equal(voice.peers.get('b'), healthy);
  assert.equal(healthy.closed, undefined);
});

test('checking 不清零重试次数，真正连通才清零', () => {
  const { voice } = setup();
  const pc = voice.connectTo('a', true); pc._restartAttempts = 2;
  pc.iceConnectionState = 'checking'; pc.oniceconnectionstatechange();
  assert.equal(pc._restartAttempts, 2);
  pc.iceConnectionState = 'connected'; pc.oniceconnectionstatechange();
  assert.equal(pc._restartAttempts, 0);
});

test('应答方请求重试同样有上限', () => {
  const { voice, timers, sent } = setup();
  voice.connectTo('a', false);
  voice.requestRestart('a'); timers.shift()(); timers.shift()();
  assert.equal(sent.filter(x => x[0] === 'voice:signal').length, 2);
  assert.equal(voice.getStatus('a'), '连接失败，可重试');
});

test('房间快照不重复 hello，离线队友连接及候选被清理', () => {
  const { voice, handlers, store, sent } = setup(); voice.wire();
  handlers.room(); handlers.room();
  assert.equal(sent.filter(x => x[0] === 'voice:hello').length, 1);
  const pc = voice.connectTo('a', true); voice._pending.set('a', [{}]);
  store.room.players[0].disconnected = true; handlers.room();
  assert.equal(pc.closed, true); assert.equal(voice.peers.has('a'), false);
  assert.equal(voice._pending.has('a'), false);
});

test('播放权限被阻止时显示不同于连接失败的提示', async () => {
  const { voice } = setup();
  const audio = { play: async () => { throw { name: 'NotAllowedError' }; } };
  voice.audios.set('a', audio); await voice.playAudio('a', audio);
  assert.equal(voice.getStatus('a'), '播放被阻止，请点击页面');
});

test('手动重试应答方会通知发起方重置预算', () => {
  const { voice, sent } = setup(); const pc = voice.connectTo('a', false);
  pc._restartAttempts = 2; voice.retryPeer('a');
  assert.equal(sent.some(x => x[1]?.data?.retry === true), true);
  assert.equal(pc._restartAttempts, 1);
});

test('对局玩家无 sid 时按稳定 ID 查询状态，重连后使用新 sid', () => {
  const { voice, store } = setup();
  store.room.players[0].id = 'player1';
  voice.setStatus('a', '已连接');
  assert.equal(voice.getStatus(voice.peerId('player1')), '已连接');
  store.room.players[0].sid = 'new-a';
  voice.setStatus('new-a', '连接中');
  assert.equal(voice.peerId('player1'), 'new-a');
  assert.equal(voice.getStatus(voice.peerId('player1')), '连接中');
});

test('真实连接已连通时不受缓存提示缺失影响，并区分成员映射缺失', () => {
  const { voice } = setup(); const pc = voice.connectTo('a', false);
  voice.statuses.delete('a'); pc.connectionState = 'connected';
  assert.equal(voice.getStatus('a'), '已连接');
  assert.equal(voice.getStatus(undefined), '成员连接信息未同步');
  voice.statuses.set('a', '播放被阻止，请点击页面');
  assert.equal(voice.getStatus('a'), '播放被阻止，请点击页面');
});
