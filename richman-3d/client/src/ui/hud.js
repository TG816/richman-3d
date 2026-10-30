import { BOARD, GROUPS } from '@board';
import { socket, emitAck } from '../net/socket.js';
import { store, isMyTurn, currentPlayer, playerById, on, toast } from '../game/store.js';
import { escapeHtml } from './lobby.js';

const $ = (id) => document.getElementById(id);

/** 对局 HUD：玩家卡、行动按钮、公告、地契卡、结算、计时条 */
export function initHud() {
  /* 行动按钮 → 服务端动作 */
  $('btnRoll').onclick = () => act('roll');
  $('btnBuy').onclick = () => act('buy');
  $('btnDecline').onclick = () => act('decline');
  $('btnEnd').onclick = () => act('endTurn');
  $('btnPayJail').onclick = () => act('payJail');
  $('btnUseCard').onclick = () => act('useCard');
  $('btnExit').onclick = () => {
    $('exitChoices').classList.remove('hidden');
    $('exitVoting').classList.add('hidden');
    $('exitModal').classList.remove('hidden');
  };
  $('btnVoteBack').onclick = () => $('exitModal').classList.add('hidden');
  $('btnVoteSave').onclick = () => requestVote('save');
  $('btnVoteQuit').onclick = () => requestVote('quit');
  $('btnVoteAgree').onclick = () => castVote(true);
  $('btnVoteReject').onclick = () => castVote(false);
  $('btnVoteCancel').onclick = () => sendVoteAction({ action: 'cancel' });

  socket.on('game:vote', ({ __room, vote } = {}) => {
    if (__room !== store.room?.code || !vote) return;
    if (vote.done) {
      $('exitModal').classList.add('hidden');
      if (vote.passed && vote.mode === 'save' && vote.savedCode) {
        sessionStorage.setItem('richman.savedSeat', JSON.stringify({
          code: vote.savedCode,
          playerId: store.me?.id,
        }));
      } else if (vote.saveFailed) {
        toast('存档失败，对局仍在继续，请稍后重试', true);
      } else if (vote.gameEnded) {
        toast('对局已自然结束，结束投票已关闭');
      } else if (vote.passed) {
        toast('全员同意，正在结束对局');
      } else if (vote.cancelled) {
        toast('发起者已取消结束投票');
      } else if (vote.expired) {
        toast('结束投票超时，投票未通过', true);
      } else {
        toast('有玩家拒绝结束，对局继续', true);
      }
      return;
    }

    $('exitChoices').classList.add('hidden');
    $('exitVoting').classList.remove('hidden');
    $('exitModal').classList.remove('hidden');
    $('exitTitle').textContent = vote.mode === 'save' ? '保存并结束对局' : '直接结束对局';
    const yes = Object.values(vote.votes || {}).filter(Boolean).length;
    $('exitVoteInfo').textContent = `${vote.byName} 发起了${vote.mode === 'save' ? '保存并结束' : '直接结束'}投票（${yes}/${vote.total} 人同意）`;
    const alreadyVoted = store.me?.id in (vote.votes || {});
    const isInitiator = store.me?.id === vote.by;
    $('exitVoteBtns').classList.toggle('hidden', isInitiator || alreadyVoted);
    $('btnVoteCancel').classList.toggle('hidden', !isInitiator);
    $('voteCountdownFill').style.transition = 'none';
    $('voteCountdownFill').style.transform = 'scaleX(1)';
    requestAnimationFrame(() => {
      $('voteCountdownFill').style.transition = `transform ${Math.max(0, vote.deadline - Date.now())}ms linear`;
      $('voteCountdownFill').style.transform = 'scaleX(0)';
    });
  });

  async function requestVote(mode) {
    await sendVoteAction({ action: 'request', mode });
  }

  async function castVote(agree) {
    await sendVoteAction({ action: 'vote', agree });
  }

  async function sendVoteAction(payload) {
    const res = await emitAck('game:vote', payload);
    if (!res.ok) toast(res.error || '投票请求失败', true);
  }

  addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (e.key === 'Enter' && store.screen === 'game' && !$('btnEnd').classList.contains('hidden')) {
      $('btnEnd').click();
    }
    if (e.key === ' ' && store.screen === 'game' && !$('btnRoll').classList.contains('hidden')) {
      e.preventDefault();
      $('btnRoll').click();
    }
  });

  $('hudCode').onclick = async () => {
    const link = location.origin + location.pathname + '?room=' + (store.room?.code || $('hudCode').textContent);
    try { await navigator.clipboard.writeText(link); toast('邀请链接已复制！'); }
    catch { toast('复制失败，房间码：' + store.room?.code, true); }
  };

  $('deedModal').onclick = (e) => { if (e.target.id === 'deedModal') closeDeed(); };
  $('btnBack').onclick = () => {
    sessionStorage.removeItem('richman.session'); // 结算后回大厅，不自动重连旧局
    location.reload();
  };

  /* 事件驱动的公告 */
  on('events', (events) => {
    for (const e of events) {
      const name = (id) => escapeHtml(playerById(id)?.name ?? '玩家');
      switch (e.type) {
        case 'turn':
          // 必须用事件自带的 e.player：此刻新快照还没到，currentPlayer() 读到的是上一回合玩家（两人局恰好反向）
          announce(`轮到 <b>${name(e.player)}</b> 行动`, 'gold');
          break;
        case 'salary': announce(`${name(e.player)} 经过起点，领取工资 <b>¥${e.amount}</b>`, 'gold'); break;
        case 'rent': announce(`${name(e.from)} 向 ${name(e.to)} 支付租金 <b>¥${e.amount}</b>`, 'bad'); break;
        case 'jail': announce(`${name(e.player)} 被关进了监狱 ⛓️`, 'bad'); break;
        case 'jailOut': announce(`${name(e.player)} 离开了监狱`); break;
        case 'bankrupt': announce(`💀 ${name(e.player)} 破产出局！`, 'bad'); break;
        case 'buy': announce(`${name(e.player)} 购入「${BOARD[e.tile].name}」`, 'gold'); break;
      }
    }
  });

  /* 计时条 */
  on('timer', ({ deadline, seconds }) => {
    const el = $('turnTimer');
    el.classList.remove('idle');
    const fill = $('turnTimerFill');
    const step = () => {
      const remain = Math.max(0, deadline - Date.now());
      fill.style.transform = `scaleX(${remain / (seconds * 1000)})`;
      if (remain > 0 && store.screen === 'game') requestAnimationFrame(step);
      else el.classList.add('idle');
    };
    requestAnimationFrame(step);
  });

  function act(action, payload = {}) {
    socket.emit('game:action', { action, ...payload });
  }
}

