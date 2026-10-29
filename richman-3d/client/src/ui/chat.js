import { AVATARS } from '@board';
import { socket } from '../net/socket.js';
import { store, on, toast } from '../game/store.js';
import { escapeHtml } from './lobby.js';

const $ = (id) => document.getElementById(id);
const EMOJIS = ['🎲', '🏠', '💰', '😂', '👍', '😭', '🎉', '😈'];

/** 文字聊天 + 战报抽屉 */
export function initChat() {
  const drawer = $('chatDrawer');
  $('btnChat').onclick = () => {
    drawer.classList.toggle('hidden');
    if (!drawer.classList.contains('hidden')) {
      $('chatInput').focus();
      markRead();
    }
  };
  $('btnChatClose').onclick = () => drawer.classList.add('hidden');

  document.querySelectorAll('.chat-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.chat-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const isChat = tab.dataset.tab === 'chat';
      $('chatList').classList.toggle('hidden', !isChat);
      $('logList').classList.toggle('hidden', isChat);
    };
  });

  const input = $('chatInput');
  const send = () => {
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chat:msg', { text });
    input.value = '';
  };
  $('btnSend').onclick = send;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

  const emojiRow = $('emojiRow');
  for (const em of EMOJIS) {
    const b = document.createElement('button');
    b.textContent = em;
    b.onclick = () => { input.value += em; input.focus(); };
    emojiRow.appendChild(b);
  }

  let unread = 0;
  on('chat', (msg) => {
    store.chat.push(msg);
    if (store.chat.length > 200) store.chat.shift();
    appendMsg(msg);
    if (drawer.classList.contains('hidden')) {
      unread++;
      $('btnChat').textContent = '💬' + (unread > 9 ? '9+' : unread);
      if (msg.from !== store.me?.id) import('../audio/sfx.js').then(({ sfx }) => sfx.msg());
    }
  });
  function markRead() { unread = 0; $('btnChat').textContent = '💬'; }

  on('state', (snap) => renderLog(snap));
}

function appendMsg(msg) {
  const list = $('chatList');
  const av = AVATARS.find((a) => a.id === msg.avatarId) || AVATARS[0];
  const el = document.createElement('div');
  el.className = 'cmsg' + (msg.from === store.me?.id ? ' mine' : '');
  el.dataset.msgId = msg.id;
  el.innerHTML = `
    <div class="dot" style="background:${av.color}"></div>
    <div class="bubble">
      <div class="cname">${escapeHtml(msg.name)}</div>
      <div class="ctext">${escapeHtml(msg.text)}</div>
    </div>`;
  list.appendChild(el);
  list.scrollTop = list.scrollHeight;
  while (list.children.length > 120) list.firstChild.remove();
}

function renderLog(snap) {
  if (!snap?.log) return;
  const list = $('logList');
  list.innerHTML = '';
  for (const line of snap.log.slice(-60)) {
    const el = document.createElement('div');
    el.className = 'logline';
    const t = new Date(line.ts);
    el.innerHTML = `<span style="opacity:.5">${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}</span> ${escapeHtml(line.text)}`;
    list.appendChild(el);
  }
  list.scrollTop = list.scrollHeight;
}
