import { BOARD, GROUPS, GROUP_TILES } from './constants.js';
import { CHANCE, FATE } from './cards.js';
import { config } from '../config.js';

const clampIdx = (n) => ((n % 40) + 40) % 40;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 大富翁规则引擎 —— 纯逻辑、无 IO，由服务端持有（服务器权威）。
 * 每个动作产生一批「事件」（供客户端播放动画/流水），动作结束后服务端广播完整快照。
 *
 * 回合状态机：roll（等待掷骰）→ buy（等待买地决定）→ end（本回合结束，可经营地产，等待下一位）
 * 掷出双数自动回到 roll（额外回合）；入狱、三次双数、 gameover 除外。
 */
export class GameEngine {
  /** players: [{id,name,avatarId,color}] */
  constructor(players) {
    this.players = players.map((p, i) => ({
      id: p.id, name: p.name, avatarId: p.avatarId, color: p.color,
      order: i, pos: 0, money: config.START_MONEY,
      inJail: false, jailTurns: 0, getOutCards: 0, bankrupt: false,
      doublesCount: 0, justJailed: false,
    }));
    this.turn = 0;
    this.round = 1;
    this.phase = 'roll';
    this.pending = null;        // phase==='buy' 时 {tile}
    this.lastRoll = null;       // {dice:[a,b], doubles, by}
    this.props = {};            // tileIndex -> {owner, houses, mortgaged}
    this.decks = { chance: shuffle([...CHANCE]), fate: shuffle([...FATE]) };
    this.discard = { chance: [], fate: [] };
    this.dice = [1, 1];
    this.winner = null;
    this.events = [];
    this.log = [];
    this.addLog(`对局开始！${this.players.map((p) => p.name).join('、')} 各携 ¥${config.START_MONEY} 入场`);
  }

  /* ================= 对外接口 ================= */

  can(playerId, action) {
    if (this.phase === 'gameover') return false;
    const p = this.players[this.turn];
    if (!p || p.id !== playerId || p.bankrupt) return false;
    switch (action) {
      case 'roll': return this.phase === 'roll';
      case 'buy': case 'decline': return this.phase === 'buy';
      case 'endTurn': return this.phase === 'end';
      case 'payJail': case 'useCard':
        return this.phase === 'roll' && p.inJail;
      case 'build': case 'sellHouse': case 'mortgage': case 'unmortgage':
        return this.phase === 'roll' || this.phase === 'end';
      default: return false;
    }
  }

  roll() {
    const p = this.players[this.turn];
    const a = 1 + Math.floor(Math.random() * 6);
    const b = 1 + Math.floor(Math.random() * 6);
    const doubles = a === b;
    this.dice = [a, b];
    this.lastRoll = { dice: [a, b], doubles, by: p.id };
    this.emit({ type: 'dice', player: p.id, dice: [a, b] });
    this.addLog(`${p.name} 掷出 ${a} + ${b} = ${a + b}${doubles ? '（双！再来一次）' : ''}`);

    if (p.inJail) return this.rollInJail(p, doubles);

    if (doubles) {
      p.doublesCount++;
      if (p.doublesCount >= 3) {
        this.addLog(`${p.name} 连续三次双数，因「超速」被送入监狱！`);
        return this.sendToJail(p);
      }
    } else {
      p.doublesCount = 0;
    }
    this.walk(p, a + b, { collectGo: true });
  }

  buy() {
    if (this.phase !== 'buy') return;
    const p = this.players[this.turn];
    const { tile } = this.pending;
    const t = BOARD[tile];
    if (p.money < t.price) return this.toast(`${p.name} 资金不足，无法购买`);
    this.transfer(null, p.id, t.price, `购入「${t.name}」`);
    this.props[tile] = { owner: p.id, houses: 0, mortgaged: false };
    this.emit({ type: 'buy', player: p.id, tile, price: t.price });
    this.addLog(`${p.name} 以 ¥${t.price} 购入「${t.name}」`);
    this.finishAction(p);
  }

  decline() {
    if (this.phase !== 'buy') return;
    const p = this.players[this.turn];
    this.addLog(`${p.name} 放弃购买「${BOARD[this.pending.tile].name}」`);
    this.finishAction(p);
  }

