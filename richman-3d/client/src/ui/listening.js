import { voice } from '../net/voice.js';
import { store } from '../game/store.js';

/** 大厅和对局共用的本地收听控件；默认音量 100%，不屏蔽。 */
export function listeningControls(player) {
  const box = document.createElement('div');
  box.className = 'listening-controls';
  if (player.id === store.me?.id) return box;
  const label = document.createElement('label');
  const caption = document.createElement('span');
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100'; slider.step = '1';
  slider.setAttribute('aria-label', `${player.name} 的本地收听音量`);
  const mute = document.createElement('button');
  mute.type = 'button'; mute.className = 'btn btn-mini';
  const refresh = () => {
    const current = voice.listening.get(player.id);
    // 静音只改变显示和播放状态，保留原音量供解除静音时恢复。
    const percent = current.muted ? 0 : Math.round(current.volume * 100);
    slider.value = String(percent);
    slider.disabled = current.muted;
    caption.textContent = `收听 ${percent}%`;
    slider.title = current.muted ? '取消本地静音后恢复原音量' : '调整此队友的收听音量';
    mute.textContent = current.muted ? '取消本地静音' : '本地静音';
    mute.setAttribute('aria-pressed', String(current.muted));
    mute.setAttribute('aria-label', `${player.name}：${mute.textContent}`);
  };
  slider.oninput = () => { voice.setListening(player.id, { volume: Number(slider.value) / 100 }); refresh(); };
  mute.onclick = () => { voice.setListening(player.id, { muted: !voice.listening.get(player.id).muted }); refresh(); };
  box.title = '只影响你听到的声音，不会关闭队友的麦克风';
  label.append(caption, slider); box.append(label, mute); refresh();
  const status = document.createElement('span');
  status.dataset.voiceStatus = player.sid;
  status.textContent = `语音：${voice.getStatus(player.sid)}`;
  status.setAttribute('aria-live', 'polite');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'btn btn-mini'; retry.textContent = '重试语音';
  retry.onclick = () => { voice.resumeAll(); voice.retryPeer(player.sid); };
  box.append(status, retry);
  return box;
}
