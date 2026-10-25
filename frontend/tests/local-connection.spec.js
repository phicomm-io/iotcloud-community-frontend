import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {networkInterfaces} from 'node:os';
const mac='aabbccdd0011',secret='fixture-only-web-password';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
let address,server;
const evidence=process.env.LOCAL_CONNECT_EVIDENCE;
async function screenshot(page,name){if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});}}

const browserName=process.env.BROWSER||'chromium';
test.use({browserName,channel:undefined,launchOptions:browserName==='webkit'&&process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH?{executablePath:process.env.PHICOMM_WEBKIT_EXECUTABLE_PATH}:{}});
// A real, local HTTP endpoint also exercises WebKit's cross-origin Basic path.
// Its target is this test runner's interface, never a device on the LAN.
test.beforeAll(async()=>{
 const ip=Object.values(networkInterfaces()).flat().find(i=>i.family==='IPv4'&&!i.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
 if(!ip)throw Error('No private IPv4 interface for the local HTTP fixture');
 server=createServer(async(req,res)=>{
  const headers={...cors,'Content-Type':'application/json'};
  if(req.method==='OPTIONS')return res.writeHead(204,headers).end();
  if(req.headers.authorization!=='Basic '+Buffer.from('admin:'+secret).toString('base64'))return res.writeHead(401,headers).end(JSON.stringify({code:'unauthorized'}));
  let body='';for await(const chunk of req)body+=chunk;
  let data={device_id:mac,model:'m1',api_version:1,version:'1.0',ip,pm25:10,temperature:25,humidity:60,mqtt_connected:false};
  if(req.method==='POST'){
   const command=JSON.parse(body);
   if(command.action==='capabilities.get')data={actions:['status.get','config.get','config.set']};
   else if(command.action!=='status.get')data={};
  }
  res.writeHead(200,headers).end(JSON.stringify({code:'ok',data}));
 });
 await new Promise(done=>server.listen(0,'0.0.0.0',done));address=`http://${ip}:${server.address().port}`;
});
test.afterAll(async()=>{if(server)await new Promise(done=>server.close(done));});
 for(const language of ['zh-CN','en'])for(const width of [390,1440])test(`collapsed login/local entry, private connection and navigation ${language} ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});
  await page.addInitScript(language=>localStorage.setItem('phicomm.language',language),language);
  const zh=language==='zh-CN',title=zh?'本地连接':'Local connection',ip=zh?'设备 IP':'Device IP',password=zh?'设备网页管理密码':'Device web management password';
  const backends=[],errors=[];let local=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==address){if(local)backends.push(url.href);await route.fulfill({json:{enabled:false,providers:[]}});return;}
   await route.continue();
  });
  await page.goto('/#/login');
  let form=page.getByRole('region',{name:title}),toggle=form.getByRole('button',{name:title,exact:true});
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(toggle).toHaveAttribute('aria-controls','local-connect-details');
  await expect(form.getByLabel(ip,{exact:true})).toBeHidden();
  await expect(form.getByLabel(password,{exact:true})).toBeHidden();
  await expect(form.getByRole('button')).toHaveCount(1);
  await expect(form.getByRole('link')).toHaveCount(0);
  await screenshot(page,`${browserName}-${language}-${width}-login-collapsed`);
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded','true');
  await expect(form.getByLabel(ip,{exact:true})).toBeVisible();
  await expect(form.getByLabel(password,{exact:true})).toBeVisible();
  await expect(form).toContainText(zh?'无需账号 · 无需后端':'No account · No backend');
  await screenshot(page,`${browserName}-${language}-${width}-login-expanded`);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(form.getByLabel(ip,{exact:true})).toBeHidden();
  await expect(toggle).toBeFocused();await toggle.press('Enter');
  await form.getByLabel(ip,{exact:true}).fill(address);
  await form.getByLabel(password,{exact:true}).fill(secret);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  local=true;
  await form.getByRole('button',{name:zh?'连接本地设备':'Connect local device',exact:true}).click();
  await expect(page).toHaveURL(/#\/local$/);
  await expect(page.locator('.device-heading')).toContainText(zh?'内网已连接':'LAN connected');
  await expect(page.getByRole('link',{name:zh?'登录':'Sign in',exact:true})).toHaveCount(0);
  form=page.getByRole('region',{name:title});toggle=form.getByRole('button',{name:title,exact:true});
  await expect(toggle).toHaveAttribute('aria-expanded','false');
  await expect(form.getByLabel(ip,{exact:true})).toBeHidden();
  await screenshot(page,`${browserName}-${language}-${width}-local-connected`);
  await toggle.click();await expect(form.getByLabel(password,{exact:true})).toHaveValue('');
  await toggle.click();await expect(form.getByLabel(password,{exact:true})).toBeHidden();
  await page.getByRole('button',{name:zh?'设置':'Settings',exact:true}).click();
  await expect(page.getByRole('heading',{name:zh?'设备管理':'Device management',exact:true})).toBeVisible();
  await expect(page.getByText(zh?'平台节点':'Platform node',{exact:true})).toHaveCount(0);
  await page.waitForTimeout(500);
  const storage=await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
  expect(storage).not.toContain(secret);expect(storage).toContain(address);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(backends).toEqual([]);expect(errors).toEqual([]);
 });

 test('local route rejects public IP before fetching, then connects and clears the form password without navigation',async({page})=>{
  const requests=[];
  await page.route('**/api/**',async route=>{
   const request=route.request();requests.push(request.url());
   if(new URL(request.url()).origin===address)return route.continue();
   await route.abort();
  });
  await page.goto('/#/local');
  await expect(page.getByLabel('设备 IP',{exact:true})).toBeHidden();
  await page.getByRole('button',{name:'本地连接',exact:true}).click();
  await page.getByLabel('设备 IP',{exact:true}).fill('8.8.8.8');
  await page.getByRole('button',{name:'连接本地设备'}).click();
  await expect(page.getByRole('alert')).toContainText('内网');
  expect(requests).toEqual([]);
  await page.getByLabel('设备 IP',{exact:true}).fill(address);
  await page.getByLabel('设备网页管理密码',{exact:true}).fill(secret);
  await page.getByRole('button',{name:'连接本地设备'}).click();
  await expect(page.locator('.device-heading')).toContainText('内网已连接');
  await expect(page.getByLabel('设备网页管理密码',{exact:true})).toHaveValue('');
  await expect(page).toHaveURL(/#\/local$/);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(secret);
 });