  build(playerId, tile) {
    const info = this.props[tile];
    const t = BOARD[tile];
    if (!info || info.owner !== playerId || t.type !== 'prop') return;
    const group = GROUP_TILES[t.group];
    if (!group.every((i) => this.props[i]?.owner === playerId))
      return this.toast('需集齐同色地段才能建房');
    if (group.some((i) => this.props[i].mortgaged))
      return this.toast('该地段存在抵押地块，不能建房');
    if (info.houses >= 5) return this.toast('这里已是酒店');
    const max = Math.max(...group.map((i) => this.props[i].houses));
    if (info.houses < max) return this.toast('需均匀建房：请先补齐同组其他地块');
    const cost = GROUPS[t.group].houseCost;
    const p = this.players.find((x) => x.id === playerId);
    if (p.money < cost) return this.toast('资金不足');
    this.transfer(null, playerId, cost, `在「${t.name}」施工`);
    info.houses++;
    this.emit({ type: 'build', tile, houses: info.houses, player: playerId });
    this.addLog(`${p.name} 在「${t.name}」${info.houses === 5 ? '建成酒店 🏨' : `建成第 ${info.houses} 栋房 🏠`}`);
  }

  sellHouse(playerId, tile) {
    const info = this.props[tile];
    const t = BOARD[tile];
    if (!info || info.owner !== playerId || info.houses <= 0 || t.type !== 'prop') return;
    const p = this.players.find((x) => x.id === playerId);
    const group = GROUP_TILES[t.group];
    const min = Math.min(...group.map((i) => this.props[i]?.houses ?? 0));
    if (info.houses - 1 < min) return this.toast('需均匀拆房：请先拆同组最高的');
    const refund = GROUPS[t.group].houseCost / 2;
    this.transfer(playerId, null, refund, `拆除「${t.name}」房屋`);
    info.houses--;
    this.emit({ type: 'build', tile, houses: info.houses, player: playerId });
    this.addLog(`${p.name} 拆卖「${t.name}」的房屋，回笼 ¥${refund}`);
  }

  mortgage(playerId, tile) {
    const info = this.props[tile];
    const t = BOARD[tile];
    if (!info || info.owner !== playerId || info.mortgaged) return;
    const p = this.players.find((x) => x.id === playerId);
    if (t.type === 'prop') {
      const group = GROUP_TILES[t.group];
      if (group.some((i) => (this.props[i]?.houses ?? 0) > 0))
        return this.toast('同组还有房屋，需先拆除');
    }
    info.mortgaged = true;
    const gain = t.price / 2;
    this.transfer(playerId, null, gain, `抵押「${t.name}」`);
    this.emit({ type: 'mortgage', tile, mortgaged: true, player: playerId });
    this.addLog(`${p.name} 抵押「${t.name}」，获得 ¥${gain}`);
  }

  unmortgage(playerId, tile) {
    const info = this.props[tile];
    const t = BOARD[tile];
    if (!info || info.owner !== playerId || !info.mortgaged) return;
    const cost = Math.ceil(t.price / 2 * 1.1);
    const p = this.players.find((x) => x.id === playerId);
    if (p.money < cost) return this.toast('资金不足');
    this.transfer(null, playerId, cost, `赎回「${t.name}」`);
    info.mortgaged = false;
    this.emit({ type: 'mortgage', tile, mortgaged: false, player: playerId });
    this.addLog(`${p.name} 以 ¥${cost} 赎回「${t.name}」`);
  }

  payJail() {
    const p = this.players[this.turn];
    if (!p.inJail || p.money < 500) return this.toast('资金不足');
    this.transfer(p.id, null, 500, '保释金');
    p.inJail = false;
    p.jailTurns = 0;
    this.addLog(`${p.name} 支付 ¥500 保释金出狱`);
    this.emit({ type: 'jailOut', player: p.id, how: 'pay' });
  }

  useCard() {
    const p = this.players[this.turn];
    if (!p.inJail || p.getOutCards <= 0) return;
    p.getOutCards--;
    p.inJail = false;
    p.jailTurns = 0;
    this.decks.chance.push(CHANCE.find((c) => c.effect.type === 'getout')); // 回牌库底
    this.addLog(`${p.name} 使用出狱许可证出狱`);
    this.emit({ type: 'jailOut', player: p.id, how: 'card' });
  }

  endTurn() {
    if (this.phase !== 'end') return;
    this.advanceTurn();
  }

  /* ================= 内部流程 ================= */