/* ---------- 渲染 ---------- */

export function renderAll() {
  if (!store.snap) return;
  renderRound();
  renderPlayers();
  renderActions();
  highlightCurrent();
}

function renderRound() {
  $('hudRound').textContent = `第 ${store.snap.round} / ${store.snap.config.roundLimit} 回合`;
  $('hudCode').textContent = store.room?.code ?? '----';
}

function renderPlayers() {
  const box = $('playerCards');
  box.innerHTML = '';
  const propsOf = (id) => Object.values(store.snap.props).filter((p) => p.owner === id);
  for (const p of store.snap.players) {
    const card = document.createElement('div');
    card.className = 'pcard'
      + (p.id === store.snap.players[store.snap.turn]?.id && store.snap.phase !== 'gameover' ? ' turn' : '')
      + (p.bankrupt ? ' dead' : '')
      + (p.inJail ? ' jail' : '');
    const owned = propsOf(p.id);
    const houses = owned.reduce((s, info) => s + (info.houses || 0), 0);
    card.innerHTML = `
      <div class="dot" style="background:${p.color}">🤖</div>
      <div class="pinfo">
        <div class="pname">${escapeHtml(p.name)}${p.id === store.me?.id ? ' <span style="color:#8b93b8;font-size:10px">(我)</span>' : ''}</div>
        <div class="pmoney">¥ ${p.money.toLocaleString('en-US')}</div>
        <div class="pmeta">地产 ${owned.length} 处 · 房 ${houses}${p.getOutCards ? ' · 🎟️x' + p.getOutCards : ''}</div>
      </div>`;
    box.appendChild(card);
  }
}

