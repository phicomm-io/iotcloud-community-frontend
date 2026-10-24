import {shallowReactive} from 'vue';
import {isStandalone, installationPlatform, readInstallPreference, saveInstallPreference} from './installation.js';
import {createStandaloneViewport} from './standaloneViewport.js';

export const installation = shallowReactive({standalone: false, installed: false, platform: 'desktop', prompt: null});
let registered = false;

export function registerInstallPrompt() {
  if (registered || import.meta.env.VITE_DEMO === '1') return;
  registered = true;
  installation.installed = readInstallPreference().installed === true;
  const viewport = createStandaloneViewport();
  const update = () => {
    installation.standalone = isStandalone();
    installation.platform = installationPlatform();
    if (installation.standalone && !installation.installed) confirmInstallation();
    viewport(installation.standalone);
  };
  update();
  const displayMode = window.matchMedia('(display-mode: standalone)');
  if (displayMode.addEventListener) displayMode.addEventListener('change', update);
  else displayMode.addListener(update);
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installation.prompt = event;
    installation.installed = false;
    update();
  });
  window.addEventListener('appinstalled', () => {
    confirmInstallation();
    update();
  });
}

export function confirmInstallation() {
  installation.prompt = null;
  installation.installed = true;
  return saveInstallPreference('installed');
}

export async function requestInstallation() {
  const prompt = installation.prompt;
  if (!prompt || installation.standalone || installation.installed) return null;
  // A native prompt can only be used once, and must run inside the user's click.
  installation.prompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') confirmInstallation();
  return choice.outcome;
}
