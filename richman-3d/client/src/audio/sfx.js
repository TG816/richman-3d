/**
 * 程序化音效（Web Audio 合成，零素材依赖）。
 * 首次用户手势后解锁 AudioContext。
 */
class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this._unlocked = false;
  }

  async unlock() {
    if (this._unlocked) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // 浏览器自动播放策略：即便在用户手势里创建，AudioContext 仍可能是 suspended，必须显式 resume，否则所有音效静音
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this._unlocked = true;
    } catch { /* 无音频设备时静默降级 */ }
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  get t() {
    // 兜底：播放前若发现 context 又被挂起（如切后台回来），自动恢复
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx.currentTime;
  }

  tone({ freq = 440, dur = 0.15, type = 'sine', gain = 0.2, when = 0, slide = 0, attack = 0.005 }) {
    if (!this._unlocked || !this.enabled) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t0 = this.t + when;
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  noise({ dur = 0.12, gain = 0.2, when = 0, freq = 1800, q = 1 }) {
    if (!this._unlocked || !this.enabled) return;
    const len = Math.max(1, this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start(this.t + when);
  }

  /* ---- 具体音效 ---- */
  click() { this.tone({ freq: 700, dur: 0.06, type: 'triangle', gain: 0.12 }); }
  hop() { this.tone({ freq: 380 + Math.random() * 120, dur: 0.09, type: 'sine', gain: 0.14, slide: 260 }); }
  dice() {
    this.noise({ dur: 0.3, gain: 0.16, freq: 2600, q: 0.6 });
    this.tone({ freq: 220, dur: 0.28, type: 'triangle', gain: 0.1, slide: 300 });
  }
  clack() { this.noise({ dur: 0.05, gain: 0.14, freq: 900 + Math.random() * 500, q: 2 }); }
  diceLand() {
    this.clack();
    this.tone({ freq: 520, dur: 0.12, type: 'sine', gain: 0.14 });
    this.tone({ freq: 780, dur: 0.14, type: 'sine', gain: 0.1, when: 0.07 });
  }
  coin() {
    [880, 1174.7, 1568].forEach((f, i) => this.tone({ freq: f, dur: 0.14, type: 'sine', gain: 0.16, when: i * 0.055 }));
  }
  pay() {
    [520, 392].forEach((f, i) => this.tone({ freq: f, dur: 0.2, type: 'triangle', gain: 0.15, when: i * 0.09 }));
  }
  build() {
    this.noise({ dur: 0.1, gain: 0.12, freq: 700, q: 1.5 });
    this.tone({ freq: 660, dur: 0.1, type: 'square', gain: 0.06, when: 0.08 });
    this.tone({ freq: 990, dur: 0.12, type: 'square', gain: 0.05, when: 0.16 });
  }
  card() { this.noise({ dur: 0.22, gain: 0.14, freq: 4200, q: 0.5 }); }
  whoosh() { this.noise({ dur: 0.45, gain: 0.16, freq: 1200, q: 0.4 }); }
  jail() {
    [330, 262, 220].forEach((f, i) => this.tone({ freq: f, dur: 0.22, type: 'sawtooth', gain: 0.08, when: i * 0.12 }));
  }
  turn() { this.tone({ freq: 660, dur: 0.1, type: 'sine', gain: 0.12 }); this.tone({ freq: 880, dur: 0.12, type: 'sine', gain: 0.12, when: 0.08 }); }
  win() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.16, when: i * 0.13 }));
  }
  lose() {
    [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: 0.4, type: 'sawtooth', gain: 0.07, when: i * 0.18 }));
  }
  msg() { this.tone({ freq: 940, dur: 0.07, type: 'sine', gain: 0.09 }); this.tone({ freq: 1240, dur: 0.09, type: 'sine', gain: 0.09, when: 0.06 }); }
}

export const sfx = new Sfx();
