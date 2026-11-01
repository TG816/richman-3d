import { voice } from '../net/voice.js';
import { store } from '../game/store.js';

/** 大厅和对局共用的本地收听控件；默认音量 100%，不屏蔽。 */
export function listeningControls(player) {
  const box = document.createElement('div');
  box.className = 'listening-controls';
  if (player.id === store.me?.id) return box;
  const setting = voice.listening.get(player.id);
  const label = document.createElement('label');
  const caption = document.createElement('span');
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
  slider.value = String(Math.round(setting.volume * 100));
  slider.setAttribute('aria-label', `${player.name} 的本地收听音量`);
  const mute = document.createElement('button');
  mute.type = 'button'; mute.className = 'btn btn-mini';
  const refresh = () => {
    const current = voice.listening.get(player.id);
    caption.textContent = `收听 ${Math.round(current.volume * 100)}%`;
    mute.textContent = current.muted ? '取消本地静音' : '本地静音';
    mute.setAttribute('aria-pressed', String(current.muted));
    mute.setAttribute('aria-label', `${player.name}：${mute.textContent}`);
  };
  slider.oninput = () => { voice.setListening(player.id, { volume: Number(slider.value) / 100 }); refresh(); };
  mute.onclick = () => { voice.setListening(player.id, { muted: !voice.listening.get(player.id).muted }); refresh(); };
  box.title = '只影响你听到的声音，不会关闭队友的麦克风';
  label.append(caption, slider); box.append(label, mute); refresh();
  return box;
}
