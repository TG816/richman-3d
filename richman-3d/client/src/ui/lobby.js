import { AVATARS } from '@board';
import { socket, emitAck, on } from '../net/socket.js';
import { NET } from '../net/config.js';
import { store, emit, toast } from '../game/store.js';

/** 大厅：昵称 / 角色选择 / 创建与加入房间 / 房间等待面板 */
export function initLobby() {
  const $ = (id) => document.getElementById(id);
  const nameInput = $('nameInput');
  const codeInput = $('codeInput');
  const errEl = $('lobbyError');
  const formEl = $('lobbyForm');
  const roomEl = $('lobbyRoom');

  nameInput.value = localStorage.getItem('richman.name') || '';
  let avatarId = localStorage.getItem('richman.avatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)].id;
  if (!AVATARS.some((a) => a.id === avatarId)) avatarId = AVATARS[0].id;

  /* 角色选择行 */
  const row = $('avatarRow');
  for (const a of AVATARS) {
    const el = document.createElement('div');
    el.className = 'avatar' + (a.id === avatarId ? ' selected' : '');
    el.dataset.id = a.id;
    el.title = a.name;
    el.innerHTML = `<div class="dot" style="background:${a.color}"></div>`;
    el.onclick = () => {
      avatarId = a.id;
      row.querySelectorAll('.avatar').forEach((x) => x.classList.toggle('selected', x.dataset.id === a.id));
      sfxClick();
    };
    row.appendChild(el);
  }

  /* URL 带 ?room=XXXX 自动填码 */
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) codeInput.value = urlRoom.toUpperCase();

  function savePrefs() {
    localStorage.setItem('richman.name', nameInput.value.trim());
    localStorage.setItem('richman.avatar', avatarId);
  }

  const myName = () => nameInput.value.trim() || '玩家' + Math.floor(Math.random() * 90 + 10);

  /** 进新房间前先离开旧房间（防止两房事件串流） */
  function leaveCurrentRoom() {
    if (!store.room) return;
    socket.emit('room:leave');
    store.room = null;
    store.me = null;
    store.snap = null;
    store.chat = [];
    sessionStorage.removeItem('richman.session');
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('lobby').classList.remove('hidden');
    emit('room-switch'); // 清空动画队列/弹窗等旧房间残留
  }

  $('btnCreate').onclick = async () => {
    savePrefs();
    leaveCurrentRoom();
    const res = await emitAck('room:create', { name: myName(), avatarId });
    if (!res.ok) return showErr(res.error);
    enterRoom(res);
  };

  $('btnJoin').onclick = async () => {
    savePrefs();
    leaveCurrentRoom();
    const code = codeInput.value.trim().toUpperCase();
    if (code.length !== 4) return showErr('请输入 4 位房间码');
    const res = await emitAck('room:join', { code, name: myName(), avatarId });
    if (!res.ok) return showErr(res.error);
    enterRoom(res);
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnCreate').click(); });

  $('btnCopy').onclick = async () => {
    if (!store.room) return;
    const link = NET.inviteUrl(store.room.code);
    try {
      await navigator.clipboard.writeText(link);
      toast('邀请链接已复制，发给朋友吧！');
    } catch {
      toast(`房间码：${store.room.code}（复制失败，请手动记录）`, true);
    }
  };

  $('btnStart').onclick = async () => {
    const res = await emitAck('game:start');
    if (!res.ok) toast(res.error, true);
  };

  $('btnLeave').onclick = () => {
    socket.emit('room:leave');
    sessionStorage.removeItem('richman.session');
    store.room = null;
    store.me = null;
    formEl.classList.remove('hidden');
    roomEl.classList.add('hidden');
  };

  /* 房间状态刷新（进出人员） */
  on('room:state', (room) => {
    if (!store.room || room.code !== store.room.code) return;
    store.room = room;
    renderRoom();
  });

  function enterRoom(res) {
    errEl.textContent = '';
    store.room = res.room;
    store.me = res.me;
    // 持久化会话（本标签页）：掉线自动重连时找回席位
    sessionStorage.setItem('richman.session', JSON.stringify({
      code: res.room.code, playerId: res.me.id, name: myName(), avatarId,
    }));
    formEl.classList.add('hidden');
    roomEl.classList.remove('hidden');
    if (res.chat?.length) store.chat.push(...res.chat);
    emit('room', res.room); // 通知语音层进房
    renderRoom();
  }

  function renderRoom() {
    const room = store.room;
    if (!room) return;
    $('roomCode').textContent = room.code;
    const list = $('playerList');
    list.innerHTML = '';
    room.players.forEach((p, i) => {
      const av = AVATARS.find((a) => a.id === p.avatarId) || AVATARS[0];
      const chip = document.createElement('div');
      chip.className = 'pchip';
      chip.innerHTML = `<div class="dot" style="background:${av.color}"></div><b>${escapeHtml(p.name)}</b>${i === 0 ? '<span class="host">房主</span>' : ''}${p.id === store.me?.id ? '<span class="host" style="color:#9aa3c7;border-color:#3a4470">我</span>' : ''}`;
      list.appendChild(chip);
    });
    const isHost = room.players[0]?.id === store.me?.id;
    $('btnStart').classList.toggle('hidden', !isHost);
    $('btnStart').disabled = room.players.length < 2;
    $('waitHost').classList.toggle('hidden', isHost);
    if (isHost && room.players.length < 2) $('btnStart').textContent = '等待更多玩家…';
    else $('btnStart').textContent = '🚀 开始对局';
    // 已被占用的角色置灰
    const taken = new Set(room.players.map((p) => p.avatarId));
    row.querySelectorAll('.avatar').forEach((el) => {
      el.classList.toggle('taken', taken.has(el.dataset.id) && el.dataset.id !== store.me?.avatarId);
    });
  }

  function showErr(msg) { errEl.textContent = msg || '出错了，请重试'; }

  function sfxClick() { import('../audio/sfx.js').then(({ sfx }) => sfx.click()); }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 对局结束/离开后回到大厅 */
export function backToLobby() {
  sessionStorage.removeItem('richman.session');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('lobby').classList.remove('hidden');
  document.getElementById('lobbyForm').classList.remove('hidden');
  document.getElementById('lobbyRoom').classList.add('hidden');
  store.room = null;
  store.me = null;
  store.snap = null;
  store.screen = 'lobby';
  store.chat = [];
  emit('screen', 'lobby');
}
