import {api, account, applyAccount} from './account';
import {scopeKey} from './serverConfig';
import {rememberLogin, savedPassword} from './connectionPreferences';

const flowKey = ticket => 'iotcloud.github.' + ticket;
export async function startGitHub(link = false) {
 const bytes = crypto.getRandomValues(new Uint8Array(32));
 const verifier = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
 const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
 const challenge = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
 // Check tab storage before creating an authorization request. The proof remains
 // in this tab and is never included in the redirect URL or GitHub authorization.
 const proof = {verifier, scope: scopeKey(), created: Date.now(), link};
 sessionStorage.setItem('iotcloud.github.storage-check', '1');
 sessionStorage.removeItem('iotcloud.github.storage-check');
 for (const key of Object.keys(sessionStorage)) {
  if (!key.startsWith('iotcloud.github.')) continue;
  try {if (Date.now() - JSON.parse(sessionStorage.getItem(key)).created > 600000) sessionStorage.removeItem(key);} catch {sessionStorage.removeItem(key);}
 }
 const result = await api('/auth/github/start', {method:'POST', body:JSON.stringify({
  return_url: location.origin + location.pathname, browser_challenge:challenge, link,
 })});
 const authorization = new URL(result.authorization_url);
 if (authorization.origin !== 'https://github.com' || authorization.pathname !== '/login/oauth/authorize') throw Error('GitHub 授权地址无效');
 sessionStorage.setItem(flowKey(result.ticket), JSON.stringify(proof));
 location.assign(authorization.href);
}
export function githubProof(ticket) {
 let proof;
 try {proof = JSON.parse(sessionStorage.getItem(flowKey(ticket)));} catch {}
 if (!proof || proof.scope !== scopeKey() || Date.now() - proof.created > 600000 || !/^[a-f0-9]{64}$/.test(proof.verifier)) {
  throw Error('登录请求已失效或不属于当前节点，请返回后重新使用 GitHub 登录。');
 }
 return proof;
}
export async function completeGitHub(ticket, username = '', password = '') {
 const proof = githubProof(ticket);
 const result = await api('/auth/github/complete', {method:'POST', body:JSON.stringify({
  ticket, browser_verifier:proof.verifier, username, password,
 })});
 if (result.needs_registration) return result;
 applyAccount(result);
 account.password = proof.link ? account.password || savedPassword(account.username) : password || savedPassword(account.username);
 if (account.password) rememberLogin(account.username, account.password);
 account.loaded = true;
 sessionStorage.removeItem(flowKey(ticket));
 return {...result, linked:proof.link};
}
