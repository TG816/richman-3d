import { socket, on } from '../net/socket.js';
import { store, toast } from '../game/store.js';

/**
 * 实时语音（WebRTC P2P mesh，信令走 Socket.IO）。
 * 设计要点：
 *  - 进入房间即建链：连接里始终有一条音频轨道——未开麦时是"静音占位轨"，
 *    开麦后用 replaceTrack 热替换为麦克风轨，避免二次协商（glare / renegotiation）。
 *  - 由后进房的成员主动发 offer（voice:peers），先进房者被动应答，天然避免双 offer。
 *  - localhost 属安全上下文可直接取麦；部署到服务器必须 HTTPS，NAT 复杂时可加 TURN（预留）。
 */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.qq.com:3478' },
];

class Voice {
  constructor() {
    this.wired = false;
    this.peers = new Map();      // sid -> RTCPeerConnection
    this.audios = new Map();     // sid -> <audio>
    this.analysers = new Map();  // sid -> analyser record
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
    this.analysers.delete(sid);
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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
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

  /** 对端音量检测 → 聊天面板绿圈提示 */
  watchSpeaking(sid, stream) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const rec = { an, data: new Uint8Array(an.frequencyBinCount) };
      this.analysers.set(sid, rec);
      const loop = () => {
        if (this.analysers.get(sid) !== rec) { ctx.close(); return; }
        rec.an.getByteFrequencyData(rec.data);
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
