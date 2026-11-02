/** 骰子点数固定提示：只显示服务端事件中的结果，不参与规则计算。 */
export function createDiceResult() {
  const panel = document.createElement('div');
  panel.className = 'dice-result hidden';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  document.body.appendChild(panel);
  const topbar = document.querySelector('#hud .topbar');
  // 依顶部 UI 的真实高度布局，适应多人卡片、语音控件和手机换行。
  const place = () => {
    const bottom = topbar?.getBoundingClientRect().bottom ?? 0;
    panel.style.top = `${Math.max(12, bottom + 10)}px`;
  };
  if (topbar) new ResizeObserver(place).observe(topbar);
  addEventListener('resize', place);
  place();
  return {
    rolling(name) { panel.textContent = `${name} · 掷骰中…`; panel.classList.remove('hidden'); place(); },
    show(name, values) {
      panel.textContent = `${name} · 🎲 ${values[0]} + ${values[1]} = ${values[0] + values[1]}`;
      panel.classList.remove('hidden'); place();
    },
    hide() { panel.classList.add('hidden'); panel.textContent = ''; },
  };
}
