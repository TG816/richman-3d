/** 复制纯房间码；兼容局域网 HTTP 下不可用的 Clipboard API。 */
export async function copyRoomCode(code) {
  const text = String(code ?? '').trim();
  if (!text) throw new Error('当前没有房间码');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* 权限被拒绝时尝试浏览器传统复制接口 */ }
  const previous = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(input);
  try {
    input.select();
    if (!document.execCommand('copy')) throw new Error('浏览器不允许复制');
  } finally {
    input.remove();
    previous?.focus();
  }
}
