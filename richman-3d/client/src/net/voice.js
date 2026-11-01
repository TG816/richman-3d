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

// ICE 断线恢复参数（业界分层恢复阶梯）
const DISCONNECT_WAIT_MS = 4000; // disconnected 后先等 4 秒看能否自动恢复，避免短暂抖动就 restart
const RESTART_DEADLINE_MS = 5000; // 一次 ICE restart 的硬截止，超时仍未恢复则升级
const MAX_RESTARTS = 2;           // 同一连接最多连续 restart 次数，超过则强制 socket 完整重连
const LOWPASS_FREQ = 8000;        // 发送低通截止频率（Hz）：人声能量主要在 8k 以下，更高的尖锐噪声/嘶声被滤除

class Voice {
  constructor() {
    this.wired = false;
    this.peers = new Map();      // sid -> RTCPeerConnection
    this.audios = new Map();     // sid -> <audio>（可靠播放，浏览器自动处理 autoplay/手势/track 热切换）
    this.analysers = new Map();  // sid -> 说话检测 {ctx, an, data}（只分析不出声，独立于播放）
    this.micTrack = null;        // 实际发送的麦克风轨（经 lowpass 处理后的输出轨）
    this.rawMicTrack = null;     // getUserMedia 原始轨（处理管线输入，关闭时需 stop）
    this.micCtx = null;          // 发送处理用 AudioContext（lowpass 链路）
    this.open = false;
    this._toggling = false;      // 开/关麦进行中标志：防止快速点击重复 getUserMedia
    this._pending = new Map();   // sid -> [candidate]（远端描述就绪前缓存）
    this.socketOffline = false;  // 信令 socket 是否处于断线状态（用于重连后重建）
  }

