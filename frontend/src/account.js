
import {language,errorMessage} from './i18n.js';
import {apiURL, sessionToken} from './serverConfig';
import {hubMode} from './deployment.js';
import {createHubAccountTransport} from './hubAccountTransport.js';
import { reactive } from "vue";
import {forgetLogin} from "./connectionPreferences";
export const account = reactive({
  username: null,
  githubLogin: "",
  mqttUsername: null,
  aliases: [],
  isAdmin: false,
  password: "",
  loaded: false,
});
function expireAccount(){
  account.username = null;
  account.githubLogin = '';
  account.mqttUsername = null;
  account.aliases = [];
  account.isAdmin = false;
  account.password = '';
  if(!hubMode)forgetLogin();
  globalThis.window?.dispatchEvent(new Event('phicomm-session-expired'));
}
export const hubTransport=hubMode?createHubAccountTransport({onRequired:expireAccount}):null;
export async function api(path, options = {}) {
  let response;
  try{
  response = await (hubTransport?hubTransport.request:fetch)(apiURL(path), {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", "Accept-Language":language.value, ...(!hubMode&&sessionToken()?{Authorization: `Bearer ${sessionToken()}`} : {}), ...options.headers },
  });
  }catch(error){
    if(hubMode&&error.status===401){expireAccount();error.message=errorMessage({code:'unauthorized'},401);}
    throw error;
  }
  const token=response.headers.get('X-IotCloud-Session');
  if(!hubMode){if(token)sessionToken(token);if(path==='/auth/logout' || response.status===401)sessionToken('');}
  const data = await (hubTransport?hubTransport.decodeResponse(response):response.json()).catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/admin")) {
      expireAccount();
    }
    if (response.status === 403 && path.startsWith("/admin") && (data.code === 'admin_forbidden' || (!data.code && data.error === '\u6ca1\u6709\u7ba1\u7406\u6743\u9650'))) account.isAdmin = false;
    const error=new Error(errorMessage(data,response.status));error.code=data.code||'request_failed';error.status=response.status;error.reply=data;throw error;
  }
  if(data.message)data.message=errorMessage({message:data.message,message_key:data.message_key},response.status);
  return data;
}
export async function restoreAccount() {
  if (account.loaded) return;
  try {
    const data = await api("/auth/me");
    applyAccount(data);
  } catch {
    /* Guest access remains available. */
  }
  account.loaded = true;
}

export async function refreshAccountRole() {
  const owner = account.username;
  if (!owner) return;
  const data = await api("/auth/me");
  if (account.username === owner) applyAccount(data);
}

export function applyAccount(data) {
  account.githubLogin = data.github_login || "";
  account.username = data.username;
  account.mqttUsername = data.mqtt_username || data.username;
  account.aliases = data.aliases || [];
  account.isAdmin = data.is_admin === true;
}
