import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './engine.js';
import { BOARD, GROUPS } from './constants.js';
const tile = BOARD.findIndex(t => t.type === 'prop');
const cost = GROUPS[BOARD[tile].group].houseCost;
function setup() {
  const e = new GameEngine(['甲', '乙'].map(id => ({ id, name: id })));
  e.players[0].money = 100000;
  e.players[0].pos = tile;
  e.resolveTile(e.players[0]); e.buy();
  return e;
}
test('购买不触发升级，地契远程请求被拒绝', () => {
  const e = setup(); const money = e.players[0].money;
  e.build('甲', tile);
  assert.equal(e.props[tile].houses, 0);
  assert.equal(e.players[0].money, money);
});
test('再次落地仅升级一级，重复和异地请求不扣费', () => {
  const e = setup(); e.resolveTile(e.players[0]);
  assert.equal(e.phase, 'upgrade');
  e.build('乙', tile); e.build('甲', tile + 1);
  assert.equal(e.props[tile].houses, 0);
  const money = e.players[0].money;
  e.build('甲', tile); e.build('甲', tile);
  assert.equal(e.props[tile].houses, 1);
  assert.equal(e.players[0].money, money - cost);
  assert.equal(e.pending, null);
});
test('放弃消耗机会，再次落点可产生新机会', () => {
  const e = setup(); e.resolveTile(e.players[0]); e.decline();
  e.build('甲', tile); assert.equal(e.props[tile].houses, 0);
  e.resolveTile(e.players[0]); e.build('甲', tile);
  assert.equal(e.props[tile].houses, 1);
});
test('双数继续掷骰不会保留已消费的机会，特殊移动保留禁止再掷标记', () => {
  const e = setup(); e.lastRoll = { doubles: true };
  e.resolveTile(e.players[0]); e.build('甲', tile);
  assert.equal(e.phase, 'roll'); e.build('甲', tile);
  assert.equal(e.props[tile].houses, 1);
  e.resolveTile(e.players[0], true); e.decline();
  assert.equal(e.phase, 'end');
});
test('保存恢复升级机会，消费后再次恢复不能重用', () => {
  let e = setup(); e.resolveTile(e.players[0]);
  e = GameEngine.fromSnapshot(e.snapshot()); e.build('甲', tile);
  e = GameEngine.fromSnapshot(e.snapshot()); e.build('甲', tile);
  assert.equal(e.props[tile].houses, 1);
});
test('资金不足可放弃，抵押和满级地产不触发升级', () => {
  const e = setup(); e.players[0].money = 0;
  e.resolveTile(e.players[0]); e.build('甲', tile);
  assert.equal(e.props[tile].houses, 0); e.decline(); assert.equal(e.phase, 'end');
  e.props[tile].mortgaged = true; e.resolveTile(e.players[0]); assert.equal(e.phase, 'end');
  e.props[tile].mortgaged = false; e.props[tile].houses = 5;
  e.resolveTile(e.players[0]); assert.equal(e.phase, 'end');
});
