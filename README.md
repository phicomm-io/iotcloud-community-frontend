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

A1 首页的滤芯寿命卡片显示设备累计运行小时和剩余百分比，支持调整额定寿命及更换后确认重置。数据来自 `status.get.filter`，写入使用 `filter.set` / `filter.reset`；旧固件没有该字段时隐藏卡片。设备本地页面和平台共用此页面，演示使用模拟数据。回归：`NODE_PATH=frontend/node_modules node tests/test_a1_filter.cjs`。

设备模拟器：`node scripts/device-simulator.mjs`。平台开发：`npm --prefix frontend run dev`，API / MQTT 代理可用 `API_TARGET`、`MQTT_TARGET` 配置。浏览器集成测试通过 `PHICOMM_WEB_URL`、`PHICOMM_MQTT_WS` 指向独立测试后端，不在公开 CI 使用生产凭据。

初始设备前端来自固件 commit `86eaf97`，平台前端来自 MQTT 平台 commit `056c56c`。保留源文件中的上游版权与许可声明；此迁移不改变原文件授权。

Frontend extraction source: firmware commit [`b9cdca3e63983acf5fc6f9c145ac0f5e7581a93f`](https://github.com/phicomm-io/phicomm-community-firmware/commit/b9cdca3e63983acf5fc6f9c145ac0f5e7581a93f), after the A1/M1 stability, panel feedback and watchdog branches were merged.

## IotCloud 手机端导航

手机首页优先显示当前设备的控制与读数。点击设备名称旁的“切换设备”打开底部列表，选中后自动收起；列表内可刷新设备，改名和添加设备位于“设置 → 设备管理”。桌面端使用侧栏切换设备。手机端的平台管理入口位于“设置 → 账号安全”。

登录和注册页保留节点选择；进入平台后，从“设置 → MQTT 连接 → 平台节点”切换。切换会重新加载页面，使用目标节点自己的账号与设备。首页的设备接入地址提示可展开查看说明，也可点击“我知道了”关闭。

手机浏览器回归使用独立的 HTTP/MQTT 模拟数据，覆盖 Chromium、WebKit、首屏操作位置、弹层滚动和焦点、节点隔离以及控制命令目标，不连接真实设备。截图输出到 `build/mobile-layout/`：

```sh
cd frontend
npm run build
VITE_DEMO=1 npm run build -- --outDir ../build/bundle/demos/platform --emptyOutDir
node tests/mobile-layout.mjs
```

## IotCloud 静态部署与 Web App

在 `frontend/` 执行 `npm ci && npm run build`，将 **dist 内的全部文件**上传到 GitHub Pages 或其他 HTTPS 静态托管。默认使用相对资源路径及 Hash 路由，支持 `/仓库名/` 子路径，不需要 SPA 重写规则。图标源文件为 `frontend/public/icons/iotcloud.svg`；`icon-512.png` 可用作项目头像。

首次访问在登录页展开“服务器设置”，填写后端 HTTPS 根地址及可选的配套 MQTT WSS 地址。配置保存在此浏览器；也可在部署时编辑 `dist/config.json`：

```json
{"apiOrigin":"https://api.example.com","mqttWS":"wss://mqtt.example.com/mqtt"}
```

本地设置优先于 config.json；留空使用本站 API 和后端公布的 Broker。后端地址不带 `/api`。更换平台会重新加载，会话及连接偏好按后端隔离；访客设备列表按 Broker 地址和 MQTT 用户隔离。旧的未分组访客列表不自动导入，以免将设备带到另一个 Broker。平台模式只使用后端配套的 Broker；任意 Broker 使用访客模式。HTTPS 页面必须连接 WSS。

跨域后端需要本次 MQTT 后端改动，并在 `backend/config.yaml` 设置明确的 `allowed_origins`，例如 `['https://你的账号.github.io']`，不含项目路径或末尾斜线。`public_url` 仍是后端自己的公网地址。会话通过受白名单保护的响应头传递，前端按节点持久保存并以 Bearer 请求，避免依赖第三方 Cookie。登录会话与 MQTT 连接凭据保存在当前浏览器的本地存储中，关闭浏览器后可恢复；后端新会话有效期为 30 天。主动退出或会话失效会清除对应节点的凭据，不放入公开配置或应用缓存。不要把不可信网页加入白名单。

浏览器可将 IotCloud 安装为 Web App（支持的平台使用“安装应用”或“添加到主屏幕”）。首次联网成功后缓存应用壳、全部构建 JS/CSS 和图标，因此离线可以打开登录页或访客界面；离线不能登录、同步账号设备或控制远程设备。API、config.json、MQTT 和实时状态不进入 Service Worker 缓存。每次构建生成内容版本，更新先完整下载，提示用户确认后切换并重新加载；激活后删除此应用的旧版本缓存。demo 不注册 Service Worker。

本地验证：`npm test && npm run build && node tests/static-webapp.mjs`。浏览器测试使用临时本地服务验证子路径、配置、安装清单、离线界面及缓存边界，不连接真实设备。

## 将平台配置填写到本地设备

在平台“设置 → MQTT 连接”或“设备管理”中打开“填写到本地设备”，输入同一局域网内设备的 IP，并核对设备使用的 MQTT Host、TCP 端口和账号。平台账号模式优先采用后端公布的设备 MQTT 地址；第三方 Broker 需自行确认 TCP 端口，不能把 WSS 端口直接用于设备。

平台在浏览器中新开设备页面；设备 WebUI 显示平台来源，用户点击“接收并预填”后才接收配置，检查并保存后通过原有 `config.set` 鉴权接口提交到设备。设备必须运行支持此功能的前端；已有网页密码仍由设备自身校验，不会绕过。平台服务器不访问用户内网，也不代理或记录这次配置。

URL 的 fragment 只包含 Broker 主机名、设备 TCP 端口、用户名、一次性随机握手标识、平台来源和两分钟期限，不包含密码或平台会话令牌，也不会发送给 HTTP 服务器。两端核对窗口引用、完整来源和随机标识，使用明确的 `postMessage` 目标来源；Broker 主机名、端口与用户名由 URL 解析；设备确认并完成握手后，窗口消息只传密码，不重复传递 Broker 配置。设备确认前不发送密码，过期、取消、离开页面均停止接收并清除临时配置。未保存的导入过期后恢复原来的 Host、端口与用户名，避免将设备原有密码与另一个 Broker 混用。设备前端不将导入密码存入浏览器持久存储，正常保存成功后清空密码框；不会从设备读取或导出已有密码。

仅支持明确的局域网 IP（或本机开发地址），拒绝公网地址、带 URL 用户凭据、路径、查询或 fragment 的手工设备网址。公网平台需使用 HTTPS；HTTP 设备无法抵抗局域网窃听和篡改，发送前必须确认设备 IP 与网络可信。浏览器拦截弹窗或隔离窗口、设备不支持导入时，流程会失败或到期，不降级为将密码写入 URL。无法连接时请手动在设备本地网页填写。

首页 MQTT Host 提醒可点击“我知道了”按平台与 Broker 主机名在浏览器中记住；设置中的设备接入说明始终保留。设备 Broker 设置也提供 IotCloud 链接，普通跳转不附带任何账号或密码。


## 添加 IotCloud 到桌面

登录后设备列表加载成功，平台会在页面底部轻提示添加到桌面；自建 Broker 模式和演示不主动提示。“稍后提示”延后 7 天，“不再提示”在当前浏览器持久关闭主动提示；设置中的“添加到桌面”入口始终可用。提示偏好按当前站点保存，切换平台节点不会重置。

支持原生安装的浏览器在用户点击后打开安装窗口；iPhone/iPad 展示 Safari 分享、添加到主屏幕的步骤，应用内浏览器先引导使用系统浏览器，其他浏览器提供菜单操作说明。当前独立窗口或本次会话收到安装事件时隐藏主动提示；不把普通浏览器窗口误判为“未安装”。iPhone 从桌面首次打开可能需要重新登录。

回归：`npm --prefix frontend test`；构建后在 `frontend/` 执行 `node tests/install-app.mjs`。Chromium/WebKit 测试使用隔离 API 和模拟的安装/独立窗口信号，覆盖延后、永久关闭、设置入口、平台说明、窄屏、对话框焦点和退出；不代表真实系统安装验收。

### 注册验证码管理

管理员可在“账号与设备管理”页查看“注册验证码记录”，按邮箱、状态和日期范围查询发送及注册结果，并查看仍在有效期内的验证码，方便人工协助。验证码默认隐藏，过期后自动停止展示。统计按邮箱去重，区分发送失败与发送后未完成注册；SMTP 接受邮件并不代表已送达或已进入收件箱。记录从后端升级后开始，保留 90 天。

独立页面回归：构建后在 `frontend` 下运行 `node tests/admin-verification.mjs`，使用隔离数据验证 Chromium/WebKit 的查询、分页、验证码展示和过期、错误处理，以及手机与桌面布局，不发送真实邮件。

## GitHub 登录

后端配置 GitHub OAuth App 后，登录页显示“使用 GitHub 登录”。新用户授权后选择平台用户名和初始密码，设备仍使用平台用户名及 MQTT 密码；已有账号在“设置 → 账号安全”绑定 GitHub，避免创建第二个账号。解绑需要网站当前密码，并撤销该账号网站会话。

GitHub 登录支持同站点及 Pages 子路径、跨域后端、China / US 独立节点。新浏览器没有保存 MQTT 密码时，网站登录后会提示在连接设置中填写。未配置或旧后端隐藏入口，演示模式不访问 GitHub。配置步骤见后端仓库的 [GITHUB_LOGIN.md](https://github.com/phicomm-io/phicomm-community-mqtt/blob/main/docs/GITHUB_LOGIN.md)。

回归：构建后在 `frontend/` 执行 `node tests/github-login.mjs`。使用隔离 GitHub/API fixture 验证 Chromium/WebKit 的注册、冲突、登录、绑定、解绑、节点隔离、跨域会话、失效请求及手机/桌面布局，不使用真实 OAuth 密钥或生产账号。

## 平台公告

管理员在“账号与设备管理 → 平台公告”修改正文、按钮文字、跳转链接和启用状态，并预览效果。默认公告为空，可选择“登录前公告”或“登录后公告”。登录前公告只显示在登录和注册页，登录后自动收起。用户可“稍后提醒”（24 小时）、“忽略”（当前标签页）或“不再显示”（此条公告），偏好按节点和账号保存在当前浏览器。更新公告正文、链接或展示时机后按新公告处理。China / US 分别保存，关闭公告仍保留草稿。正文按纯文本显示，链接仅支持 HTTP/HTTPS。

构建后在 `frontend/` 执行 `node tests/banner.mjs`，验证 Chromium/WebKit 的保存、刷新恢复、开关、错误恢复、安全渲染及手机/桌面布局。

A1 灯效设置支持呼吸和彩虹跑马灯的变化速度（1–10 档，默认 5）。定时任务支持 1 分钟至 24 小时的关闭倒计时，可取消及重新计时；关闭网页后继续，设备重启后取消。新控件分别由 `light_effect.get.speed` 和 `capabilities.get.schedule_countdown` 决定是否展示，旧固件不展示。回归：`NODE_PATH=frontend/node_modules node --test tests/test_a1_light_save.cjs tests/test_a1_countdown.cjs`。

## 本地直连与精简固件

登录页可直接填写设备内网 IPv4 和网页管理密码，无需账号即可进入 `/#/local`。独立静态版位于发布包的 `local/`，部署整目录后默认进入本地管理，不显示登录页，也不请求账号服务。源码构建：`VITE_LOCAL_ONLY=1 npm --prefix frontend run build`。官方入口：<https://phicomm-io.github.io/local/>。

设备列表、地址保存在当前浏览器；网页管理密码只留在当前页面会话，刷新后需重新填写。设备需运行支持 `/api/v1/info` 和官方来源 CORS 的新版固件；HTTPS 网页访问内网 HTTP 设备还需要浏览器允许本地网络访问。

普通平台在“设置 → 设备管理 → 详情”可填写每台设备的内网地址、网页密码，并选择自动连接或始终 MQTT。自动模式校验型号、MAC、认证及状态后使用内网；内网失败时读取可回退 MQTT，写入回执不明时不会自动重发。本地文件 OTA 只发往已校验的内网设备。

`devices/<model>/setup.html.gz` 是 `no-frontend-resources` 固件的离线引导页，保留配网、MQTT 初始配置和管理密码设置，与完整页面共用颜色、主题和表单样式。完整设备设置仍可通过平台或本地管理页访问。
