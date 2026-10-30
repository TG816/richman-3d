import { socket } from '../net/socket.js';
// 注意：on 必须来自 store 事件总线——进房通知 emit('room') 走的是 bus，不是 Socket.IO；
// 之前误从 socket.js 导入 on，导致 socket.on('room') 永远收不到、voice:hello 不发、P2P 连接从未建立
import { store, toast, on } from '../game/store.js';

/**
 * 实时语音（WebRTC P2P mesh，信令走 Socket.IO）。
 * 设计要点：
 *  - 进入房间即建链：连接里始终有一条音频轨道——未开麦时是"静音占位轨"，
 *    开麦后用 replaceTrack 热替换为麦克风轨，避免二次协商（glare / renegotiation）。
 *  - 由后进房的成员主动发 offer（voice:peers），先进房者被动应答，天然避免双 offer。
 *  - localhost 属安全上下文可直接取麦；部署到服务器必须 HTTPS，NAT 复杂时可加 TURN（预留）。
 */
// 自建 coturn（阿里云 ECS）：P2P 打洞失败时媒体流走这里中继。
// 信令仍走 Cloudflare Tunnel，但 WebRTC 的 UDP 媒体流不经 tunnel，直接连 ECS 公网 IP 的 3478。
const ICE_SERVERS = [
  { urls: 'stun:47.86.33.146:3478' },
  { urls: 'turn:47.86.33.146:3478', username: 'richman', credential: 'Richman2026' },
  { urls: 'turn:47.86.33.146:3478?transport=tcp', username: 'richman', credential: 'Richman2026' },
];

// 麦克风采集约束：单声道语音 + 浏览器音频处理全开，抑制回声/啸叫/杂音
const MIC_CONSTRAINTS = {
  channelCount: 1,            // 单声道：通话足够，且回声消除在单声道下更稳定
  echoCancellation: true,     // AEC3 声学回声消除，压外放→麦克的回路
  noiseSuppression: true,     // 噪声抑制，去环境杂音
  autoGainControl: true,      // 自动增益，自动把过小的人声拉到合适电平
  // Chromium（Chrome/Edge）legacy 约束，核心已由上面标准项覆盖，这里做兼容增强；未知项浏览器会忽略
  googHighpassFilter: true,   // 高通滤波，切除低频轰隆声，让声音更干净
  googEchoCancellation: true,
  googNoiseSuppression: true,
  googAutoGainControl: true,
};

class Voice {
  constructor() {
    this.wired = false;
    this.peers = new Map();      // sid -> RTCPeerConnection
    this.audios = new Map();     // sid -> <audio>（可靠播放，浏览器自动处理 autoplay/手势/track 热切换）
    this.analysers = new Map();  // sid -> 说话检测 {ctx, an, data}（只分析不出声，独立于播放）
    this.micTrack = null;        // 开麦后的麦克风轨
    this.open = false;
    this._pending = new Map();   // sid -> [candidate]（远端描述就绪前缓存）
  }

  /* ---------- 共享静音轨 ---------- */
  silentTrack() {
    if (this._silent) return this._silent;
    const ctx = new AudioContext();
    const dst = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(dst);
    osc.start();
    this._silent = dst.stream.getAudioTracks()[0];
    return this._silent;
  }

  wire() {
    if (this.wired) return;
    this.wired = true;

    socket.on('connect', () => { if (store.room) socket.emit('voice:hello'); });
    on('room', () => { if (store.room && socket.connected) socket.emit('voice:hello'); });

    socket.on('voice:peers', ({ peers }) => {
      for (const sid of peers) this.connectTo(sid, true);
    });
    socket.on('voice:peer-joined', ({ peer }) => this.connectTo(peer, false));

    socket.on('voice:signal', async ({ from, data }) => {
      try {
        let pc = this.peers.get(from);
        if (data.sdp?.type === 'offer') {
          pc ||= this.connectTo(from, false);
          await pc.setRemoteDescription(data.sdp);
          await this.flushCandidates(from);
          await pc.setLocalDescription(await pc.createAnswer());
          socket.emit('voice:signal', { to: from, data: { sdp: pc.localDescription } });
        } else if (data.sdp?.type === 'answer') {
          if (pc && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(data.sdp);
            await this.flushCandidates(from);
          }
        } else if (data.candidate) {
          if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
          else this._pending.set(from, [...(this._pending.get(from) || []), data.candidate]);
        }
      } catch (err) {
        console.warn('[voice] signal error', err);
      }
    });

    socket.on('disconnect', () => this.teardown());

    // 兜底：ontrack 可能早于用户手势触发，play() 被自动播放策略拒绝后，在后续点击/按键时重试播放
    addEventListener('pointerdown', () => this.resumeAll(), { once: false });
    addEventListener('keydown', () => this.resumeAll(), { once: false });
  }

