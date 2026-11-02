/** 骰子点数固定提示：只显示服务端事件中的结果，不参与规则计算。 */
export function createDiceResult() {
  const panel = document.createElement('div');
  panel.className = 'dice-result hidden';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  document.body.appendChild(panel);
  return {
    rolling(name) { panel.textContent = `${name} · 掷骰中…`; panel.classList.remove('hidden'); },
    show(name, values) {
      panel.textContent = `${name} · 🎲 ${values[0]} + ${values[1]} = ${values[0] + values[1]}`;
      panel.classList.remove('hidden');
    },
    hide() { panel.classList.add('hidden'); panel.textContent = ''; },
  };
}
