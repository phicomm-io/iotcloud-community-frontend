import {test} from 'node:test';
import assert from 'node:assert/strict';
import {INSTALL_PREFERENCE_KEY, INSTALL_REMINDER_DELAY, readInstallPreference, saveInstallPreference, canOfferInstallation, isStandalone, installationPlatform} from './installation.js';
const storage = () => { const items = new Map(); return {getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value)}; };

test('reminders resume after seven days, while never survives future visits', () => {
  const s = storage(), now = 100000;
  assert(canOfferInstallation(readInstallPreference(s), now));
  saveInstallPreference('later', s, now);
  assert.equal(canOfferInstallation(readInstallPreference(s), now + INSTALL_REMINDER_DELAY - 1), false);
  assert.equal(canOfferInstallation(readInstallPreference(s), now + INSTALL_REMINDER_DELAY), true);
  saveInstallPreference('never', s, now);
  assert.equal(canOfferInstallation(readInstallPreference(s), now + 365 * 86400000), false);
});

test('invalid or unavailable storage does not break the page or its current-visit choice', () => {
  const s = storage();
  for (const raw of ['broken', 'null', '{}', '{"remindAt":"tomorrow"}', '{"remindAt":-1}']) {
    s.setItem(INSTALL_PREFERENCE_KEY, raw);
    assert(canOfferInstallation(readInstallPreference(s), 100));
  }
  const blocked = {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }};
  assert.deepEqual(readInstallPreference(blocked), {});
  assert.equal(canOfferInstallation(saveInstallPreference('never', blocked)), false);
});

test('current standalone display and Apple standalone flag are independent of user agent', () => {
  assert(isStandalone({matchMedia: () => ({matches: true}), navigator: {}}));
  assert(isStandalone({matchMedia: () => ({matches: false}), navigator: {standalone: true}}));
  assert.equal(isStandalone({matchMedia: () => ({matches: false}), navigator: {standalone: false}}), false);
});

test('install guidance distinguishes iPad desktop mode, Android and embedded browsers', () => {
  assert.equal(installationPlatform({userAgent: 'iPhone Safari'}), 'ios');
  assert.equal(installationPlatform({userAgent: 'Macintosh Safari', platform: 'MacIntel', maxTouchPoints: 5}), 'ios');
  assert.equal(installationPlatform({userAgent: 'Android Chrome'}), 'android');
  assert.equal(installationPlatform({userAgent: 'iPhone MicroMessenger Safari'}), 'in-app');
  assert.equal(installationPlatform({userAgent: 'Android; wv) Chrome'}), 'in-app');
  assert.equal(installationPlatform({userAgent: 'Windows Chrome'}), 'desktop');
});
