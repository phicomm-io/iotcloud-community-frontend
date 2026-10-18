// Isolated browser fixtures: no GitHub credentials, production accounts or devices.
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium,webkit,expect} from '@playwright/test';
const root=resolve('dist'),evidence=resolve('../build/github-login');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://local').pathname;assert(path.startsWith('/iotcloud/'));const file=resolve(root,path.slice(10)||'index.html');assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+'/iotcloud/';
await mkdir(evidence,{recursive:true});
async function fixture(browser,width,{enabled=true,existing=true,failStart=false,backendOrigin=origin}={}){
 const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 const state={enabled,existing,failStart,linked:'',session:false,starts:[],completions:[],proofs:new Map(),unlinkPassword:''};
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(url.origin==='https://github.com'){
   assert.equal(url.pathname,'/login/oauth/authorize');assert.equal(url.searchParams.size,1);
   return route.fulfill({status:302,headers:{Location:base+'#/github?ticket='+url.searchParams.get('state')}});
  }
  if(path==='/iotcloud/config.json')return route.fulfill({json:{apiOrigin:backendOrigin===origin?'':backendOrigin}});
  if(path==='/api/auth/github/status')return route.fulfill({json:{enabled:state.enabled}});
  if(path==='/api/auth/github/start'){
   if(state.failStart)return route.fulfill({status:503,json:{error:'GitHub 暂不可用，请重试'}});
   const body=request.postDataJSON(),ticket='fixture-ticket-'+state.starts.length;state.starts.push(body);state.proofs.set(ticket,body.browser_challenge);
   assert.equal(body.return_url,base);assert.match(body.browser_challenge,/^[a-f0-9]{64}$/);
   assert.equal(JSON.stringify(body).includes('password'),false);
   return route.fulfill({json:{authorization_url:'https://github.com/login/oauth/authorize?state='+ticket,ticket}});
  }
  if(path==='/api/auth/github/complete'){
   const body=request.postDataJSON();state.completions.push(body);
   assert.equal(createHash('sha256').update(body.browser_verifier).digest('hex'),state.proofs.get(body.ticket));
   if(!state.existing&&!body.username)return route.fulfill({json:{needs_registration:true,github_login:'octocat'}});
   if(body.username==='taken')return route.fulfill({status:409,json:{error:'用户名已被使用；已有账号请使用密码登录后绑定 GitHub'}});
   state.user=body.username||'alice';state.session=true;state.linked='octocat';
   return route.fulfill({headers:{'X-IotCloud-Session':'fixture-session','Access-Control-Expose-Headers':'X-IotCloud-Session'},json:{username:state.user,mqtt_username:state.user,github_login:state.linked,is_admin:false,aliases:[]}});
  }
  if(path==='/api/auth/github/unlink'){
   state.unlinkPassword=request.postDataJSON().current_password;
   if(state.unlinkPassword!=='website-secret')return route.fulfill({status:401,json:{error:'凭据错误'}});
   state.session=false;state.linked='';return route.fulfill({json:{ok:true}});
  }
  if(path==='/api/auth/me')return state.session?route.fulfill({json:{username:state.user||'alice',mqtt_username:state.user||'alice',github_login:state.linked,is_admin:false,aliases:[]}}):route.fulfill({status:401,json:{error:'请先登录'}});
  if(path==='/api/auth/login'){
   state.session=true;state.user='alice';return route.fulfill({headers:{'X-IotCloud-Session':'fixture-session','Access-Control-Expose-Headers':'X-IotCloud-Session'},json:{username:'alice',mqtt_username:'alice',github_login:state.linked,is_admin:false,aliases:[],mqtt_password_separate:true}});
  }
  if(path==='/api/register/status')return route.fulfill({json:{register_level:1,mqtt_uri:'',mqtt_ws_uri:''}});
  if(path==='/api/devices')return route.fulfill({json:[]});
  if(path.startsWith('/api/'))return route.fulfill({json:{}});
  if(url.origin!==origin)return route.abort();
  return route.continue();
 });
 await page.addInitScript(({scope})=>{for(const owner of ['alice','new-user','octocat'])localStorage.setItem('phicomm.connection.'+scope+':'+owner,'false');},{scope:backendOrigin});
 return {context,page,state,errors};
}
async function start(page){await page.getByRole('button',{name:'使用 GitHub 登录',exact:true}).click();}
try{for(const [engine,type] of (process.env.BROWSER?[[process.env.BROWSER,{chromium,webkit}[process.env.BROWSER]]]:[['chromium',chromium],['webkit',webkit]])){
 const browser=await type.launch();
 try{for(const width of [375,1280]){
  // New user, name conflict, MQTT initial password, token handoff and reload.
  let f=await fixture(browser,width,{existing:false,backendOrigin:'https://api.fixture.test'});
  await f.page.goto(base+'#/login');await expect(f.page.getByRole('button',{name:'使用 GitHub 登录'})).toBeVisible();
  await f.page.screenshot({path:resolve(evidence,engine+'-'+width+'-login.png')});await start(f.page);
  await expect(f.page.getByRole('heading',{name:'完成账号创建'})).toBeVisible();
  await f.page.getByLabel('平台用户名').fill('taken');await f.page.getByLabel('初始密码').fill('mqtt-secret');await f.page.getByRole('button',{name:'创建账号并登录'}).click();
  await expect(f.page.getByRole('alert')).toContainText('用户名已被使用');
  await f.page.getByLabel('平台用户名').fill('new-user');await f.page.screenshot({path:resolve(evidence,engine+'-'+width+'-registration.png')});
  await f.page.getByRole('button',{name:'创建账号并登录'}).click();await expect(f.page.getByRole('button',{name:'退出',exact:true})).toBeVisible();
  assert.equal(await f.page.evaluate(()=>localStorage.getItem('iotcloud.session.https://api.fixture.test')),'fixture-session');
  const saved=await f.page.evaluate(()=>JSON.parse(localStorage.getItem('phicomm.mqtt-login.https://api.fixture.test')));assert.equal(saved.password,'mqtt-secret');assert.equal(saved.owner,'new-user');
  assert.equal(await f.page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('iotcloud.github.')).length),0);
  await f.page.reload();await expect(f.page.getByRole('button',{name:'退出',exact:true})).toBeVisible();assert.deepEqual(f.errors,[]);await f.context.close();
  // Returning user on a new browser has no MQTT password; website login succeeds.
  f=await fixture(browser,width);await f.page.goto(base+'#/login');await start(f.page);await expect(f.page.getByRole('status')).toContainText('请在设置中填写 MQTT 密码');
  await f.page.getByRole('button',{name:'设置',exact:true}).click();await f.page.getByRole('button',{name:/账号安全/}).click();await expect(f.page.getByText('已绑定 @octocat。',{exact:false})).toBeVisible();
  await f.page.getByLabel('网站当前密码',{exact:true}).first().fill('website-secret');await f.page.getByRole('button',{name:'解除 GitHub 绑定并退出'}).click();await expect(f.page.getByRole('heading',{name:'登录',exact:true})).toBeVisible();
  assert.equal(f.state.unlinkPassword,'website-secret');assert.equal(await f.page.evaluate(()=>localStorage.getItem('iotcloud.session.'+location.origin)),null);assert.deepEqual(f.errors,[]);await f.context.close();
  // Existing password account explicitly binds GitHub without creating another user.
  f=await fixture(browser,width);await f.page.goto(base+'#/login');await f.page.getByLabel('用户名',{exact:true}).fill('alice');await f.page.getByLabel('密码',{exact:true}).fill('website-secret');await f.page.getByRole('button',{name:'登录',exact:true}).click();
  await f.page.getByRole('button',{name:'设置',exact:true}).click();await f.page.getByRole('button',{name:/账号安全/}).click();await f.page.getByRole('button',{name:'绑定 GitHub',exact:true}).click();
  await expect(f.page.getByText('GitHub 已绑定，可用它登录当前账号',{exact:true})).toBeVisible();assert.equal(f.state.starts[0].link,true);assert.equal(f.state.completions[0].username,'');
  assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');await f.page.screenshot({path:resolve(evidence,engine+'-'+width+'-linked.png')});assert.deepEqual(f.errors,[]);await f.context.close();
 }
 // No button when unconfigured; start failures remain recoverable.
 let f=await fixture(browser,375,{enabled:false});await f.page.goto(base+'#/login');await expect(f.page.getByRole('button',{name:'使用 GitHub 登录'})).toHaveCount(0);await f.context.close();
 f=await fixture(browser,375,{failStart:true});await f.page.goto(base+'#/login');await start(f.page);await expect(f.page.getByRole('alert').filter({hasText:'GitHub 暂不可用'})).toContainText('GitHub 暂不可用');await expect(f.page.getByRole('button',{name:'使用 GitHub 登录'})).toBeEnabled();await f.context.close();
 // A callback from another browser/tab has no proof and cannot redeem a session.
 f=await fixture(browser,375);await f.page.goto(base+'#/github?ticket=foreign-ticket');await expect(f.page.getByRole('alert')).toContainText('不属于当前节点');assert.equal(f.state.completions.length,0);await f.context.close();
 // A node switch invalidates a pending proof before it reaches another backend.
 f=await fixture(browser,375);await f.page.goto(base+'#/login');await expect(f.page.getByRole('button',{name:'使用 GitHub 登录'})).toBeVisible();await f.page.evaluate(()=>sessionStorage.setItem('iotcloud.github.old-ticket',JSON.stringify({verifier:'a'.repeat(64),scope:'https://other-node.test',created:Date.now()})));await f.page.goto(base+'#/github?ticket=old-ticket');await expect(f.page.getByRole('alert')).toContainText('不属于当前节点');assert.equal(f.state.completions.length,0);await f.context.close();
 console.log('PASS '+engine+': GitHub login, new account, conflicts, binding/unlink, Pages subpath, cross-origin session, missing proof, node isolation and disabled/error states');
 }finally{await browser.close();}
}}finally{await new Promise(done=>server.close(done));}
