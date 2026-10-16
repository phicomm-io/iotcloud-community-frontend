# Phicomm 前端

管理平台、TC1 / M1 / A1 设备 WebUI 与交互 demo 的唯一前端源码仓库。

| 目录 | 内容 |
| --- | --- |
| `common/web/` | 设备公共样式、主题、国际化、服务层及渲染器 |
| `TC1/http_server/web/`、`M1/web/`、`A1/web/` | 三款设备 WebUI |
| `frontend/` | Vue MQTT 远程集中管理平台；复用上述设备首页 |
| `tools/build_release.py` | 同时构建设备页面、平台与 demo |

```sh
npm ci --prefix frontend
npm test --prefix frontend
python3 tests/check_web.py
NODE_PATH=frontend/node_modules node tests/test_web.cjs
python3 tools/build_release.py
```

构建前必须提交所有源码改动。每个通过 CI 的 main commit 发布 `frontend-<完整40位commit>` Release，包括：

- `frontend.tar.gz`：`devices/<model>/index.html` 与确定性 gzip；`platform/`；`demos/`；`source/` 源码；带文件 SHA-256 的 `manifest.json`。
- `SHA256SUMS`：压缩包校验值。
- `frontend.lock.json`：消费者可直接提交的 commit、Release 和压缩包 SHA-256 锁文件。

固件及后端仓库提交指定 Release 的 `frontend.lock.json`，执行各自的 `tools/frontend_release.py` / `scripts/frontend_release.py` 下载并校验。不能使用 `latest`、分支名或短 commit；锁文件不匹配直接失败。离线构建可传 `--archive /path/frontend.tar.gz`，同样强制校验锁文件。

前端改动先在本仓库测试、提交并等待 Release；之后在固件或后端仓库单独更新锁文件。固件不需要 Node 或前端源码 checkout；设备页面由 Release 中的确定性 gzip 打包进固件。平台镜像只消费预构建 `platform/`，文档站复制同一 Release 的 `demos/`。

设备模拟器：`node scripts/device-simulator.mjs`。平台开发：`npm --prefix frontend run dev`，API / MQTT 代理可用 `API_TARGET`、`MQTT_TARGET` 配置。浏览器集成测试通过 `PHICOMM_WEB_URL`、`PHICOMM_MQTT_WS` 指向独立测试后端，不在公开 CI 使用生产凭据。

初始设备前端来自固件 commit `86eaf97`，平台前端来自 MQTT 平台 commit `056c56c`。保留源文件中的上游版权与许可声明；此迁移不改变原文件授权。

Frontend extraction source: firmware commit [`b9cdca3e63983acf5fc6f9c145ac0f5e7581a93f`](https://github.com/phicomm-io/phicomm-community-firmware/commit/b9cdca3e63983acf5fc6f9c145ac0f5e7581a93f), after the A1/M1 stability, panel feedback and watchdog branches were merged.

## IotCloud 静态部署与 Web App

在 `frontend/` 执行 `npm ci && npm run build`，将 **dist 内的全部文件**上传到 GitHub Pages 或其他 HTTPS 静态托管。默认使用相对资源路径及 Hash 路由，支持 `/仓库名/` 子路径，不需要 SPA 重写规则。图标源文件为 `frontend/public/icons/iotcloud.svg`；`icon-512.png` 可用作项目头像。

首次访问在登录页展开“服务器设置”，填写后端 HTTPS 根地址及可选的配套 MQTT WSS 地址。配置保存在此浏览器；也可在部署时编辑 `dist/config.json`：

```json
{"apiOrigin":"https://api.example.com","mqttWS":"wss://mqtt.example.com/mqtt"}
```

本地设置优先于 config.json；留空使用本站 API 和后端公布的 Broker。后端地址不带 `/api`。更换平台会重新加载，会话及连接偏好按后端隔离；访客设备列表按 Broker 地址和 MQTT 用户隔离。旧的未分组访客列表不自动导入，以免将设备带到另一个 Broker。平台模式只使用后端配套的 Broker；任意 Broker 使用访客模式。HTTPS 页面必须连接 WSS。

跨域后端需要本次 MQTT 后端改动，并在 `backend/config.yaml` 设置明确的 `allowed_origins`，例如 `['https://你的账号.github.io']`，不含项目路径或末尾斜线。`public_url` 仍是后端自己的公网地址。会话通过受白名单保护的响应头传递，前端放入 sessionStorage 并以 Bearer 请求，避免依赖第三方 Cookie。MQTT 密码仅在当前标签页的会话存储中保留，不放入公开配置或应用缓存。不要把不可信网页加入白名单。

浏览器可将 IotCloud 安装为 Web App（支持的平台使用“安装应用”或“添加到主屏幕”）。首次联网成功后缓存应用壳、全部构建 JS/CSS 和图标，因此离线可以打开登录页或访客界面；离线不能登录、同步账号设备或控制远程设备。API、config.json、MQTT 和实时状态不进入 Service Worker 缓存。每次构建生成内容版本，更新先完整下载，提示用户确认后切换并重新加载；激活后删除此应用的旧版本缓存。demo 不注册 Service Worker。

本地验证：`npm test && npm run build && node tests/static-webapp.mjs`。浏览器测试使用临时本地服务验证子路径、配置、安装清单、离线界面及缓存边界，不连接真实设备。
