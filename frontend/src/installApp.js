import {shallowReactive} from 'vue';
import {isStandalone, installationPlatform} from './installation.js';

export const installation = shallowReactive({standalone: false, installed: false, platform: 'desktop', prompt: null});
let registered = false;

export function registerInstallPrompt() {
  if (registered || import.meta.env.VITE_DEMO === '1') return;
  registered = true;
  const update = () => {
    installation.standalone = isStandalone();
    installation.platform = installationPlatform();
  };
  update();
  window.matchMedia('(display-mode: standalone)').addEventListener('change', update);
  window.addEventListener('pageshow', update);
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installation.prompt = event;
    installation.installed = false;
    update();
  });
  window.addEventListener('appinstalled', () => {
    installation.prompt = null;
    installation.installed = true;
    update();
  });
}

export async function requestInstallation() {
  const prompt = installation.prompt;
  if (!prompt || installation.standalone || installation.installed) return null;
  // A native prompt can only be used once, and must run inside the user's click.
  installation.prompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  if (choice.outcome === 'accepted') installation.installed = true;
  return choice.outcome;
}