  /** 手势触发：重播被自动播放策略挂起的 audio，并恢复分析用 context */
  resumeAll() {
    for (const audio of this.audios.values()) {
      if (audio.paused) audio.play().catch(() => {});
    }
    for (const rec of this.analysers.values()) {
      rec.ctx.resume().catch(() => {});
    }
  }

  async flushCandidates(sid) {
    const list = this._pending.get(sid);
    const pc = this.peers.get(sid);
    if (list && pc) {
      for (const c of list) { try { await pc.addIceCandidate(c); } catch { /* ignore */ } }
    }
    this._pending.delete(sid);
  }

  connectTo(sid, initiator) {
    if (this.peers.has(sid)) return this.peers.get(sid);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(sid, pc);

    pc.addTrack(this.micTrack || this.silentTrack(), this.micTrack ? new MediaStream([this.micTrack]) : new MediaStream([this.silentTrack()]));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('voice:signal', { to: sid, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => {
      let audio = this.audios.get(sid);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.dataset.sid = sid;
        document.body.appendChild(audio);
        this.audios.set(sid, audio);
        this.watchSpeaking(sid, e.streams[0]);
      }
      audio.srcObject = e.streams[0];
      audio.play?.().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) this.dropPeer(sid);
    };
    if (initiator) {
      pc.onnegotiationneeded = async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer());
          socket.emit('voice:signal', { to: sid, data: { sdp: pc.localDescription } });
        } catch (err) { console.warn('[voice] offer failed', err); }
      };
    }
    return pc;
  }

  dropPeer(sid) {
    this.peers.get(sid)?.close();
    this.peers.delete(sid);
    this.audios.get(sid)?.remove();
    this.audios.delete(sid);
    const rec = this.analysers.get(sid);
    if (rec) { rec.ctx.close().catch(() => {}); this.analysers.delete(sid); }
    this.setSpeaking(sid, false);
  }

  /** 开/关麦克风。首次开麦请求权限，之后只切换轨道 enabled */
  async toggleMic() {
    if (this.open) {
      if (this.micTrack) this.micTrack.enabled = false;
      this.open = false;
      socket.emit('voice:mute', { muted: true });
      toast('🎙️ 已闭麦');
      return false;
    }
    try {
      if (!this.micTrack) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
        this.micTrack = stream.getAudioTracks()[0];
        for (const pc of this.peers.values()) {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
          if (sender) await sender.replaceTrack(this.micTrack);
        }
      } else {
        this.micTrack.enabled = true;
      }
      this.open = true;
      socket.emit('voice:mute', { muted: false });
      toast('🎤 语音已开启');
      return true;
    } catch (err) {
      toast('无法访问麦克风：' + (err.name === 'NotAllowedError' ? '权限被拒绝' : err.message), true);
      return false;
    }
  }

  teardown() {
    for (const sid of [...this.peers.keys()]) this.dropPeer(sid);
    this.open = false;
  }

  /**
   * 说话检测（绿圈提示）：独立 AudioContext 只做 analyser 分析，不接 destination、不参与播放，
   * 因此即使它的处理有异常也不会影响 audio 元素的正常出声。
   */
  watchSpeaking(sid, stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const rec = { ctx, an, data: new Uint8Array(an.frequencyBinCount) };
      this.analysers.set(sid, rec);
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const loop = () => {
        if (this.analysers.get(sid) !== rec) { ctx.close(); return; }
        an.getByteFrequencyData(rec.data);
        const avg = rec.data.reduce((s, v) => s + v, 0) / rec.data.length;
        this.setSpeaking(sid, avg > 10);
        requestAnimationFrame(loop);
      };
      loop();
    } catch { /* ignore */ }
  }

  setSpeaking(sid, speaking) {
    const el = document.querySelector(`.cmsg[data-peer="${sid}"] .dot`);
    if (el) el.classList.toggle('speaking', speaking);
  }
}

export const voice = new Voice();
