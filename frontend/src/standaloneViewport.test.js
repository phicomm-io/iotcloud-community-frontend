import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createStandaloneViewport} from './standaloneViewport.js';

function gesture(doc, type, extra = {}) {
  const event = new doc.defaultView.Event(type, {bubbles: true, cancelable: true});
  for (const [name, value] of Object.entries(extra)) Object.defineProperty(event, name, {value});
  doc.body.dispatchEvent(event);
  return event.defaultPrevented;
}

test('standalone blocks zoom, preserves single-finger input, and restores browser mode', () => {
  const {window} = new JSDOM('<meta name="viewport" content="width=device-width, initial-scale=1.0"><body></body>');
  try {
    const doc = window.document, viewport = doc.querySelector('meta'), original = viewport.content;
    const sync = createStandaloneViewport(doc);
    sync(false);
    assert.equal(gesture(doc, 'gesturestart'), false);
    sync(true);
    assert.match(viewport.content, /maximum-scale=1.*user-scalable=no/);
    for (const type of ['gesturestart', 'gesturechange']) assert.equal(gesture(doc, type), true);
    assert.equal(gesture(doc, 'touchmove', {touches: [{}, {}]}), true);
    assert.equal(gesture(doc, 'touchmove', {touches: [{}]}), false);
    assert.equal(gesture(doc, 'wheel', {ctrlKey: true}), true);
    assert.equal(gesture(doc, 'wheel', {ctrlKey: false}), false);
    assert.equal(gesture(doc, 'keydown', {ctrlKey: true, key: '+'}), true);
    assert.equal(gesture(doc, 'keydown', {ctrlKey: true, key: 'a'}), false);
    sync(true);
    assert.equal(doc.querySelectorAll('style').length, 1);
    sync(false);
    assert.equal(viewport.content, original);
    assert.equal(doc.querySelectorAll('style').length, 0);
    assert.equal(gesture(doc, 'gesturestart'), false);
    assert.equal(gesture(doc, 'touchmove', {touches: [{}, {}]}), false);
  } finally { window.close(); }
});

test('new device frames receive the same policy and temporary viewport tags are removed', () => {
  const {window} = new JSDOM('<body></body>');
  try {
    const doc = window.document, sync = createStandaloneViewport(doc);
    sync(true);
    const frame = doc.createElement('iframe');
    doc.body.append(frame);
    frame.dispatchEvent(new window.Event('load'));
    const child = frame.contentDocument;
    assert.match(child.querySelector('meta[name="viewport"]').content, /user-scalable=no/);
    assert.equal(gesture(child, 'gesturestart'), true);
    sync(false);
    for (const current of [doc, child]) {
      assert.equal(current.querySelector('meta[name="viewport"]'), null);
      assert.equal(current.querySelector('style'), null);
      assert.equal(gesture(current, 'gesturestart'), false);
    }
  } finally { window.close(); }
});
