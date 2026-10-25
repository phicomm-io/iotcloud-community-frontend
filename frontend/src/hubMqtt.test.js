import test from 'node:test';
import assert from 'node:assert/strict';
import { HubMqttClient } from './hubMqtt.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(options = {}) {
  const sessions = [];
  const client = new HubMqttClient('ws://localhost:9001/mqtt', {
    clientId: 'test', username: 'account', password: 'secret', reconnectPeriod: 0, ...options,
  }, (uri, id) => {
    const session = {
      uri, id, sends: [], subscriptions: [], unsubscriptions: [], disposed: [],
      message: payload => ({ payloadBytes: payload }),
      dispose: graceful => session.disposed.push(graceful),
      client: {
        connect: opts => { session.options = opts; },
        send: msg => session.sends.push(msg),
        subscribe: (topics, opts) => session.subscriptions.push({ topics, opts }),
        unsubscribe: (topics, opts) => session.unsubscriptions.push({ topics, opts }),
      },
    };
    sessions.push(session);
    return session;
  });
  const errors = [];
  client.on('error', cause => errors.push(cause));
  return { client, sessions, errors, async open() { await turn(); sessions.at(-1).options.onSuccess(); return sessions.at(-1); } };
}

test('hub MQTT maps connection options, UTF-8 payload and event listeners', async t => {
  const f = fixture({ keepalive: 17, connectTimeout: 5010, will: { topic: 'availability', payload: '离线', qos: 1, retain: true } });
  t.after(() => f.client.end(true));
  let connected = 0, removed = 0;
  f.client.once('connect', () => connected++);
  const listener = () => removed++;
  f.client.on('connect', listener).off('connect', listener);
  const session = await f.open();
  assert.equal(connected, 1);
  assert.equal(removed, 0);
  assert.equal(f.client.connected, true);
  assert.equal(session.options.userName, 'account');
  assert.equal(session.options.password, 'secret');
  assert.equal(session.options.keepAliveInterval, 17);
  assert.equal(session.options.timeout, 5.01);
  assert.equal(session.options.cleanSession, true);
  assert.equal(session.options.mqttVersion, 4);
  assert.equal(session.options.reconnect, false);
  assert.equal(session.options.willMessage.destinationName, 'availability');
  assert.equal(new TextDecoder().decode(session.options.willMessage.payloadBytes), '离线');
  const messages = [];
  f.client.on('message', (...args) => messages.push(args));
  session.client.onMessageArrived({ destinationName: 'air/state', payloadBytes: new TextEncoder().encode('温度 25℃'), qos: 1, retained: true, duplicate: false });
  assert.equal(messages[0][0], 'air/state');
  assert.equal(messages[0][1].toString(), '温度 25℃');
  assert.equal(messages[0][1] instanceof Uint8Array, true);
  assert.deepEqual(messages[0][2], { qos: 1, retain: true, dup: false });
});

test('QoS 1 completes on its own ACK exactly once, including reordered ACKs', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), completions = [];
  f.client.publish('one', '1', { qos: 1 }, cause => completions.push(['one', cause]));
  f.client.publish('two', '2', { qos: 1 }, cause => completions.push(['two', cause]));
  await turn(); assert.deepEqual(completions, []);
  session.client.onMessageDelivered(session.sends[1]);
  session.client.onMessageDelivered(session.sends[1]);
  await turn(); assert.deepEqual(completions, [['two', null]]);
  session.client.onMessageDelivered(session.sends[0]);
  await turn(); assert.deepEqual(completions, [['two', null], ['one', null]]);
  assert.equal(f.client._pending.size, 0);
});

test('subscription grants preserve partial and first-topic refusals; unsubscribe waits for ACK', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), results = [];
  f.client.subscribe(['allowed', 'denied'], { qos: 1 }, (...args) => results.push(args));
  session.subscriptions[0].opts.onSuccess({ grantedQos: [1, 128] });
  await turn();
  assert.equal(results[0][0].code, 'ERR_MQTT_SUBACK');
  assert.deepEqual(results[0][1], [{ topic: 'allowed', qos: 1 }, { topic: 'denied', qos: 128 }]);
  f.client.subscribe(['denied', 'allowed'], { qos: 1 }, (...args) => results.push(args));
  session.subscriptions[1].opts.onFailure({ errorCode: new Uint8Array([128, 0]) });
  await turn();
  assert.equal(results[1][0].code, 'ERR_MQTT_SUBACK');
  assert.equal(results[1][1][1].qos, 0);
  let unsubscribed = false;
  f.client.unsubscribe(['allowed'], cause => { assert.equal(cause, null); unsubscribed = true; });
  await turn(); assert.equal(unsubscribed, false);
  session.unsubscriptions[0].opts.onSuccess(); await turn();
  assert.equal(unsubscribed, true);
  assert.equal(f.client._subscriptions.size, 0);
});

test('offline publish is rejected and never appears in a later connection', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const completions = [];
  f.client.publish('command', 'danger', { qos: 1 }, cause => completions.push(cause));
  const session = await f.open();
  assert.equal(completions[0].code, 'ERR_MQTT_OFFLINE');
  assert.equal(session.sends.length, 0);
});