function renderActions() {
  const s = store.snap;
  const mine = isMyTurn();
  const show = (id, on) => $(id).classList.toggle('hidden', !on);
  show('btnRoll', false); show('btnBuy', false); show('btnDecline', false); show('btnEnd', false);
  show('jailActions', false);

  const status = $('statusText');
  const cur = currentPlayer();
  const curName = escapeHtml(cur?.name ?? '');

  if (s.phase === 'gameover') {
    status.innerHTML = '对局结束';
  } else if (store.room?.resumeWaiting) {
    status.innerHTML = '等待其他玩家从大厅输入存档码加入…';
  } else if (mine) {
    if (s.phase === 'roll') {
      show('btnRoll', true);
      if (cur?.inJail) show('jailActions', true);
      status.innerHTML = cur?.inJail
        ? '你在监狱中：掷出<b>双数</b>即可出狱（第 ' + (cur.jailTurns + 1) + ' 次尝试）'
        : (s.lastRoll?.doubles ? '🎉 双数！再来一次' : '轮到你了，掷骰子吧！');
    } else if (s.phase === 'buy') {
      const t = BOARD[s.pending.tile];
      show('btnBuy', s.players[s.turn].money >= t.price);
      show('btnDecline', true);
      status.innerHTML = `是否买下「<b>${t.name}</b>」（¥${t.price.toLocaleString('en-US')}）？`;
    } else if (s.phase === 'end') {
      show('btnEnd', true);
      status.innerHTML = '本回合结束前，可点击地产进行<b>建房/抵押</b>经营';
    }
  } else {
    status.innerHTML = `等待 <b>${curName}</b> 行动…`;
  }
}

function highlightCurrent() {
  // 高亮在 main.js 的 3D 层处理；这里仅占位保持接口一致
}

/* ---------- 公告 ---------- */

export function announce(html, cls = '') {
  const box = $('announce');
  const el = document.createElement('div');
  el.className = 'announce-item ' + cls;
  el.innerHTML = html;
  box.appendChild(el);
  setTimeout(() => el.classList.add('fade'), 2100);
  setTimeout(() => el.remove(), 2600);
  while (box.children.length > 3) box.firstChild.remove();
}

/** 卡牌展示（机会/命运） */
export function showCard(playerName, card, deckName) {
  const box = $('announce');
  const el = document.createElement('div');
  el.className = 'announce-item gold';
  el.style.maxWidth = '420px';
  el.style.borderRadius = '18px';
  el.innerHTML = `
    <div style="font-size:12px;letter-spacing:3px;opacity:.8">${deckName === 'chance' ? '❓ 机会' : '🎁 命运'}</div>
    <div style="font-size:20px;font-weight:900;margin:4px 0">${card.title}</div>
    <div style="font-size:14px;opacity:.9">${card.text}</div>
    <div style="font-size:11px;margin-top:6px;opacity:.6">—— ${escapeHtml(playerName)} 抽取</div>`;
  box.appendChild(el);
  setTimeout(() => el.classList.add('fade'), 3200);
  setTimeout(() => el.remove(), 3800);
}

/* ---------- 地契卡 ---------- */

