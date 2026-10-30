import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GameEngine } from './game/engine.js';
import { RoomManager } from './rooms.js';

function createManager(saveDir) {
  const events = [];
  const io = { to: () => ({ emit: (event, data) => events.push({ event, data }) }) };
  return { manager: new RoomManager(io, saveDir), events };
}

function createStartedRoom(manager) {
  const room = manager.newRoom('ABCD');
  room.players = [
    { sid: 'sid-a', id: 'player-a', name: '玩家甲', avatarId: 'red' },
    { sid: 'sid-b', id: 'player-b', name: '玩家乙', avatarId: 'blue' },
  ];
  room.started = true;
  room.engine = new GameEngine(room.players.map((p, i) => ({
    ...p, color: i ? '#00f' : '#f00',
  })));
  return room;
}

test('全员同意保存后可用存档码恢复对局和原席位', (t) => {
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'richman-save-test-'));
  const { manager, events } = createManager(saveDir);
  t.after(() => {
    manager.destroyRoom('ABCD');
    fs.rmSync(saveDir, { recursive: true, force: true });
  });
  const room = createStartedRoom(manager);
  const originalMoney = room.engine.players.map((p) => p.money);

  assert.equal(manager.requestVote(room, 'sid-a', 'save').ok, true);
  assert.equal(manager.castVote(room, 'sid-b', true).ok, true);
  assert.equal(manager.rooms.has('ABCD'), false);
  assert.ok(events.some((e) => e.event === 'room:closed' && e.data.code === 'ABCD'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(saveDir, 'ABCD.json'), 'utf8')).code, 'ABCD');

  const restored = manager.resumeRoom('ABCD');
  assert.ok(restored.room);
  assert.equal(manager.resumeJoin('ABCD', { playerId: 'player-b', sid: 'new-b' }).me.id, 'player-b');
  assert.equal(manager.resumeJoin('ABCD', { playerId: 'player-a', sid: 'new-a' }).me.id, 'player-a');
  assert.deepEqual(restored.room.engine.players.map((p) => p.money), originalMoney);
  assert.ok(restored.room.timer);
});

test('拒绝结束投票会保留对局，且恢复码校验拒绝路径输入', (t) => {
  const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), 'richman-vote-test-'));
  const { manager } = createManager(saveDir);
  t.after(() => {
    manager.destroyRoom('ABCD');
    fs.rmSync(saveDir, { recursive: true, force: true });
  });
  const room = createStartedRoom(manager);

  assert.equal(manager.requestVote(room, 'sid-a', 'quit').ok, true);
  assert.equal(manager.castVote(room, 'sid-b', false).ok, true);
  assert.equal(manager.rooms.get('ABCD'), room);
  assert.equal(room.vote, null);
  assert.equal(manager.resumeRoom('..../').error, '存档码格式错误');
});
