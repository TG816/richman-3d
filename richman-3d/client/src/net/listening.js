/** 本机收听设置按玩家 ID 保存，不向服务器发送，不改变对方麦克风。 */
export class ListeningSettings {
  constructor() { this.settings = new Map(); }
  get(id) { return this.settings.get(id) ?? { volume: 1, muted: false }; }
  set(id, changes) {
    const next = { ...this.get(id) };
    if (Number.isFinite(changes.volume)) next.volume = Math.max(0, Math.min(1, changes.volume));
    if (typeof changes.muted === 'boolean') next.muted = changes.muted;
    this.settings.set(id, next);
    return next;
  }
  apply(id, audio) {
    const setting = this.get(id);
    audio.volume = setting.volume;
    audio.muted = setting.muted;
  }
  clear() { this.settings.clear(); }
}
