import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 前后端分离开发：/socket.io 与 /api 代理到本地服务端；
// 部署时 build 产物交给 Express 托管（server/index.js 已预留），同源无需代理。
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: {
    alias: {
      // 棋盘数据单一来源：直接复用服务端常量，避免两端漂移
      '@board': fileURLToPath(new URL('../server/game/constants.js', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
});
