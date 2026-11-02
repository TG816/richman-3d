import { toast } from '../game/store.js';

/** 背景音乐仅在本机播放；每次加载页面默认关闭，点击后才加载音频。 */
export function initBgm() {
  const audio = new Audio();
  audio.preload = 'none';
  audio.loop = true;
  audio.volume = 0.25;
  const panel = document.createElement('div');
  panel.className = 'bgm-panel';
  const label = document.createElement('label');
  label.className = 'bgm-volume';
  const caption = document.createElement('span');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0'; slider.max = '100'; slider.step = '1'; slider.value = '25';
  slider.setAttribute('aria-label', '背景音乐音量');
  const updateVolume = () => {
    // 仅调节音量，不触发播放；关闭音乐期间也能预先设置。
    audio.volume = Number(slider.value) / 100;
    caption.textContent = `音乐音量 ${slider.value}%`;
    slider.setAttribute('aria-valuetext', `${slider.value}%`);
  };
  slider.addEventListener('input', updateVolume);
  updateVolume();
  label.append(caption, slider);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bgm-toggle';
  button.title = '播放或暂停《朋友的酒》，仅自己听到';
  const render = () => {
    const playing = !audio.paused;
    button.textContent = playing ? '♫ 背景音乐：开' : '♫ 背景音乐：关';
    button.setAttribute('aria-pressed', String(playing));
    button.setAttribute('aria-label', playing ? '关闭背景音乐《朋友的酒》' : '播放背景音乐《朋友的酒》');
  };
  button.onclick = async () => {
    if (!audio.paused) { audio.pause(); render(); return; }
    button.disabled = true;
    try {
      if (!audio.getAttribute('src')) audio.src = `${import.meta.env.BASE_URL}music/peng-you-de-jiu.mp3`;
      await audio.play();
    } catch {
      audio.pause();
      toast('背景音乐播放失败，请检查音频是否加载成功后重试', true);
    } finally { button.disabled = false; render(); }
  };
  audio.addEventListener('pause', render);
  audio.addEventListener('playing', render);
  audio.addEventListener('error', () => { audio.pause(); render(); });
  addEventListener('pagehide', () => audio.pause());
  render();
  panel.append(label, button);
  document.body.appendChild(panel);
}
