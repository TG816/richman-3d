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
  // 房间/对局参数（均可环境变量覆盖，便于部署调参与快速测试）
  MAX_PLAYERS: parseInt(process.env.MAX_PLAYERS || '6', 10),
  CODE_LEN: 4,
  TURN_SECONDS: parseInt(process.env.TURN_SECONDS || '75', 10),   // 回合超时自动行动
  ROUND_LIMIT: parseInt(process.env.ROUND_LIMIT || '50', 10),     // 回合上限，到达后按总资产定胜负
  START_MONEY: parseInt(process.env.START_MONEY || '15000', 10),  // 初始资金
  SALARY: parseInt(process.env.SALARY || '2000', 10),             // 经过起点工资
};
