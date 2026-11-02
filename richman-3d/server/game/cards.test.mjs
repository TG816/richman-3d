import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './engine.js';
import { BOARD } from './constants.js';
const make = () => new GameEngine(['甲', '乙'].map(id => ({id, name:id})));
function draw(e, source) {
 const deck = e.decks[source]; const i = deck.findIndex(c => c.effect.type === 'getout');
 assert.ok(i >= 0); deck.unshift(...deck.splice(i, 1));
 e.players[0].pos = BOARD.findIndex(t => t.type === source);
 e.resolveTile(e.players[0]);
}
function count(e, source) {
 return [...e.decks[source], ...e.discard[source]].filter(c => c.effect.type === 'getout').length
   + e.players.reduce((n,p) => n + p.getOutSources.filter(s => s === source).length, 0);
}
for (const source of ['chance','fate']) {
 test(`${source} 出狱卡持有期间离开牌堆，使用后归还原库且不重复`, () => {
  const e=make(); draw(e,source);
  assert.equal(e.discard[source].filter(c=>c.effect.type==='getout').length,0);
  assert.equal(e.decks[source].filter(c=>c.effect.type==='getout').length,0);
  assert.equal(count(e,source),1);
  e.players[0].inJail=true; e.phase='roll'; e.useCard(); e.useCard();
  assert.equal(e.players[0].getOutCards,0);
  assert.equal(e.decks[source].at(-1).effect.type,'getout');
  assert.equal(count(e,source),1);
 });
}
test('新存档精确恢复牌库、弃牌和持有来源，公开快照不含牌序',()=>{
 const e=make(); draw(e,'fate'); draw(e,'chance');
 const saved=e.saveSnapshot(); const r=GameEngine.fromSnapshot(saved);
 assert.deepEqual(r.decks,e.decks); assert.deepEqual(r.discard,e.discard);
 assert.deepEqual(r.players[0].getOutSources,['fate','chance']);
 assert.equal(e.snapshot().cardState,undefined);
 r.players[0].inJail=true; r.useCard();
 assert.equal(count(r,'fate'),1); assert.equal(count(r,'chance'),1);
});
test('破产归还两张出狱卡，牌堆洗回仍不复制持有卡',()=>{
 const e=make(); draw(e,'chance'); draw(e,'fate');
 e.discard.chance.push(...e.decks.chance); e.decks.chance=[];
 e.players[0].pos=BOARD.findIndex(t=>t.type==='chance'); e.resolveTile(e.players[0]);
 assert.equal(count(e,'chance'),1);
 e.bankruptPlayer(e.players[0],null);
 assert.equal(e.players[0].getOutCards,0);
 assert.equal(count(e,'chance'),1); assert.equal(count(e,'fate'),1);
});
test('旧存档缺失来源时兼容分配，避免重复实体卡',()=>{
 const snap=make().snapshot();
 snap.players.forEach(p=>{delete p.getOutSources; p.getOutCards=3;});
 const e=GameEngine.fromSnapshot(snap);
 assert.equal(count(e,'chance'),1); assert.equal(count(e,'fate'),1);
 assert.equal(e.players.reduce((n,p)=>n+p.getOutCards,0),2);
});
