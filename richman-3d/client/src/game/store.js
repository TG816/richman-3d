/**
 * 轻量事件总线 + 全局状态。
 * 服务端快照（snapshot）是唯一权威数据；3D 动画由事件流驱动。
 */
export const bus = new EventTarget();
export const on = (ev, fn) => bus.addEventListener(ev, (e) => fn(e.detail));
export const emit = (ev, detail) => bus.dispatchEvent(new CustomEvent(ev, { detail }));

export const store = {
  screen: 'lobby',          // lobby | game
  room: null,               // {code, players:[{id,name,avatarId}], hostSid, started}
  me: null,                 // {id, name, avatarId} —— 本人在房间中的身份
  snap: null,               // 引擎快照
  timer: null,              // {deadline, seconds}
  chat: [],                 // [{id,from,name,text,ts}]
  muted: false,
  soundOn: true,
};

export function myPlayerId() {
  return store.me?.id ?? null;
}

export function isMyTurn() {
  if (!store.snap || !store.me) return false;
  return store.snap.players[store.snap.turn]?.id === store.me.id;
}

/** 当前玩家信息 */
export function currentPlayer() {
  return store.snap?.players?.[store.snap.turn] ?? null;
}

export function playerById(id) {
  return store.snap?.players.find((p) => p.id === id) ?? store.room?.players.find((p) => p.id === id) ?? null;
}

export function toast(text, warn = false) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (warn ? ' warn' : '');
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .4s, transform .4s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 420);
  }, 2600);
  if (box.children.length > 4) box.firstChild.remove();
}
