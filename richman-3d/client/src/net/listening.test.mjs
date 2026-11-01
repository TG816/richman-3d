import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ListeningSettings } from './listening.js';
test('默认正常收听，修改一位队友不影响其他人', () => {
 const settings = new ListeningSettings(); const a = {}, b = {};
 settings.set('甲', { volume: .35 }); settings.apply('甲', a); settings.apply('乙', b);
 assert.deepEqual(a, { volume: .35, muted: false });
 assert.deepEqual(b, { volume: 1, muted: false });
});
test('本地静音独立于音量，取消静音保留音量', () => {
 const s = new ListeningSettings(); const audio = {};
 s.set('甲', { volume: .6, muted: true }); s.apply('甲', audio);
 assert.equal(audio.muted, true); assert.equal(audio.volume, .6);
 s.set('甲', { muted: false }); s.apply('甲', audio);
 assert.deepEqual(audio, { volume: .6, muted: false });
});
test('新接收音频沿用玩家设置，清理后恢复默认', () => {
 const s = new ListeningSettings(); s.set('甲', { muted: true, volume: 0 });
 const replacement = {}; s.apply('甲', replacement);
 assert.deepEqual(replacement, { muted: true, volume: 0 });
 s.clear(); s.apply('甲', replacement); assert.deepEqual(replacement, { muted: false, volume: 1 });
});
test('限制音量范围并忽略非数字输入', () => {
 const s = new ListeningSettings();
 assert.equal(s.set('甲', { volume: 3 }).volume, 1);
 assert.equal(s.set('甲', { volume: -1 }).volume, 0);
 assert.equal(s.set('甲', { volume: NaN }).volume, 0);
});
