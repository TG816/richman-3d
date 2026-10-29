# 调研报告：可用 API / 资源（动手前调研）

> 按要求：在写任何代码之前，先调研了可用的免费 API 与资源，结论如下。
> 调研时间：2026-10-30

## 1. 三维人物模型（棋子角色）

| 来源 | 许可 | 结论 |
|---|---|---|
| [Quaternius](https://quaternius.com) | CC0（公有领域） | 有大量带骨骼动画的低模角色，可导出 GLB；站点可达 ✅ |
| three.js 官方示例模型（如 RobotExpressive.glb） | 随仓库发布 | GitHub raw / jsDelivr 在当前网络环境下均被重置 ❌ 无法下载 |
| npm three 包 | MIT | 只含 jsm 代码与字体，**不含示例模型**（unpkg 实测 404）❌ |
| [Sketchfab](https://sketchfab.com/quaternius/models) | 逐模型各异 | 需逐个核对许可，且下载需登录 ⚠️ |

**决定**：角色棋子采用 **程序化建模**（Three.js 几何体拼装的低模 Q 版机器人，
每个玩家一个专属配色，带待机/跳跃/庆祝动画）。理由：
1) 外网模型源不可达，脚本化下载不可靠；2) 程序化棋子与自绘棋盘风格统一、体积极小；
3) 完全离线可用，便于将来直接部署到服务器。

## 2. 地图 API

| 来源 | 许可 | 结论 |
|---|---|---|
| [OpenStreetMap + Leaflet](https://leafletjs.com) | ODbL，瓦片服务器另有政策 | 无需 API Key 可用；但 [OSM 瓦片使用政策](https://operations.osmfoundation.org/policies/tiles) 禁止大流量使用 |
| [Poly Haven](https://polyhaven.com)（HDRI/贴图） | CC0 | API 域名当前不可达 ❌；HDR 改用 Three.js 内置 RoomEnvironment 程序化生成 |

**决定**：大富翁棋盘为自绘虚拟城市（中国著名街道主题），不依赖真实地图服务。
预留 `MapProvider` 接口位（见 `server/config.js` 与 `client/src/net/config.js`），
将来若要做"真实城市地图背景"，可接入 OSM 瓦片（注意使用政策）或自建瓦片服务。

## 3. 技术栈选型

| 需求 | 选型 | 许可 | 说明 |
|---|---|---|---|
| 3D 渲染 | [Three.js](https://threejs.org)（npm，MIT） | MIT | WebGPU/OpenGL 封装、后处理、OrbitControls |
| 前端构建 | [Vite](https://vitejs.dev) | MIT | 开发热更新 + 产物可交给后端静态托管 |
| 实时联机 | [Socket.IO](https://socket.io)（npm） | MIT | 房间/广播/自动重连，WebSocket |
| 实时语音 | [WebRTC](https://webrtc.org)（浏览器原生） | — | 端到端 P2P 语音，Socket.IO 仅做信令；localhost 属安全上下文可直接取麦克风 |
| 后端 | Node.js + Express | MIT | 单进程同时提供 REST（`/api/*`，预留部署）与 WebSocket |
| 音效 | Web Audio API 程序化合成 | — | 免去外网音频素材，全离线 |
| 文字/贴图 | Canvas 2D 程序化生成 | — | 棋盘格中文名、价签、名牌等运行时生成，零素材依赖 |

## 4. 联网情况备注

实测：`registry.npmjs.org`、`unpkg.com`、`cdnjs.cloudflare.com` 可达；
`github.com raw`、`cdn.jsdelivr.net`、`api.polyhaven.com` 被重置不可达。
因此所有依赖均走 npm 安装，游戏运行时 **零外网依赖**。
