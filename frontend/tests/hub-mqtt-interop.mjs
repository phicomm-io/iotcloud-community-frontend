// Browser Paho adapter <-> production HubTransport <-> independent MQTT.js TCP.
// All generated files and broker binaries live in a temporary directory.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import mqtt from 'mqtt';
import packet from 'mqtt-packet';
import { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('../', import.meta.url));
const firmware = process.env.FIRMWARE_ROOT || fileURLToPath(new URL('../../../firmware/', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'iotcloud-hub-mqtt-'));
const pause = ms => new Promise(done => setTimeout(done, ms));
async function port() {
  const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const value = server.address().port; await new Promise(done => server.close(done)); return value;
}
async function until(predicate, message, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error(message); await pause(10); }
}
const tcp = await port(), ws = await port();
const binary = process.env.HUB_TEST_SERVER || join(temporary, 'broker');
if (!process.env.HUB_TEST_SERVER) {
  const compile = spawnSync('c++', ['-std=c++11', '-g', '-Wall', '-Wextra', '-Werror', '-I', join(firmware, 'DAIKIN/include'), join(firmware, 'DAIKIN/tests/hub/server.cpp'), '-lcrypto', '-pthread', '-o', binary], { encoding: 'utf8' });
  assert.equal(compile.status, 0, compile.stderr);
}
let broker, browser, http, mock, hanging;
const clients = [], sockets = new Set(), hangingSockets = new Set();
async function startBroker() {
  broker = spawn(binary, [String(tcp), String(ws)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '', errors = '';
  broker.stdout.on('data', data => { text += data; });
  broker.stderr.on('data', data => { errors += data; });
  await until(() => text.includes('ready\n') || broker.exitCode !== null, 'HubTransport did not start');
  assert.equal(broker.exitCode, null, errors);
}
async function stopBroker() {
  if (!broker || broker.exitCode !== null) return;
  const exit = once(broker, 'exit'); broker.kill('SIGTERM');
  const [code] = await exit; assert.equal(code, 0); broker = null;
}
async function observer(id) {
  const client = mqtt.connect(`mqtt://127.0.0.1:${tcp}`, { clientId: id, username: 'test', password: 'test-password', protocolVersion: 4, reconnectPeriod: 0 });
  clients.push(client); await once(client, 'connect');
  client.messages = [];
  client.on('message', (topic, body, details) => client.messages.push({ topic, body: body.toString(), retain: details.retain }));
  return client;
}
async function subscribe(client, topics) { await new Promise((done, fail) => client.subscribe(topics, { qos: 1 }, cause => cause ? fail(cause) : done())); }
async function publish(client, topic, body, retain = false) { await new Promise((done, fail) => client.publish(topic, body, { qos: 1, retain }, cause => cause ? fail(cause) : done())); }

const adapterBundle = await build({ entryPoints: [resolve(root, 'src/hubMqtt.js')], absWorkingDir: root, bundle: true, minify: true, platform: 'browser', format: 'iife', globalName: 'HubMQTT', write: false, legalComments: 'inline' });
const mqttBundle = await build({ stdin: { contents: "import mqtt from 'mqtt'; window.HubMQTT=mqtt;", resolveDir: root }, bundle: true, minify: true, platform: 'browser', format: 'iife', write: false, legalComments: 'inline' });
const code = adapterBundle.outputFiles[0].contents;
assert.match(new TextDecoder().decode(code), /Eclipse Distribution License/);
assert.doesNotMatch(new TextDecoder().decode(code), /\beval\(|new Function\(/);
const measurements = {
  pahoAdapter: { minified: code.length, gzip: gzipSync(code, { level: 9 }).length },
  mqttJs: { minified: mqttBundle.outputFiles[0].contents.length, gzip: gzipSync(mqttBundle.outputFiles[0].contents, { level: 9 }).length },
};
measurements.gzipSaved = measurements.mqttJs.gzip - measurements.pahoAdapter.gzip;
const checks = [];
let forcedWillSeen = false;

try {
  await startBroker();
  http = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src ws://127.0.0.1:*");
    if (request.url === '/hub.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(code); }
    else response.end('<!doctype html><html><script src="/hub.js"></script></html>');
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', cause => pageErrors.push(cause.message));
  await page.goto(`http://127.0.0.1:${http.address().port}`);
  // A real localStorage write would make the QoS 1 scenarios fail.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Unexpected browser persistence'); }; });
  await page.evaluate(url => {
    window.messages = []; window.errors = []; window.connects = 0;
    window.client = HubMQTT.connect(url, { clientId: 'paho-browser', username: 'test', password: 'test-password', clean: true, connectTimeout: 2000, ackTimeout: 2000, reconnectPeriod: 100 });
    client.on('connect', () => connects++).on('error', cause => errors.push({ message: cause.message, code: cause.code }));
    client.on('message', (topic, body, details) => messages.push({ topic, body: body.toString(), retain: details.retain }));
  }, `ws://127.0.0.1:${ws}/mqtt`);
  await page.waitForFunction(() => connects === 1);
  const native = await observer('native-observer');
  await subscribe(native, 'home/#');
  const grants = await page.evaluate(() => new Promise(done => client.subscribe(['home/+/state', 'home/result'], { qos: 1 }, (cause, granted) => done({ cause: cause?.message, granted }))));
  assert.equal(grants.cause, undefined);
  // HubBroker accepts incoming QoS 1 and currently grants outgoing QoS 0.
  assert.deepEqual(grants.granted, [{ topic: 'home/+/state', qos: 0 }, { topic: 'home/result', qos: 0 }]);
  await publish(native, 'home/air/state', '温度 25℃ / CO₂ 800', true);
  await page.waitForFunction(() => messages.some(message => message.body === '温度 25℃ / CO₂ 800'));
  const ack = await page.evaluate(() => new Promise(done => client.publish('home/result', '已执行', { qos: 1, retain: true }, cause => done({ cause: cause?.message }))));
  assert.equal(ack.cause, undefined);
  await until(() => native.messages.some(message => message.body === '已执行'), 'TCP observer did not receive browser publication');
  const late = await observer('late-observer'); await subscribe(late, 'home/result');
  await until(() => late.messages.some(message => message.body === '已执行' && message.retain), 'Retained publication missing');
  await page.evaluate(() => new Promise(done => client.publish('home/result', '', { qos: 1, retain: true }, done)));
  await until(() => late.messages.some(message => message.body === ''), 'Empty retained deletion missing');
  const fresh = await observer('after-retained-delete'); await subscribe(fresh, 'home/result');
  await pause(80); assert.deepEqual(fresh.messages, []); fresh.end(true);
  await page.evaluate(() => new Promise(done => client.publish('home/result', 'qos zero', { qos: 0 }, done)));
  await until(() => native.messages.some(message => message.body === 'qos zero'), 'QoS 0 publication missing');
  checks.push('browser WS / independent TCP, QoS 1 ACK, multi-topic SUBACK, UTF-8, retained publication');

  await page.evaluate(url => new Promise(done => {
    window.grantClient = HubMQTT.connect(url, { clientId: 'quota-client', username: 'test', password: 'test-password', reconnectPeriod: 0 });
    grantClient.on('error', () => {});
    grantClient.on('connect', () => grantClient.subscribe(Array.from({ length: 24 }, (_, i) => `quota/${i}`), { qos: 1 }, done));
  }), `ws://127.0.0.1:${ws}/mqtt`);
  for (const filters of [['quota/0', 'quota/overflowA'], ['quota/overflowB', 'quota/0']]) {
    const result = await page.evaluate(filters => new Promise(done => grantClient.subscribe(filters, { qos: 1 }, (cause, granted) => done({ code: cause?.code, granted }))), filters);
    assert.equal(result.code, 'ERR_MQTT_SUBACK');
    assert.deepEqual(result.granted.map(grant => grant.qos), filters[0] === 'quota/0' ? [0, 128] : [128, 0]);
  }
  await page.evaluate(() => grantClient.end(true));
  checks.push('partial and first-topic subscription quota refusals preserve actual granted QoS');
  await page.evaluate(() => new Promise(done => client.unsubscribe(['home/+/state', 'home/result'], cause => done(cause?.message))));
  const before = await page.evaluate(() => messages.length);
  await publish(native, 'home/air/state', 'after unsubscribe'); await pause(120);
  assert.equal(await page.evaluate(() => messages.length), before);
  checks.push('UNSUBACK stops delivery');

  await page.evaluate(() => new Promise(done => client.subscribe('home/air/state', { qos: 1 }, done)));
  await page.evaluate(() => client.reconnect());
  await page.waitForFunction(() => connects === 2);
  await page.waitForFunction(() => messages.some(message => message.body === '温度 25℃ / CO₂ 800' && message.retain));
  await publish(native, 'home/air/state', 'after reconnect');
  await page.waitForFunction(() => messages.some(message => message.body === 'after reconnect'));
  checks.push('manual reconnect restores acknowledged subscriptions');

  const refusal = await page.evaluate(url => new Promise(done => {
    const bad = HubMQTT.connect(url, { clientId: 'bad-password', username: 'test', password: 'wrong', reconnectPeriod: 0 });
    let connected = false; bad.on('connect', () => { connected = true; });
    bad.on('error', cause => { bad.end(true); done({ connected, error: cause.message }); });
  }), `ws://127.0.0.1:${ws}/mqtt`);
  assert.equal(refusal.connected, false); assert.match(refusal.error, /CONNACK|refused|authorization|password/i);
  checks.push('invalid credentials never report connected');

  for (const force of [false, true]) {
    await page.evaluate(({ url, force }) => new Promise(done => {
      const will = HubMQTT.connect(url, { clientId: `will-${force}`, username: 'test', password: 'test-password', reconnectPeriod: 0, will: { topic: `home/will-${force}`, payload: 'offline', qos: 1, retain: true } });
      will.on('error', cause => { throw cause; });
      will.on('connect', () => will.end(force, done));
    }), { url: `ws://127.0.0.1:${ws}/mqtt`, force });
  }
  await pause(150);
  forcedWillSeen = native.messages.some(message => message.topic === 'home/will-true');
  assert.ok(!native.messages.some(message => message.topic === 'home/will-false'));
  checks.push('will retained/QoS options, graceful DISCONNECT, forced close');
  late.end(true); native.end(true);
  await stopBroker();
  await page.waitForFunction(() => !client.connected);
  const offline = await page.evaluate(() => new Promise(done => client.publish('home/command', 'never replay', { qos: 1 }, cause => done(cause?.code))));
  assert.equal(offline, 'ERR_MQTT_OFFLINE');
  await startBroker(); await page.waitForFunction(() => connects >= 3);
  const restored = await observer('restored-observer');
  await publish(restored, 'home/air/state', 'after restart');
  await page.waitForFunction(() => messages.some(message => message.body === 'after restart'));
  await page.evaluate(() => client.end(true));
  const count = await page.evaluate(() => connects); await pause(250);
  assert.equal(await page.evaluate(() => connects), count);
  checks.push('real broker restart reconnects, offline command fails without replay, end stops retries');

  // A real WebSocket endpoint withholds PUBACK; callback must fail on timeout.
  mock = new WebSocketServer({ port: 0, host: '127.0.0.1', handleProtocols: protocols => [...protocols][0] });
  await once(mock, 'listening');
  let publishes = 0, closes = 0;
  mock.on('connection', socket => {
    sockets.add(socket); socket.on('close', () => { closes++; sockets.delete(socket); });
    const parser = packet.parser(); socket.on('message', data => parser.parse(data));
    parser.on('packet', frame => {
      if (frame.cmd === 'connect') socket.send(packet.generate({ cmd: 'connack', returnCode: 0, sessionPresent: false }));
      if (frame.cmd === 'publish') publishes++;
    });
  });
  const timed = await page.evaluate(url => new Promise(done => {
    const timed = HubMQTT.connect(url, { clientId: 'timeout', reconnectPeriod: 0, ackTimeout: 80 });
    timed.on('error', () => {});
    timed.on('connect', () => timed.publish('command', 'not acknowledged', { qos: 1 }, cause => { timed.end(true); done({ code: cause?.code, connected: timed.connected, pending: timed._pending.size }); }));
  }), `ws://127.0.0.1:${mock.address().port}/mqtt`);
  assert.deepEqual(timed, { code: 'ETIMEDOUT', connected: false, pending: 0 });
  await until(() => closes === 1, 'Timeout left WebSocket open'); assert.equal(publishes, 1);
  checks.push('withheld PUBACK cannot report success and timeout closes real socket');
  for (const socket of sockets) socket.terminate();
  await new Promise(done => mock.close(done)); mock = null;

  // Hold the HTTP upgrade handshake open: end(true) must close CONNECTING too.
  hanging = createServer();
  hanging.on('upgrade', (request, socket) => { hangingSockets.add(socket); socket.on('close', () => hangingSockets.delete(socket)); socket.on('end', () => socket.destroy()); socket.resume(); });
  hanging.listen(0, '127.0.0.1'); await once(hanging, 'listening');
  await page.evaluate(url => {
    window.handshake = HubMQTT.connect(url, { clientId: 'cancel-handshake', reconnectPeriod: 20, connectTimeout: 5000 });
    handshake.on('error', () => {});
  }, `ws://127.0.0.1:${hanging.address().port}/mqtt`);
  await until(() => hangingSockets.size === 1, 'No pending upgrade connection');
  await page.evaluate(() => handshake.end(true));
  await until(() => hangingSockets.size === 0, 'end(true) leaked connecting WebSocket', 500);
  await pause(100); assert.equal(hangingSockets.size, 0);
  await new Promise(done => hanging.close(done)); hanging = null;
  checks.push('end during pending WebSocket upgrade immediately aborts the TCP connection');
  assert.deepEqual(pageErrors, []);
  assert.equal(forcedWillSeen, true, 'WebSocket close without MQTT DISCONNECT must trigger the will');
  measurements.checks = checks;
  if (process.env.HUB_MQTT_REPORT) await writeFile(process.env.HUB_MQTT_REPORT, JSON.stringify(measurements, null, 2) + '\n');
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  for (const client of clients) client.end(true);
  for (const socket of sockets) socket.terminate();
  for (const socket of hangingSockets) socket.destroy();
  if (hanging) await new Promise(done => hanging.close(done));
  if (mock) await new Promise(done => mock.close(done));
  await browser?.close();
  if (http) await new Promise(done => http.close(done));
  await stopBroker();
  await rm(temporary, { recursive: true, force: true });
}
