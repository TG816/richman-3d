/**
 * 网络配置 —— 部署预留接口。
 * - 本地开发：空字符串 = 同源（走 Vite 代理到 localhost:3000）
 * - 部署服务器后：可设 ?server=https://your.domain 覆盖，或改 DEFAULT_SERVER
 */
const DEFAULT_SERVER = ''; // 例如 'https://richman.example.com'

const fromQuery = new URLSearchParams(location.search).get('server');

export const NET = {
  serverUrl: fromQuery || DEFAULT_SERVER,
  /** 邀请链接（部署后 PUBLIC_URL 指向服务器即可直接用） */
  inviteUrl(code) {
    const u = new URL(location.href);
    u.searchParams.set('room', code);
    u.searchParams.delete('server');
    return u.toString();
  },
};