  rollInJail(p, doubles) {
    if (doubles) {
      p.inJail = false;
      p.jailTurns = 0;
      this.addLog(`${p.name} 掷出双数，取保候审成功！`);
      this.emit({ type: 'jailOut', player: p.id, how: 'roll' });
      this.walk(p, this.dice[0] + this.dice[1], { collectGo: true, noExtra: true });
    } else {
      p.jailTurns++;
      this.addLog(`${p.name} 掷不出双数，继续蹲牢（第 ${p.jailTurns} 回合）`);
      if (p.jailTurns >= 3) {
        this.addLog(`${p.name} 蹲满三回合，强制支付 ¥500 保释金`);
        this.transfer(p.id, null, 500, '强制保释金');
        if (p.bankrupt) return;
        p.inJail = false;
        p.jailTurns = 0;
        this.emit({ type: 'jailOut', player: p.id, how: 'forced' });
        this.walk(p, this.dice[0] + this.dice[1], { collectGo: true, noExtra: true });
      } else {
        this.phase = 'end';
      }
    }
  }

  /** 沿正向走 steps 步（client 播放逐格动画）；过起点发工资 */
  walk(p, steps, { collectGo = true, noExtra = false, backward = false } = {}) {
    const from = p.pos;
    const path = [];
    for (let i = 1; i <= steps; i++) path.push(clampIdx(p.pos + (backward ? -i : i)));
    p.pos = path[path.length - 1];
    if (collectGo && !backward && path.includes(0) && from !== 0) {
      this.transfer(null, p.id, config.SALARY, '经过起点');
      this.emit({ type: 'salary', player: p.id, amount: config.SALARY });
      this.addLog(`${p.name} 经过起点，领取工资 ¥${config.SALARY}`);
    }
    this.emit({ type: 'move', player: p.id, from, path });
    this.resolveTile(p, noExtra);
  }

  /** 卡片「前进到 X」：沿正向走到目标格 */
  goto(p, tile, { noExtra = true } = {}) {
    const steps = clampIdx(tile - p.pos) || 40;
    this.walk(p, steps, { noExtra });
  }

  resolveTile(p, noExtra) {
    const idx = p.pos;
    const t = BOARD[idx];
    switch (t.type) {
      case 'prop': case 'station': case 'utility': {
        const info = this.props[idx];
        if (!info) {
          this.phase = 'buy';
          this.pending = { tile: idx };
          this.emit({ type: 'offer', player: p.id, tile: idx });
          return; // 等待买/放弃
        }
        if (info.owner === p.id) { this.addLog(`${p.name} 回到自家「${t.name}」`); break; }
        if (info.mortgaged) { this.addLog(`「${t.name}」处于抵押中，免收租金`); break; }
        const owner = this.players.find((x) => x.id === info.owner);
        if (!owner || owner.bankrupt) break;
        const rent = this.calcRent(idx);
        this.addLog(`${p.name} 闯入 ${owner.name} 的「${t.name}」，支付租金 ¥${rent}`);
        this.emit({ type: 'rent', from: p.id, to: owner.id, amount: rent, tile: idx });
        this.transfer(p.id, owner.id, rent, `「${t.name}」租金`);
        break;
      }
      case 'chance': case 'fate': {
        const d = t.type;
        if (this.decks[d].length === 0) {
          this.decks[d] = shuffle(this.discard[d]);
          this.discard[d] = [];
        }
        const card = this.decks[d].shift();
        this.discard[d].push(card);
        this.addLog(`${p.name} 抽到${t.name}卡「${card.title}」：${card.text}`);
        this.emit({ type: 'card', player: p.id, deck: d, card });
        return this.applyCard(p, card, noExtra);
      }
      case 'tax':
        this.addLog(`${p.name} 缴纳${t.name} ¥${t.amount}`);
        this.emit({ type: 'tax', player: p.id, amount: t.amount, tile: idx });
        this.transfer(p.id, null, t.amount, t.name);
        break;
      case 'gotojail':
        this.addLog(`${p.name} 被押送入监狱！`);
        return this.sendToJail(p);
      case 'go':
        this.addLog(`${p.name} 落在起点`);
        break;
      case 'park':
        this.addLog(`${p.name} 在免费停车处歇了口气`);
        break;
      case 'jail':
        this.addLog(`${p.name} 只是来探监的`);
        break;
    }
    this.finishAction(p, { noExtra });
  }

