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