  /* ---------- 共享静音轨 ---------- */
  silentTrack() {
    if (this._silent) return this._silent;
    this._silentCtx = new AudioContext(); // 保存引用，teardown 时一并关闭，避免上下文泄漏
    const ctx = this._silentCtx;
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

    socket.on('connect', () => {
      if (!this.socketOffline) return; // 首次连接无需处理
      this.socketOffline = false;
      // 重连后 socket.id 已变，旧 P2P 连接全部失效：清理后由 on('room')（rejoin 成功后）重新 hello 建链
      this.resetPeers();
      toast('已重新连接');
    });
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
        } else if (data.restart) {
          this.restartIce(from); // 对端请求本方（offer 方）执行 ICE restart
        }
      } catch (err) {
        console.warn('[voice] signal error', err);
      }
    });

    socket.on('disconnect', () => {
      // 不立即销毁：Socket.IO 会自动重连，标记离线等待；媒体连接在重连后统一重建
      this.socketOffline = true;
      toast('网络断开，正在重连…', true);
    });

    // 浏览器级网络状态特征：系统网卡恢复时确保 Socket.IO 立即重连（Socket.IO 本身也会自动探测）
    addEventListener('online', () => {
      toast('网络已恢复，正在连接…');
      if (!socket.connected) socket.connect();
    });
    addEventListener('offline', () => toast('网络已断开', true));

    // 兜底：ontrack 可能早于用户手势触发，play() 被自动播放策略拒绝后，在后续点击/按键时重试播放
    addEventListener('pointerdown', () => this.resumeAll(), { once: false });
    addEventListener('keydown', () => this.resumeAll(), { once: false });

    // 直接关标签页/浏览器时兜底释放连接与麦克风（正常退出走按钮 teardown，这里防直接关页面）
    addEventListener('pagehide', () => this.teardown());
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
    pc._initiator = initiator; // 记录 offer 方：ICE restart 只由该端发起，避免双 offer 冲突
    pc._disconnectTimer = null;
    pc._restartAttempts = 0;
    pc.oniceconnectionstatechange = () => {
      const st = pc.iceConnectionState;
      clearTimeout(pc._disconnectTimer);
      if (st === 'connected' || st === 'completed' || st === 'checking') { pc._restartAttempts = 0; return; } // 已恢复/检查中
      if (st === 'disconnected') {
        // disconnected 多为临时抖动：先等待自动恢复，不立即 restart（否则会把轻微抖动放大成可见中断）
        pc._disconnectTimer = setTimeout(() => {
          if (pc.iceConnectionState === 'disconnected') this.requestRestart(sid);
        }, DISCONNECT_WAIT_MS);
      } else if (st === 'failed') {
        this.requestRestart(sid); // 持续失败：立即请求 restart
      }
    };
    pc.onconnectionstatechange = () => {
      // 只有真正 closed（对端离开/主动关闭）才清理；failed 交给上面的 restart 处理
      if (pc.connectionState === 'closed') this.dropPeer(sid);
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

  /** 重连后清理全部失效的旧连接（新 socket.id 已变，旧 PeerConnection 无法复用） */
  resetPeers() {
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
  }

  /** 统一发起 restart 请求：offer 方自己 restart，非 offer 方请对方代发起 */
  requestRestart(sid) {
    const pc = this.peers.get(sid);
    if (!pc || pc._restarting) return;
    if (pc._initiator) this.restartIce(sid);
    else socket.emit('voice:signal', { to: sid, data: { restart: true } });
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

  /** ICE 失败后重新协商恢复（仅 offer 方调用，复用现有 offer/answer 信令）；带硬截止与升级 */
  async restartIce(sid) {
    const pc = this.peers.get(sid);
    if (!pc || pc._restarting) return;
    if (pc._restartAttempts >= MAX_RESTARTS) return this.fullReconnect(); // 连续 restart 救不回，升级
    pc._restartAttempts += 1;
    pc._restarting = true;
    let deadline;
    try {
      // iceRestart 生成新的 ufrag/pwd，强制重新收集候选并检查连通性；对端走常规 offer 分支回 answer
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      socket.emit('voice:signal', { to: sid, data: { sdp: pc.localDescription } });
      await new Promise((resolve) => { deadline = setTimeout(resolve, RESTART_DEADLINE_MS); }); // 硬截止
    } catch (err) {
      console.warn('[voice] ICE restart failed', err);
    } finally {
      clearTimeout(deadline);
      pc._restarting = false; // 先释放防重入锁，下面才能触发下一轮
    }
    // 到点仍未恢复则触发下一轮（_restarting 已释放）；attempts 达上限后 requestRestart 路径会升级到 fullReconnect
    if (this.peers.get(sid) === pc && !['connected', 'completed'].includes(pc.iceConnectionState)) {
      this.requestRestart(sid);
    }
  }

  /** Tier 2：ICE restart 无法恢复时，强制信令 socket 重连，走完整 rejoin + 重新建链 */
  fullReconnect() {
    toast('连接不稳定，正在重新建立…', true);
    this.resetPeers();
    if (socket.connected) { socket.disconnect(); socket.connect(); }
    else socket.connect();
  }

  /** 首次开麦：getUserMedia 取原始轨，经 lowpass 处理得发送轨，再热替换进所有连接 */
  async openMicPipeline() {
    const rawStream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    this.rawMicTrack = rawStream.getAudioTracks()[0];
    // 发送链路 AudioContext（在点击手势中创建，确保 running）：source → lowpass → 输出
    const ctx = new AudioContext();
    if (ctx.state !== 'running') await ctx.resume();
    const src = ctx.createMediaStreamSource(rawStream);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';                       // 低通：8kHz 以下通过，以上衰减
    lp.frequency.value = LOWPASS_FREQ;
    lp.Q.value = 0.7;
    const dest = ctx.createMediaStreamDestination();
    src.connect(lp).connect(dest);
    this.micCtx = ctx;
    this.micTrack = dest.stream.getAudioTracks()[0]; // 滤掉高频后的发送轨
    for (const pc of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
      if (sender) await sender.replaceTrack(this.micTrack);
    }
  }

  /** 开/关麦克风。首次开麦建处理管线，之后只切换发送轨 enabled；防快速点击重入 */
  async toggleMic() {
    if (this._toggling) return this.open; // 上一次切换未完成，忽略本次点击（防抖）
    this._toggling = true;
    try {
      if (this.open) {
        if (this.micTrack) this.micTrack.enabled = false;
        this.open = false;
        socket.emit('voice:mute', { muted: true });
        toast('🎙️ 已闭麦');
        return false;
      }
      try {
        if (!this.micTrack) await this.openMicPipeline();
        else this.micTrack.enabled = true;
        this.open = true;
        socket.emit('voice:mute', { muted: false });
        toast('🎤 语音已开启');
        return true;
      } catch (err) {
        toast('无法访问麦克风：' + (err.name === 'NotAllowedError' ? '权限被拒绝' : err.message), true);
        return false;
      }
    } finally {
      this._toggling = false;
    }
  }

  /** 彻底释放麦克风管线（停止采集、关闭处理 context） */
  stopMicPipeline() {
    try { this.rawMicTrack?.stop(); } catch { /* ignore */ }
    try { this.micCtx?.close(); } catch { /* ignore */ }
    this.rawMicTrack = null;
    this.micCtx = null;
    this.micTrack = null;
    this.open = false;
  }

  teardown() {
    for (const sid of [...this.peers.keys()]) this.dropPeer(sid);
    this.stopMicPipeline();
    try { this._silentCtx?.close(); } catch { /* ignore */ } // 关闭静音占位轨的 AudioContext
    this._silentCtx = null;
    this._silent = null;
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