  applyCard(p, card, noExtra) {
    const e = card.effect;
    switch (e.type) {
      case 'money':
        if (e.amount >= 0) this.transfer(null, p.id, e.amount, card.title);
        else this.transfer(p.id, null, -e.amount, card.title);
        break;
      case 'goto':
        return this.goto(p, e.tile, { noExtra });
      case 'move':
        return this.walk(p, Math.abs(e.delta), { backward: e.delta < 0, noExtra: true });
      case 'nearest': {
        const kinds = e.kind === 'station' ? ['station'] : ['utility'];
        let best = null;
        BOARD.forEach((t, i) => {
          if (!kinds.includes(t.type)) return;
          const d = clampIdx(i - p.pos) || 40;
          if (!best || d < best.d) best = { i, d };
        });
        return this.goto(p, best.i, { noExtra });
      }
      case 'jail':
        return this.sendToJail(p);
      case 'getout':
        p.getOutCards++;
        break;
      case 'repairs': {
        let total = 0;
        for (const [idx, info] of Object.entries(this.props)) {
          if (info.owner !== p.id) continue;
          total += info.houses === 5 ? e.hotel : info.houses * e.house;
        }
        if (total > 0) {
          this.addLog(`${p.name} 支付维修费 ¥${total}`);
          this.transfer(p.id, null, total, '维修费');
        }
        break;
      }
      case 'collectEach':
        for (const o of this.players) {
          if (o !== p && !o.bankrupt) this.transfer(o.id, p.id, e.amount, `${p.name} 的生日礼物`);
        }
        break;
    }
    this.finishAction(p, { noExtra });
  }

  calcRent(idx) {
    const info = this.props[idx];
    const t = BOARD[idx];
    const owner = info.owner;
    if (t.type === 'prop') {
      const group = GROUP_TILES[t.group];
      const monopoly = group.every((i) => this.props[i]?.owner === owner);
      if (info.houses === 0) return t.rent * (monopoly ? 2 : 1);
      return t.rents[info.houses - 1];
    }
    if (t.type === 'station') {
      const n = BOARD.filter((x) => x.type === 'station')
        .length;
      let owned = 0;
      BOARD.forEach((x, i) => {
        if (x.type === 'station' && this.props[i]?.owner === owner && !this.props[i].mortgaged) owned++;
      });
      void n;
      return [0, 250, 500, 1000, 2000][owned];
    }
    if (t.type === 'utility') {
      let owned = 0;
      BOARD.forEach((x, i) => {
        if (x.type === 'utility' && this.props[i]?.owner === owner && !this.props[i].mortgaged) owned++;
      });
      const roll = this.dice ? this.dice[0] + this.dice[1] : 7;
      return roll * (owned === 2 ? 100 : 40);
    }
    return 0;
  }

  sendToJail(p) {
    p.pos = 10;
    p.inJail = true;
    p.jailTurns = 0;
    p.doublesCount = 0;
    p.justJailed = true;
    this.emit({ type: 'jail', player: p.id });
    this.phase = 'end';
  }

  finishAction(p, { noExtra = false } = {}) {
    if (p.bankrupt) return;               // 破产时 advanceTurn 已在 bankruptPlayer 中完成
    if (this.checkWin()) return;
    if (this.lastRoll?.doubles && !noExtra && !p.justJailed) {
      this.phase = 'roll';                // 双数 → 额外回合
    } else {
      this.phase = 'end';                 // 等待玩家经营/结束
    }
  }

  advanceTurn() {
    if (this.phase === 'gameover') return;
    const n = this.players.length;
    let next = this.turn;
    for (let k = 1; k <= n; k++) {
      const c = (this.turn + k) % n;
      if (!this.players[c].bankrupt) { next = c; break; }
    }
    if (next <= this.turn) {
      this.round++;
      if (this.round > config.ROUND_LIMIT) return this.finishByAssets();
    }
    this.turn = next;
    this.players.forEach((p) => { p.doublesCount = 0; p.justJailed = false; });
    this.phase = 'roll';
    this.lastRoll = null;
    this.emit({ type: 'turn', player: this.players[this.turn].id, round: this.round });
  }

  finishByAssets() {
    const worth = (p) =>
      p.money +
      Object.entries(this.props)
        .filter(([, info]) => info.owner === p.id)
        .reduce((s, [idx, info]) => {
          const t = BOARD[idx];
          const base = info.mortgaged ? t.price / 2 : t.price;
          const houses = info.houses;
          const hc = t.type === 'prop' ? GROUPS[t.group].houseCost : 0;
          return s + base + houses * hc;
        }, 0);
    const alive = this.players.filter((p) => !p.bankrupt).sort((a, b) => worth(b) - worth(a));
    this.winner = alive[0] || null;
    this.phase = 'gameover';
    this.addLog(`⏰ 达到 ${config.ROUND_LIMIT} 回合上限，按总资产结算：${this.winner.name} 以 ¥${worth(this.winner)} 夺冠！`);
    this.emit({
      type: 'win',
      winner: this.winner?.id ?? null,
      reason: 'assets',
      ranking: alive.map((p) => ({ id: p.id, worth: worth(p) })),
    });
  }

