import { fileURLToPath } from 'node:url';

/**
 * 运行配置。全部支持环境变量覆盖 —— 这是为将来部署到服务器预留的接口：
 *   PORT=3000 HOST=0.0.0.0 CORS_ORIGIN=https://your.domain PUBLIC_URL=https://your.domain node server/index.js
 * 本地开发默认值即插即用，无需任何配置。
 */
export const config = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  // 生产部署时建议：CORS_ORIGIN 填具体域名；PUBLIC_URL 填对外地址（用于拼房间链接）
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  PUBLIC_URL: process.env.PUBLIC_URL || '',
  // 是否由本服务托管前端静态产物（client/dist）。前后端分离部署时可设 SERVE_CLIENT=false
  SERVE_CLIENT: process.env.SERVE_CLIENT !== 'false',
  CLIENT_DIST: fileURLToPath(new URL('../client/dist/', import.meta.url)),
  // 房间/对局参数
  MAX_PLAYERS: 6,
  CODE_LEN: 4,
  TURN_SECONDS: 75,   // 回合超时自动行动
  ROUND_LIMIT: 50,    // 回合上限，到达后按总资产定胜负
  START_MONEY: 15000, // 初始资金
  SALARY: 2000,       // 经过起点工资
};
