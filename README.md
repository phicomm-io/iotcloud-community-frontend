# IoTCloud 前端

[English](README.en.md)

TC1 智能排插、M1 空气检测仪、A1 空气净化器和 DAIKIN 大金空气检测仪的共享 WebUI 源码。设备本地网页、IoTCloud 管理平台、本地直连、中枢界面和交互演示复用同一套设备页面，支持中英文、手机与桌面浏览器。

**[打开 IoTCloud](https://phicomm-io.github.io/iotcloud/) · [本地直连](https://phicomm-io.github.io/local/) · [模拟演示](https://phicomm-io.github.io/#demos) · [使用指南](https://phicomm-io.github.io/#install)**

## 功能与源码

- **设备页面**：TC1 插口、功率与定时；M1 / DAIKIN 空气读数、显示与联动；A1 风机、滤芯、灯环与自动模式。控件按固件能力显示。
- **平台与本地直连**：平台账号管理设备，也可连接自己的 MQTT Broker；局域网直连使用设备网页密码，无需平台账号。平台接入与设备配置见[使用指南](https://phicomm-io.github.io/guides/iotcloud-connect.html)。
- **DAIKIN 中枢**：独立构建使用本地账户管理 Broker、上游 MQTT 和转发；不提供邮箱注册或 GitHub 登录。v1.0.0-rc 提供独立中枢预发布构建，v1 稳定版尚未发布；安装与切换条件见[大金指南](https://phicomm-io.github.io/guides/daikin-guide.html)。
- **静态网页与演示**：IoTCloud 可单独托管、添加到桌面；演示使用模拟数据。

| 路径 | 内容 |
| --- | --- |
| `common/web/` | 设备共享样式、国际化、服务层和页面渲染 |
| `TC1/http_server/web/`、`M1/web/`、`A1/web/`、`DAIKIN/web/` | 四款设备页面 |
| `frontend/` | Vue 平台、本地直连与中枢界面 |
| `tools/build_release.py` | 设备页面、各模式及演示的统一打包 |

## 开发与构建

CI 使用 Node.js 22 和 Python 3.11。在仓库根目录执行：

```sh
python3 -m pip install -r requirements-build.txt
npm ci --prefix frontend
npm --prefix frontend run dev
```

开发服务器默认代理 `http://localhost:8080` 的 API 和 `ws://localhost:9001` 的 MQTT，可用 `API_TARGET`、`MQTT_TARGET` 覆盖。设备模拟器运行 `node scripts/device-simulator.mjs`。

```sh
npm test --prefix frontend
python3 tests/check_web.py
NODE_PATH=frontend/node_modules node tests/test_web.cjs
npm --prefix frontend run build
```

默认静态产物在 `frontend/dist/`。构建本地直连或中枢时，分别设置 `VITE_LOCAL_ONLY=1`、`VITE_HUB=1`；演示设置 `VITE_DEMO=1`。完整检查见 [CI 工作流](.github/workflows/release.yml)。

## 发布与消费

提交全部源码改动后，运行 `python3 tools/build_release.py`。通过 CI 的 `main` 提交发布不可变的 `frontend-<完整40位commit>` Release：

- `frontend.tar.gz`：`devices/<model>/` 的完整页面、离线引导页及确定性 gzip，`platform/`、`local/`、`hub/`、`demos/`、`source/` 和逐文件 SHA-256 `manifest.json`。
- `SHA256SUMS`：压缩包校验值。
- `frontend.lock.json`：仓库、完整提交、Release、文件名和压缩包 SHA-256。

[固件](https://github.com/phicomm-io/iotcloud-community-firmware)和[平台](https://github.com/phicomm-io/iotcloud-community-mqtt)提交指定 Release 的锁文件，通过各自的 `tools/frontend_release.py` / `scripts/frontend_release.py` 下载并校验；离线可传 `--archive /path/frontend.tar.gz`。禁止用 `latest`、分支或短提交替代锁定版本，也不替换同一 Release 下的已发布文件。

固件嵌入已校验的设备 gzip，不需要 Node；平台消费预构建 `platform/`，中枢消费 `hub/`，文档站消费同一 Release 的 `demos/`。修改源文件后重新发布、更新消费者锁文件并重建，不直接编辑生成页面。

## 静态部署

将 **`frontend/dist/` 内的全部文件**部署到 HTTPS 静态托管；使用发布包时部署完整 `platform/` 或 `local/` 目录。默认相对资源路径与 Hash 路由支持子路径，无需 SPA 重写。

登录页的“服务器设置”可填写后端 HTTPS 根地址和 MQTT WSS 地址，也可编辑部署产物的 `config.json`：

```json
{"apiOrigin":"https://api.example.com","mqttWS":"wss://mqtt.example.com/mqtt"}
```

后端地址不带 `/api`。浏览器保存的设置优先，留空使用同站点 API 和后端公布的 Broker。HTTPS 页面使用 WSS；配置文件不存账号、密码或令牌。

独立托管的前端来源须加入后端 `backend/config.yaml` 的 `allowed_origins`，例如 `https://your-account.github.io`，不含项目路径或末尾 `/`；`public_url` 保持为后端自己的 HTTPS 来源。部署、GitHub 登录与巴法云配置见[平台维护文档](https://github.com/phicomm-io/iotcloud-community-mqtt/blob/main/docs/OPERATIONS.md)、[GitHub 登录](https://github.com/phicomm-io/iotcloud-community-mqtt/blob/main/docs/GITHUB_LOGIN.md)与[巴法云转发](https://github.com/phicomm-io/iotcloud-community-mqtt/blob/main/docs/bemfa-cloud.md)。

本地直连需要支持对应 HTTP API 的固件和浏览器的本地网络访问许可。Web App 离线可打开应用界面，实时控制仍需连接设备或服务。

## 参与与许可

按[贡献指南](CONTRIBUTING.md)提交到 `dev`，共享接口见 [IoTCloud 开发文档](https://phicomm-io.github.io/iotcloud-community-protocols/)。接口变更同步规范与 `protocols.lock.json`，按 CI 运行相关检查。

引入源码与依赖保留原版权及许可；中枢 Paho 许可见 [frontend/licenses/paho-mqtt](frontend/licenses/paho-mqtt/NOTICE.md)，其他依赖见锁定版本包内声明。