  checkWin() {
    const alive = this.players.filter((p) => !p.bankrupt);
    if (alive.length > 1) return false;
    this.winner = alive[0] || null;
    this.phase = 'gameover';
    this.addLog(this.winner ? `🏆 ${this.winner.name} 笑到最后，赢得整场对局！` : '全员破产，无人幸存……');
    this.emit({
      type: 'win',
      winner: this.winner?.id ?? null,
      reason: 'last',
      ranking: alive.map((p) => ({ id: p.id, worth: p.money })),
    });
    return true;
  }

  /** 付款 from→to（null=银行）。资金不足自动拆房→抵押，仍不足则破产清算 */
  transfer(fromId, toId, amount, reason) {
    if (amount <= 0) return;
    const from = fromId ? this.players.find((p) => p.id === fromId) : null;
    const to = toId ? this.players.find((p) => p.id === toId) : null;
    if (from) {
      if (from.money < amount) this.liquidate(from, amount);
      if (from.money < amount) return this.bankruptPlayer(from, to);
      from.money -= amount;
    }
    if (to) to.money += amount;
    this.emit({ type: 'money', from: fromId, to: toId, amount, reason });
  }

  liquidate(p, need) {
    const owned = Object.entries(this.props).filter(([, info]) => info.owner === p.id);
    for (const [idx, info] of owned) {
      while (p.money < need && info.houses > 0) {
        const t = BOARD[idx];
        info.houses--;
        p.money += GROUPS[t.group].houseCost / 2;
        this.emit({ type: 'build', tile: +idx, houses: info.houses, player: p.id, forced: true });
        this.addLog(`${p.name} 紧急拆除「${t.name}」的房屋套现`);
      }
    }
    for (const [idx, info] of owned) {
      if (p.money < need && !info.mortgaged) {
        const t = BOARD[idx];
        info.mortgaged = true;
        p.money += t.price / 2;
        this.emit({ type: 'mortgage', tile: +idx, mortgaged: true, player: p.id, forced: true });
        this.addLog(`${p.name} 紧急抵押「${t.name}」套现`);
      }
    }
  }

  bankruptPlayer(p, creditor) {
    p.bankrupt = true;
    for (const [idx, info] of Object.entries(this.props)) {
      if (info.owner !== p.id) continue;
      if (info.houses > 0) {
        const t = BOARD[idx];
        p.money += (info.houses * GROUPS[t.group].houseCost) / 2;
        info.houses = 0;
        this.emit({ type: 'build', tile: +idx, houses: 0, player: p.id, forced: true });
      }
      if (creditor) info.owner = creditor.id;
      else delete this.props[idx];
    }
    if (creditor) {
      creditor.money += p.money;
      this.addLog(`💀 ${p.name} 破产出局！全部地产与现金移交给 ${creditor.name}`);
      this.emit({ type: 'bankrupt', player: p.id, creditor: creditor.id });
    } else {
      p.money = 0;
      this.addLog(`💀 ${p.name} 破产出局！`);
      this.emit({ type: 'bankrupt', player: p.id, creditor: null });
    }
    p.money = 0;
    if (this.checkWin()) return;
    if (this.players[this.turn]?.id === p.id) this.advanceTurn();
  }

  /* ================= 工具 ================= */

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  addLog(text) { this.log.push({ ts: Date.now(), text }); if (this.log.length > 200) this.log.shift(); }
  toast(text) { this.emit({ type: 'toast', text }); }

  /** 客户端可见快照（牌库顺序不外泄） */
  snapshot() {
    return {
      players: this.players.map((p) => ({ ...p })),
      turn: this.turn,
      round: this.round,
      phase: this.phase,
      pending: this.pending,
      lastRoll: this.lastRoll,
      props: Object.fromEntries(Object.entries(this.props).map(([k, v]) => [k, { ...v }])),
      decksLeft: { chance: this.decks.chance.length, fate: this.decks.fate.length },
      winner: this.winner?.id ?? null,
      log: this.log.slice(-40),
      config: { roundLimit: config.ROUND_LIMIT, turnSeconds: config.TURN_SECONDS, startMoney: config.START_MONEY, salary: config.SALARY },
    };
  }
}
