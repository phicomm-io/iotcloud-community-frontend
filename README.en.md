# IoTCloud frontend

[简体中文](README.md)

Shared WebUI source for TC1 power strips, M1 air quality monitors, A1 air purifiers, DAIKIN air quality monitors and ORVIBO S30-V1B single-outlet plugs. Device pages, the IoTCloud platform, direct LAN management, the hub interface and interactive demos reuse the same device UI, with English and Chinese support on phones and desktops.

**[Open IoTCloud](https://phicomm-io.github.io/iotcloud/) · [Direct LAN access](https://phicomm-io.github.io/local/) · [Simulated demos](https://phicomm-io.github.io/en/#demos) · [User guides](https://phicomm-io.github.io/en/#install)**

## Features and source

- **Device pages:** TC1 sockets, power and schedules; M1 / DAIKIN air readings, display settings and linked devices; A1 fan, filter, lighting and automatic modes; S30-V1B switching, metering, child lock and power-on policy. Controls follow firmware capabilities.
- **Platform and LAN access:** Manage devices through a platform account or your own MQTT Broker. Direct LAN access uses the device web password without a platform account. See the [connection guide](https://phicomm-io.github.io/guides/en/iotcloud-connect.html).
- **DAIKIN hub:** A separate build uses local accounts to manage its Broker, upstream MQTT and forwarding, without email registration or GitHub login. The v1.0.0-rc prerelease includes a separate hub build; stable v1 has not been released. See the [DAIKIN guide](https://phicomm-io.github.io/guides/en/daikin-guide.html) for installation and conversion requirements.
- **Static app and demos:** Host IoTCloud separately and add it to your home screen. Demos use simulated data.

| Path | Contents |
| --- | --- |
| `common/web/` | Shared device styles, translations, services and page rendering |
| `TC1/http_server/web/`, `M1/web/`, `A1/web/`, `DAIKIN/web/`, `S30/web/` | Five device interfaces |
| `frontend/` | Vue platform, direct LAN and hub interfaces |
| `tools/build_release.py` | Unified packaging of device pages, app modes and demos |

## Development and builds

CI uses Node.js 22 and Python 3.11. From the repository root:

```sh
python3 -m pip install -r requirements-build.txt
npm ci --prefix frontend
npm --prefix frontend run dev
```

The development server proxies the API to `http://localhost:8080` and MQTT to `ws://localhost:9001`. Override them with `API_TARGET` and `MQTT_TARGET`. Run the device simulator with `node scripts/device-simulator.mjs`.

```sh
npm test --prefix frontend
python3 tests/check_web.py
NODE_PATH=frontend/node_modules node tests/test_web.cjs
npm --prefix frontend run build
```

Static output defaults to `frontend/dist/`. Set `VITE_LOCAL_ONLY=1` for direct LAN management, `VITE_HUB=1` for the hub, or `VITE_DEMO=1` for demos. See the [CI workflow](.github/workflows/release.yml) for the full checks.

## Releases and consumers

Commit all source changes before running `python3 tools/build_release.py`. Each `main` commit that passes CI publishes an immutable `frontend-<full 40-character commit>` Release containing:

- `frontend.tar.gz`: full device pages, offline setup pages and deterministic gzip under `devices/<model>/`; `platform/`, `local/`, `hub/`, `demos/`, `source/`; and a `manifest.json` with per-file SHA-256 values.
- `SHA256SUMS`: the archive checksum.
- `frontend.lock.json`: repository, full commit, Release, asset name and archive SHA-256.

[Firmware](https://github.com/phicomm-io/iotcloud-community-firmware) and [platform](https://github.com/phicomm-io/iotcloud-community-mqtt) consumers commit the selected Release's lock file and verify downloads using their `tools/frontend_release.py` or `scripts/frontend_release.py`. Offline builds accept `--archive /path/frontend.tar.gz` with the same verification. Do not substitute `latest`, branches or short commits, or replace published files under an existing Release.

Firmware embeds verified device gzip without Node. The platform consumes prebuilt `platform/`, the hub consumes `hub/`, and the documentation site uses the same Release's `demos/`. Change source, publish, update consumer locks and rebuild; do not edit generated pages directly.

## Static deployment

Deploy **all files inside `frontend/dist/`** to HTTPS static hosting. From a release bundle, deploy the complete `platform/` or `local/` directory. Relative asset paths and hash routing support subpaths without SPA rewrite rules.

Use **Server settings** on the login page to set the backend HTTPS origin and MQTT WSS address, or edit the deployed `config.json`:

```json
{"apiOrigin":"https://api.example.com","mqttWS":"wss://mqtt.example.com/mqtt"}
```

Do not append `/api` to the backend origin. Browser settings take precedence; empty values use the same-site API and the Broker advertised by the backend. HTTPS pages require WSS. Keep account names, passwords and tokens out of the configuration file.

Allow the frontend's exact origin in the backend's `backend/config.yaml` `allowed_origins`, such as `https://your-account.github.io`, without a project path or trailing `/`. Keep `public_url` set to the backend's own HTTPS origin. See [platform operations](https://github.com/phicomm-io/iotcloud-community-mqtt/blob/main/docs/OPERATIONS.md), [GitHub login](https://github.com/phicomm-io/iotcloud-community-mqtt/blob/main/docs/GITHUB_LOGIN.md) and [Bemfa forwarding](https://github.com/phicomm-io/iotcloud-community-mqtt/blob/main/docs/bemfa-cloud.md) for configuration.

Direct LAN access requires firmware with the corresponding HTTP API and browser permission to access the local network. The Web App can open offline, but live control still needs a device or service connection.

## Contributing and notices

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and target `dev`. Shared interfaces live in [IoTCloud Developer Docs](https://phicomm-io.github.io/iotcloud-community-protocols/en/). Update the contract and `protocols.lock.json` with interface changes, and run the relevant CI checks.

Imported source and dependencies retain their original copyright and license notices. Hub Paho notices are in [frontend/licenses/paho-mqtt](frontend/licenses/paho-mqtt/NOTICE.md); other dependency notices accompany their locked package versions.
