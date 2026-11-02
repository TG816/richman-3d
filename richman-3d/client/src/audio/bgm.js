import { toast } from '../game/store.js';

/** 背景音乐仅在本机播放；每次加载页面默认关闭，点击后才加载音频。 */
export function initBgm() {
  const audio = new Audio();
  audio.preload = 'none';
  audio.loop = true;
  audio.volume = 0.25;
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
  document.body.appendChild(button);
}
