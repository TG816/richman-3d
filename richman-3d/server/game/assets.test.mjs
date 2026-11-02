import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './engine.js';
import { BOARD, GROUPS } from './constants.js';
function fixture() {
 const e = new GameEngine(['甲', '乙'].map(id => ({ id, name: id })));
 e.players[0].money = 5000;
 const plots = BOARD.map((t, i) => ({ ...t, i })).filter(t => t.type === 'prop');
 const [built, mortgaged, other] = plots;
 e.props[built.i] = { owner: '甲', houses: 3, mortgaged: false };
 e.props[mortgaged.i] = { owner: '甲', houses: 0, mortgaged: true };
 e.props[other.i] = { owner: '乙', houses: 5, mortgaged: false };
 return { e, expected: 5000 + built.price + 3 * GROUPS[built.group].houseCost + mortgaged.price / 2 };
}
test('总资产包含建筑和抵押地产剩余价值，不计他人资产', () => {
 const { e, expected } = fixture();
 assert.equal(e.totalAssets(e.players[0]), expected);
 assert.equal(e.players[0].money, 5000);
});
test('最后幸存者与回合上限结算使用同一资产金额', () => {
 const { e: limit, expected } = fixture(); const { e: survivor } = fixture();
 limit.finishByAssets(); survivor.players[1].bankrupt = true; survivor.checkWin();
 assert.equal(limit.lastRanking.find(p => p.id === '甲').worth, expected);
 assert.equal(survivor.lastRanking[0].worth, expected);
 assert.equal(survivor.events.find(e => e.type === 'win').ranking[0].worth, expected);
 const restored = GameEngine.fromSnapshot(survivor.snapshot());
 assert.equal(restored.snapshot().ranking[0].worth, expected);
});
test('只有现金及全员破产的结算边界', () => {
 const e = new GameEngine(['甲', '乙'].map(id => ({ id, name: id })));
 assert.equal(e.totalAssets(e.players[0]), e.players[0].money);
 e.players.forEach(p => { p.bankrupt = true; });
 assert.equal(e.checkWin(), true); assert.deepEqual(e.lastRanking, []);
});