test('end before start and during connect aborts transport without late callbacks or retries', async () => {
  const early = fixture();
  early.client.end(true);
  await turn(); assert.equal(early.sessions.length, 0);
  const f = fixture({ reconnectPeriod: 5 });
  let connected = 0, messages = 0;
  f.client.on('connect', () => connected++).on('message', () => messages++);
  await turn(); const session = f.sessions[0];
  f.client.end(true);
  session.options.onSuccess();
  session.options.onFailure({ errorMessage: 'late connect failure' });
  session.client.onMessageArrived({ payloadBytes: new Uint8Array() });
  await pause(20);
  assert.deepEqual(session.disposed, [false]);
  assert.equal(f.sessions.length, 1);
  assert.equal(connected, 0);
  assert.equal(messages, 0);
  assert.equal(f.client.connected, false);
  assert.deepEqual(f.errors, []);
});

test('lost connection fails unacknowledged work and old callbacks cannot settle a new session', async t => {
  const f = fixture({ reconnectPeriod: 5 }); t.after(() => f.client.end(true));
  const old = await f.open(), results = [];
  f.client.subscribe('state', { qos: 1 }, cause => results.push(['old-sub', cause]));
  f.client.publish('command', 'on', { qos: 1 }, cause => results.push(['old-pub', cause]));
  old.client.onConnectionLost({ errorMessage: 'network lost' });
  await pause(15);
  assert.equal(f.sessions.length, 2);
  const next = f.sessions[1]; next.options.onSuccess();
  f.client.publish('command', 'off', { qos: 1 }, cause => results.push(['new-pub', cause]));
  old.client.onMessageDelivered(old.sends[0]);
  old.subscriptions[0].opts.onSuccess({ grantedQos: [1] });
  old.options.onFailure({ errorMessage: 'late old failure' });
  await turn();
  assert.equal(results.length, 2);
  assert.ok(results.every(([, cause]) => cause instanceof Error));
  assert.equal(f.client.connected, true);
  assert.equal(f.client._subscriptions.size, 0);
  assert.equal(next.sends.length, 1);
  next.client.onMessageDelivered(next.sends[0]); await turn();
  assert.deepEqual(results[2], ['new-pub', null]);
});

test('pending count is bounded and timeout aborts rather than releasing an internally queued packet', async t => {
  const f = fixture({ ackTimeout: 20 }); t.after(() => f.client.end(true));
  const session = await f.open(), results = [];
  for (let i = 0; i < 65; i++) f.client.publish('command', 'x', { qos: 1 }, cause => results.push(cause));
  await turn();
  assert.equal(session.sends.length, 64);
  assert.equal(results[0].code, 'ERR_MQTT_LIMIT');
  assert.equal(f.client._pending.size, 64);
  await pause(35);
  assert.equal(f.client._pending.size, 0);
  assert.equal(f.client._pendingBytes, 0);
  assert.deepEqual(session.disposed, [false]);
  assert.equal(results.length, 65);
  assert.ok(results.slice(1).every(cause => cause.code === 'ETIMEDOUT'));
  assert.equal(f.client.connected, false);
});

test('byte budget and unsupported protocol/options fail explicitly', async t => {
  assert.throws(() => fixture({ clean: false }), /clean MQTT session/);
  assert.throws(() => fixture({ protocolVersion: 5 }), /3.1.1/);
  assert.throws(() => fixture({ properties: {} }), /Unsupported/);
  assert.throws(() => new HubMqttClient('mqtt://localhost'), /ws:\/\//);
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), errors = [];
  f.client.publish('command', new Uint8Array(256 * 1024), { qos: 1 }, cause => errors.push(cause));
  f.client.publish('command', 'x', { qos: 2 }, cause => errors.push(cause));
  f.client.publish('command', 'x', { properties: {} }, cause => errors.push(cause));
  f.client.subscribe('bad/#/filter', cause => errors.push(cause));
  await turn();
  assert.equal(session.sends.length, 0);
  assert.equal(session.subscriptions.length, 0);
  assert.deepEqual(errors.map(cause => cause.code), ['ERR_MQTT_LIMIT', 'ERR_MQTT_OPTIONS', 'ERR_MQTT_OPTIONS', 'ERR_MQTT_TOPIC']);
});

test('connect timeout disposes a pending handshake and reconnect restores acknowledged subscriptions only', async t => {
  const timeout = fixture({ connectTimeout: 10 }); t.after(() => timeout.client.end(true));
  await pause(20);
  assert.equal(timeout.errors[0].code, 'ETIMEDOUT');
  assert.deepEqual(timeout.sessions[0].disposed, [false]);
  const f = fixture(); t.after(() => f.client.end(true));
  const old = await f.open();
  f.client.subscribe('state', { qos: 1 });
  old.subscriptions[0].opts.onSuccess({ grantedQos: [1] }); await turn();
  f.client.reconnect(); await turn();
  const next = f.sessions[1]; next.options.onSuccess();
  assert.equal(next.subscriptions.length, 1);
  assert.deepEqual(next.subscriptions[0].topics, ['state']);
  assert.equal(next.sends.length, 0);
  next.subscriptions[0].opts.onSuccess({ grantedQos: [1] });
  await turn();
});

