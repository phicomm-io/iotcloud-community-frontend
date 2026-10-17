export const INSTALL_PREFERENCE_KEY = 'iotcloud.install-prompt';
export const INSTALL_REMINDER_DELAY = 7 * 24 * 60 * 60 * 1000;

export function isStandalone(windowObject = window) {
  return windowObject.matchMedia('(display-mode: standalone)').matches
    || windowObject.navigator.standalone === true;
}

export function installationPlatform(navigatorObject = navigator) {
  const ua = navigatorObject.userAgent || '';
  if (/MicroMessenger|QQ\/|Weibo|DingTalk|FBAN|FBAV|Instagram|; wv\)/i.test(ua)) return 'in-app';
  if (/iPhone|iPad|iPod/i.test(ua)
    || (navigatorObject.platform === 'MacIntel' && navigatorObject.maxTouchPoints > 1)) return 'ios';
  return /Android/i.test(ua) ? 'android' : 'desktop';
}

export function readInstallPreference(storage) {
  try {
    const value = JSON.parse((storage || globalThis.localStorage).getItem(INSTALL_PREFERENCE_KEY) || 'null');
    if (value?.never === true) return {never: true};
    if (Number.isFinite(value?.remindAt) && value.remindAt > 0) return {remindAt: value.remindAt};
  } catch { /* A disabled or invalid store must not break device controls. */ }
  return {};
}

export function canOfferInstallation(preference, now = Date.now()) {
  return preference.never !== true && !(preference.remindAt > now);
}

export function saveInstallPreference(choice, storage, now = Date.now()) {
  const value = choice === 'never' ? {never: true} : {remindAt: now + INSTALL_REMINDER_DELAY};
  try { (storage || globalThis.localStorage).setItem(INSTALL_PREFERENCE_KEY, JSON.stringify(value)); } catch { /* Still apply for this visit. */ }
  return value;
}
