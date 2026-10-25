import { createPaho } from './hubPaho.js';

// The embedded console needs MQTT 3.1.1 over WebSocket, not MQTT.js's Node,
// persistence and MQTT 5 stack. Wire encoding/decoding remains Eclipse Paho's.
// Commands are never queued offline or replayed after an ambiguous disconnect.
const MAX_PENDING = 64;
const MAX_PENDING_BYTES = 256 * 1024;
const MAX_SUBSCRIPTIONS = 128;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function error(message, code = 'ERR_MQTT') {
  return Object.assign(new Error(message), { code });
}
function optionsOnly(options, names) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw error('MQTT options must be an object', 'ERR_MQTT_OPTIONS');
  for (const key of Object.keys(options))
    if (!names.includes(key)) throw error(`Unsupported hub MQTT option: ${key}`, 'ERR_MQTT_OPTIONS');
}
function number(value, fallback, min, max) {
  value ??= fallback;
  if (!Number.isFinite(value) || value < min || value > max)
    throw error('Invalid MQTT numeric option', 'ERR_MQTT_OPTIONS');
  return value;
}
function qos(value) {
  value ??= 0;
  if (value !== 0 && value !== 1) throw error('Hub MQTT supports QoS 0 and 1', 'ERR_MQTT_OPTIONS');
  return value;
}
function topic(value, filter = false) {
  if (typeof value !== 'string' || !value || value.includes('\0') || encoder.encode(value).length > 65535)
    throw error('Invalid MQTT topic', 'ERR_MQTT_TOPIC');
  if (!filter && /[+#]/.test(value)) throw error('Publish topic cannot contain wildcards', 'ERR_MQTT_TOPIC');
  if (filter && value.split('/').some((part, i, parts) =>
    (part.includes('+') && part !== '+') || (part.includes('#') && (part !== '#' || i !== parts.length - 1))))
    throw error('Invalid MQTT topic filter', 'ERR_MQTT_TOPIC');
  return value;
}
function bytes(payload) {
  if ((typeof payload === 'string' ? payload.length : payload?.byteLength) > MAX_PENDING_BYTES)
    throw error('MQTT payload limit reached', 'ERR_MQTT_LIMIT');
  if (typeof payload === 'string') {
    const encoded = encoder.encode(payload);
    if (encoded.length > MAX_PENDING_BYTES) throw error('MQTT payload limit reached', 'ERR_MQTT_LIMIT');
    return encoded;
  }
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload.slice(0));
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
  throw error('MQTT payload must be a string or bytes', 'ERR_MQTT_PAYLOAD');
}
function clientOptions(input) {
  optionsOnly(input, ['clientId', 'username', 'password', 'connectTimeout', 'reconnectPeriod', 'keepalive', 'clean', 'protocolVersion', 'will', 'resubscribe', 'ackTimeout']);
  if (input.clean === false || (input.clean !== undefined && input.clean !== true))
    throw error('Hub console requires a clean MQTT session', 'ERR_MQTT_OPTIONS');
  if (input.protocolVersion !== undefined && input.protocolVersion !== 4)
    throw error('Hub console requires MQTT 3.1.1', 'ERR_MQTT_OPTIONS');
  for (const key of ['clientId', 'username', 'password'])
    if (input[key] !== undefined && typeof input[key] !== 'string') throw error(`Invalid MQTT ${key}`, 'ERR_MQTT_OPTIONS');
  if (input.password !== undefined && input.username === undefined)
    throw error('MQTT password requires a username', 'ERR_MQTT_OPTIONS');
  if (input.resubscribe !== undefined && typeof input.resubscribe !== 'boolean')
    throw error('Invalid MQTT resubscribe option', 'ERR_MQTT_OPTIONS');
  const result = {
    ...input,
    clientId: input.clientId || `hub_${globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2)}`,
    connectTimeout: number(input.connectTimeout, 30000, 1, 3600000),
    reconnectPeriod: number(input.reconnectPeriod, 1000, 0, 3600000),
    keepalive: number(input.keepalive, 60, 0, 65535),
    ackTimeout: number(input.ackTimeout, 30000, 1, 3600000),
    resubscribe: input.resubscribe !== false,
  };
  if (input.will) {
    optionsOnly(input.will, ['topic', 'payload', 'qos', 'retain']);
    if (input.will.retain !== undefined && typeof input.will.retain !== 'boolean')
      throw error('Invalid MQTT retain option', 'ERR_MQTT_OPTIONS');
    result.will = { topic: topic(input.will.topic), payload: bytes(input.will.payload ?? ''), qos: qos(input.will.qos), retain: input.will.retain ?? false };
  }
  return result;
}

function transport(uri, id) {
  // Each connection has its own upstream module closure and ephemeral store.
  // Nothing is written into the browser's localStorage, including QoS 1 data.
  const data = Object.create(null);
  let storedBytes = 0;
  const storage = {
    setItem(key, value) {
      const size = storedBytes - (data[key]?.length || 0) + value.length;
      if (size > MAX_PENDING_BYTES * 4) throw error('MQTT storage limit reached', 'ERR_MQTT_LIMIT');
      storedBytes = size;
      data[key] = value;
    },
    getItem: key => data[key] ?? null,
    removeItem(key) { storedBytes -= data[key]?.length || 0; delete data[key]; },
  };
  const Paho = createPaho({ WebSocket: globalThis.WebSocket, ArrayBuffer, localStorage: storage });
  const client = new Paho.Client(uri, id);
  client.disconnectedPublishing = false;
  client.disconnectedBufferSize = 0;
  return {
    client,
    message: payload => new Paho.Message(payload),
    dispose(graceful) {
      try { if (graceful && client.isConnected()) client.disconnect(); }
      finally {
        client._hubAbort();
        for (const key of Object.keys(data)) delete data[key];
        storedBytes = 0;
      }
    },
  };
}

export class HubMqttClient {
  constructor(uri, input = {}, createTransport = transport) {
    const url = new URL(uri);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw error('Hub MQTT requires a ws:// or wss:// URL without credentials or fragment', 'ERR_MQTT_OPTIONS');
    this.options = clientOptions(input);
    this.uri = url.href;
    this.connected = false;
    this.disconnecting = false;
    this.reconnecting = false;
    this._factory = createTransport;
    this._events = new Map();
    this._pending = new Map();
    this._pendingBytes = 0;
    this._subscriptions = new Map();
    this._subscriptionRequests = new Map();
    this._ended = false;
    this._session = null;
    this._retry = null;
    this._generation = 0;
    queueMicrotask(() => this._start());
  }
  on(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('MQTT listener must be a function');
    const listeners = this._events.get(event) || [];
    listeners.push(listener);
    this._events.set(event, listeners);
    return this;
  }
  once(event, listener) {
    const wrapped = (...args) => { this.off(event, wrapped); listener(...args); };
    wrapped.listener = listener;
    return this.on(event, wrapped);
  }
  off(event, listener) {
    this._events.set(event, (this._events.get(event) || []).filter(fn => fn !== listener && fn.listener !== listener));
    return this;
  }
  removeListener(event, listener) { return this.off(event, listener); }
  _emit(event, ...args) {
    for (const listener of [...(this._events.get(event) || [])]) {
      try { listener(...args); }
      catch (cause) { queueMicrotask(() => { throw cause; }); }
    }
  }
  _start() {
    if (this._ended || this._session) return;
    clearTimeout(this._retry);
    this._retry = null;
    let session;
    try {
      session = this._factory(this.uri, this.options.clientId);
      this._session = session;
      const current = () => this._session === session && !this._ended;
      const failed = failure => {
        if (current()) this._lost(error(failure?.errorMessage || 'MQTT connection lost', failure?.errorCode || 'ERR_MQTT_CONNECTION'));
      };
      session.client.onConnectionLost = failed;
      session.client.onMessageDelivered = message => {
        if (current()) queueMicrotask(() => this._finish(message));
      };
      session.client.onMessageArrived = message => {
        if (!current() || !this.connected) return;
        const payload = new Uint8Array(message.payloadBytes);
        Object.defineProperty(payload, 'toString', { value: () => decoder.decode(payload) });
        this._emit('message', message.destinationName, payload, { qos: message.qos, retain: message.retained, dup: message.duplicate });
      };
      session.timer = setTimeout(() => {
        if (current()) this._lost(error('MQTT connection timed out', 'ETIMEDOUT'));
      }, this.options.connectTimeout);
      const opts = {
        timeout: this.options.connectTimeout / 1000,
        keepAliveInterval: this.options.keepalive,
        cleanSession: true,
        mqttVersion: 4,
        reconnect: false,
        onFailure: failed,
        onSuccess: () => {
          if (!current()) return;
          clearTimeout(session.timer);
          this.connected = true;
          this.reconnecting = false;
          if (this.options.resubscribe) {
            // At most two packets, so restoring the supported 128 filters does
            // not exceed the 64-operation inflight limit.
            for (const level of [0, 1]) {
              const filters = [...this._subscriptions].filter(([, value]) => value === level).map(([filter]) => filter);
              if (filters.length) this.subscribe(filters, { qos: level });
            }
          }
          this._emit('connect', { sessionPresent: false });
        },
      };
      if (this.options.username !== undefined) opts.userName = this.options.username;
      if (this.options.password !== undefined) opts.password = this.options.password;
      if (this.options.will) {
        opts.willMessage = session.message(this.options.will.payload);
        opts.willMessage.destinationName = this.options.will.topic;
        opts.willMessage.qos = this.options.will.qos;
        opts.willMessage.retained = this.options.will.retain;
      }
      session.client.connect(opts);
    } catch (cause) {
      this._lost(cause);
    }
  }
  _drop(cause, graceful = false) {
    this._generation++;
    const session = this._session;
    this._session = null; // Invalidate callbacks before any synchronous disposal.
    this.connected = false;
    clearTimeout(session?.timer);
    try { session?.dispose(graceful); } catch { /* Socket is already closed. */ }
    for (const key of [...this._pending.keys()]) this._finish(key, cause);
  }
  _lost(cause) {
    this._drop(cause);
    const generation = this._generation;
    this._emit('error', cause);
    this._emit('close');
    if (!this._ended && generation === this._generation && this.options.reconnectPeriod > 0) {
      this.reconnecting = true;
      this._emit('offline');
      if (this._ended || generation !== this._generation) return;
      this._retry = setTimeout(() => {
        if (this._ended || generation !== this._generation) return;
        this._retry = null;
        this._emit('reconnect');
        if (generation === this._generation) this._start();
      }, this.options.reconnectPeriod);
    }
  }
  _reject(cause, callback) {
    queueMicrotask(() => callback ? callback(cause) : this._emit('error', cause));
    return this;
  }
  _operation(key, size, callback) {
    if (!this.connected || this.disconnecting) throw error('MQTT is offline; command was not queued', 'ERR_MQTT_OFFLINE');
    if (this._pending.size >= MAX_PENDING || this._pendingBytes + size > MAX_PENDING_BYTES)
      throw error('Too many pending MQTT operations', 'ERR_MQTT_LIMIT');
    const item = { callback, size, timer: setTimeout(() => {
      // Closing also releases Paho's own unacknowledged packet state.
      this._lost(error('MQTT acknowledgement timed out', 'ETIMEDOUT'));
    }, this.options.ackTimeout) };
    this._pending.set(key, item);
    this._pendingBytes += size;
  }
  _finish(key, cause, result) {
    const item = this._pending.get(key);
    if (!item) return;
    this._pending.delete(key);
    this._subscriptionRequests.delete(key);
    this._pendingBytes -= item.size;
    clearTimeout(item.timer);
    queueMicrotask(() => {
      if (item.callback) item.callback(cause || null, result);
      else if (cause) this._emit('error', cause);
    });
  }
  publish(destination, payload, options = {}, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    let key;
    try {
      optionsOnly(options, ['qos', 'retain']);
      const name = topic(destination), body = bytes(payload), level = qos(options.qos);
      if (options.retain !== undefined && typeof options.retain !== 'boolean') throw error('Invalid MQTT retain option', 'ERR_MQTT_OPTIONS');
      if (!this.connected) throw error('MQTT is offline; command was not queued', 'ERR_MQTT_OFFLINE');
      key = this._session.message(body);
      key.destinationName = name;
      key.qos = level;
      key.retained = options.retain ?? false;
      this._operation(key, body.length + encoder.encode(name).length, callback);
      this._session.client.send(key);
    } catch (cause) {
      if (this._pending.has(key)) this._lost(cause);
      else this._reject(cause, callback);
    }
    return this;
  }
  subscribe(filters, options = {}, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const key = Symbol('subscribe');
    try {
      optionsOnly(options, ['qos']);
      const names = (Array.isArray(filters) ? filters : [filters]).map(name => topic(name, true));
      const level = qos(options.qos);
      const reserved = [...this._subscriptionRequests.values()].flatMap(request => request.names);
      const wanted = new Set([...this._subscriptions.keys(), ...reserved, ...names]);
      if (!names.length || wanted.size > MAX_SUBSCRIPTIONS || [...wanted].reduce((size, name) => size + encoder.encode(name).length, 0) > MAX_PENDING_BYTES)
        throw error('Too many MQTT subscriptions', 'ERR_MQTT_LIMIT');
      this._operation(key, names.reduce((size, name) => size + encoder.encode(name).length, 0), callback);
      const request = { names, cancelled: new Set() };
      this._subscriptionRequests.set(key, request);
      const complete = response => {
        if (!this._pending.has(key)) return;
        const grantedQos = response.grantedQos || ((Array.isArray(response.errorCode) || ArrayBuffer.isView(response.errorCode)) ? response.errorCode : []);
        const granted = names.map((name, i) => ({ topic: name, qos: grantedQos[i] ?? 128 }));
        for (const grant of granted)
          if (grant.qos <= 1 && !request.cancelled.has(grant.topic)) this._subscriptions.set(grant.topic, level);
        const cause = granted.some(grant => grant.qos !== 0 && grant.qos !== 1) ? error('MQTT subscription rejected', 'ERR_MQTT_SUBACK') : null;
        this._finish(key, cause, granted);
      };
      this._session.client.subscribe(names, { qos: level, onSuccess: complete, onFailure: complete });
    } catch (cause) {
      if (this._pending.has(key)) this._lost(cause);
      else this._reject(cause, callback);
    }
    return this;
  }
  unsubscribe(filters, options = {}, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const key = Symbol('unsubscribe');
    try {
      optionsOnly(options, []);
      const names = (Array.isArray(filters) ? filters : [filters]).map(name => topic(name, true));
      if (!names.length) throw error('Missing MQTT topic filter', 'ERR_MQTT_TOPIC');
      this._operation(key, names.reduce((size, name) => size + encoder.encode(name).length, 0), callback);
      // Removing a device must remain effective after reconnect, even if an
      // older SUBACK or this UNSUBACK gets lost during the disconnect.
      for (const name of names) {
        this._subscriptions.delete(name);
        for (const request of this._subscriptionRequests.values())
          if (request.names.includes(name)) request.cancelled.add(name);
      }
      this._session.client.unsubscribe(names, { onSuccess: () => {
        if (!this._pending.has(key)) return;
        this._finish(key);
      } });
    } catch (cause) {
      if (this._pending.has(key)) this._lost(cause);
      else this._reject(cause, callback);
    }
    return this;
  }
  reconnect(options) {
    if (options !== undefined) throw error('Hub reconnect does not accept new connection options', 'ERR_MQTT_OPTIONS');
    clearTimeout(this._retry);
    this._retry = null;
    this._ended = false;
    this.disconnecting = false;
    this._drop(error('MQTT connection restarted', 'ERR_MQTT_RECONNECT'), true);
    this.reconnecting = true;
    this._emit('reconnect');
    queueMicrotask(() => this._start());
    return this;
  }
  end(force = false, options = {}, callback) {
    if (typeof force === 'function') { callback = force; force = false; options = {}; }
    if (typeof options === 'function') { callback = options; options = {}; }
    optionsOnly(options, []);
    this._ended = true;
    this.disconnecting = true;
    this.reconnecting = false;
    clearTimeout(this._retry);
    const hadSession = Boolean(this._session);
    this._drop(error('MQTT client ended', 'ERR_MQTT_ENDED'), !force);
    queueMicrotask(() => {
      if (this._ended) {
        if (hadSession) this._emit('close');
        this._emit('end');
      }
      callback?.();
    });
    return this;
  }
}

export function connect(uri, options) { return new HubMqttClient(uri, options); }
export default { connect };