test('subscription limit includes all unacknowledged requests', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), rejected = [];
  f.client.subscribe(Array.from({ length: 80 }, (_, i) => `first/${i}`), () => {});
  f.client.subscribe(Array.from({ length: 48 }, (_, i) => `second/${i}`), () => {});
  f.client.subscribe('overflow', cause => rejected.push(cause));
  await turn();
  assert.equal(session.subscriptions.length, 2);
  assert.equal(rejected[0].code, 'ERR_MQTT_LIMIT');
  session.subscriptions[0].opts.onSuccess({ grantedQos: new Uint8Array(80) });
  f.client.subscribe('still-overflow', cause => rejected.push(cause));
  await turn();
  assert.equal(session.subscriptions.length, 2);
  assert.equal(rejected[1].code, 'ERR_MQTT_LIMIT');
  session.subscriptions[1].opts.onFailure({ errorCode: new Uint8Array(48).fill(128) });
  f.client.subscribe('now-allowed', () => {});
  assert.equal(session.subscriptions.length, 3);
});

test('unsubscribe intent survives a late SUBACK and reconnect', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open();
  f.client.subscribe('removed-device', { qos: 1 }, () => {});
  f.client.unsubscribe('removed-device', () => {});
  session.subscriptions[0].opts.onSuccess({ grantedQos: [0] });
  assert.equal(f.client._subscriptions.size, 0);
  f.client.reconnect(); await turn(); f.sessions[1].options.onSuccess();
  assert.equal(f.sessions[1].subscriptions.length, 0);
});

test('offline listener can end without leaving a stale reconnect timer', async () => {
  const f = fixture({ reconnectPeriod: 5 });
  let reconnects = 0;
  f.client.on('reconnect', () => reconnects++);
  f.client.on('offline', () => f.client.end(true));
  const session = await f.open();
  session.client.onConnectionLost({ errorMessage: 'lost' });
  await pause(20);
  assert.equal(reconnects, 0);
  assert.equal(f.sessions.length, 1);
  assert.equal(f.client._retry, null);
});

test('send exceptions fail pending work and dispose protocol state', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), failures = [];
  session.client.send = () => { throw new Error('WebSocket is closing'); };
  f.client.publish('command', 'x', { qos: 1 }, cause => failures.push(cause.message));
  await turn();
  assert.deepEqual(failures, ['WebSocket is closing']);
  assert.deepEqual(session.disposed, [false]);
  assert.equal(f.client._pending.size, 0);
  assert.equal(f.client.connected, false);
  assert.throws(() => f.client.reconnect({ username: 'other-account' }), /does not accept/);
});

test('QoS 0 synchronous delivery notification cannot mask a subsequent send failure', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), results = [];
  session.client.send = message => {
    session.client.onMessageDelivered(message);
    throw new Error('socket send failed');
  };
  f.client.publish('command', 'x', { qos: 0 }, cause => results.push(cause?.message));
  await turn();
  assert.deepEqual(results, ['socket send failed']);
});

test('reconnect restores all 128 supported subscriptions grouped by requested QoS', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const first = await f.open();
  for (const level of [0, 1]) {
    f.client.subscribe(Array.from({ length: 64 }, (_, i) => `qos${level}/${i}`), { qos: level });
    first.subscriptions.at(-1).opts.onSuccess({ grantedQos: new Uint8Array(64).fill(level) });
  }
  assert.equal(f.client._subscriptions.size, 128);
  f.client.reconnect(); await turn();
  const next = f.sessions[1]; next.options.onSuccess();
  assert.equal(next.subscriptions.length, 2);
  assert.deepEqual(next.subscriptions.map(request => [request.topics.length, request.opts.qos]), [[64, 0], [64, 1]]);
  for (const request of next.subscriptions) request.opts.onSuccess({ grantedQos: new Uint8Array(64).fill(request.opts.qos) });
  await turn();
  assert.equal(f.client._subscriptions.size, 128);
  assert.equal(f.client._pending.size, 0);
  assert.deepEqual(f.errors, []);
});

test('subscription byte budget includes acknowledged and pending filters', async t => {
  const f = fixture(); t.after(() => f.client.end(true));
  const session = await f.open(), rejected = [];
  f.client.subscribe(Array.from({ length: 4 }, (_, i) => `${i}/${'a'.repeat(60000)}`), () => {});
  session.subscriptions[0].opts.onSuccess({ grantedQos: [0, 0, 0, 0] });
  f.client.subscribe('b'.repeat(30000), cause => rejected.push(cause));
  await turn();
  assert.equal(session.subscriptions.length, 1);
  assert.equal(rejected[0].code, 'ERR_MQTT_LIMIT');
});