export function openDeed(tileIndex) {
  const t = BOARD[tileIndex];
  const s = store.snap;
  const modal = $('deedModal');
  const deed = $('deedCard');
  const info = s?.props?.[tileIndex];
  const owner = info ? playerById(info.owner) : null;

  const isProp = t.type === 'prop';
  const grp = isProp ? GROUPS[t.group] : null;
  const headColor = grp ? '#' + grp.color.toString(16).padStart(6, '0')
    : t.type === 'station' ? '#3c4664' : t.type === 'utility' ? '#4a6a8a' : '#5a5a6a';

  let rows = '';
  const row = (k, v, hi = false) => `<div class="deed-row${hi ? ' rent-hi' : ''}"><span>${k}</span><b>${v}</b></div>`;

  if (isProp) {
    rows = row('空地租金', '¥' + t.rent.toLocaleString())
      + row('集齐同色', '¥' + (t.rent * 2).toLocaleString())
      + [1, 2, 3, 4].map((i) => row(`${i} 栋房屋`, '¥' + t.rents[i - 1].toLocaleString())).join('')
      + row('🏨 酒店', '¥' + t.rents[4].toLocaleString(), true)
      + row('每栋造价', '¥' + GROUPS[t.group].houseCost.toLocaleString());
  } else if (t.type === 'station') {
    rows = row('拥有 1 座', '¥250') + row('拥有 2 座', '¥500') + row('拥有 3 座', '¥1000') + row('拥有 4 座', '¥2000', true);
  } else if (t.type === 'utility') {
    rows = row('拥有 1 家', '骰子点数 ×40') + row('拥有 2 家', '骰子点数 ×100', true);
  } else if (t.type === 'tax') {
    rows = row('缴纳金额', '¥' + t.amount.toLocaleString(), true);
  } else {
    rows = row('类型', t.type === 'chance' ? '机会卡' : t.type === 'fate' ? '命运卡' : '功能格');
  }

  let ownerLine = '<div class="deed-owner">🏛️ 无主之地，等待有缘人</div>';
  if (owner) {
    ownerLine = `<div class="deed-owner" style="border-left:3px solid ${owner.color}">业主：<b>${escapeHtml(owner.name)}</b>
      ${info.mortgaged ? '<span class="mortgaged-tag">（已抵押 🏦）</span>' : ''}
      ${info.houses ? ` · ${info.houses >= 5 ? '🏨 酒店' : '🏠×' + info.houses}` : ''}</div>`;
  }

  // 经营按钮（自己回合且属于自己的地产）
  let actions = '';
  const canManage = s && owner && owner.id === store.me?.id && isMyTurn() && ['roll', 'end'].includes(s.phase);
  if (canManage && isProp) {
    const cost = GROUPS[t.group].houseCost;
    // 新规则：买过就能建房，只要未抵押且未到酒店即可点击
    let buildBtn = '';
    if (info.houses < 5 && !info.mortgaged) {
      buildBtn = `<button class="btn btn-gold btn-mini" data-act="build">建房 ¥${cost.toLocaleString()}</button>`;
    }
    actions = `<div class="deed-actions">
      ${buildBtn}
      ${info.houses > 0 ? `<button class="btn btn-glass btn-mini" data-act="sellHouse">拆房退 ¥${cost / 2}</button>` : ''}
      ${!info.mortgaged ? `<button class="btn btn-glass btn-mini" data-act="mortgage">抵押 +¥${(t.price / 2).toLocaleString()}</button>`
        : `<button class="btn btn-gold btn-mini" data-act="unmortgage">赎回 -¥${Math.ceil(t.price / 2 * 1.1).toLocaleString()}</button>`}
    </div>`;
  } else if (s?.phase === 'buy' && s.pending?.tile === tileIndex && isMyTurn()) {
    actions = `<div class="deed-actions"><button class="btn btn-gold btn-mini" id="deedBuy">💸 买下 ¥${t.price.toLocaleString()}</button>
      <button class="btn btn-glass btn-mini" id="deedPass">放弃</button></div>`;
  }

  deed.innerHTML = `
    <div class="deed-head" style="background:linear-gradient(160deg, ${headColor}, ${headColor}cc)">
      <div class="dtitle">TITLE DEED · ${t.type === 'prop' ? '地产契据' : t.type === 'station' ? '交通枢纽' : t.type === 'utility' ? '公用事业' : '格位'}</div>
      <div class="dname">${t.name}</div>
    </div>
    <div class="deed-body">
      ${rows}
      ${ownerLine}
      ${actions}
      <div class="deed-actions"><button class="btn btn-mini ghost" id="deedClose">关闭</button></div>
    </div>`;

  deed.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      socket.emit('game:action', { action: b.dataset.act, tile: tileIndex });
      closeDeed();
    };
  });
  deed.querySelector('#deedBuy')?.addEventListener('click', () => { socket.emit('game:action', { action: 'buy' }); closeDeed(); });
  deed.querySelector('#deedPass')?.addEventListener('click', () => { socket.emit('game:action', { action: 'decline' }); closeDeed(); });
  deed.querySelector('#deedClose')?.addEventListener('click', closeDeed);

  modal.classList.remove('hidden');
}

export function closeDeed() { $('deedModal').classList.add('hidden'); }

/* ---------- 结算 ---------- */

export function gameOver(ranking, winnerId) {
  const modal = $('overModal');
  const title = $('overTitle');
  const w = playerById(winnerId);
  title.innerHTML = winnerId === store.me?.id ? '🏆 你赢了！' : `🏆 ${escapeHtml(w?.name ?? '')} 获胜！`;
  const box = $('overRanking');
  box.innerHTML = '';
  (ranking || []).forEach((r, i) => {
    const p = playerById(r.id);
    if (!p) return;
    const rowEl = document.createElement('div');
    rowEl.className = 'over-row' + (r.id === winnerId ? ' winner' : '');
    rowEl.innerHTML = `
      <span class="medal">${['🥇', '🥈', '🥉'][i] || '🎖️'}</span>
      <div class="dot" style="background:${p.color}"></div>
      <b>${escapeHtml(p.name)}</b>
      <span class="worth">¥ ${r.worth.toLocaleString('en-US')}</span>`;
    box.appendChild(rowEl);
  });
  modal.classList.remove('hidden');
}
