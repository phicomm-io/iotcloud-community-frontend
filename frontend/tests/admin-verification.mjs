// Browser signals are simulated; all requests use isolated fixtures, never real devices.
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium, webkit, expect} from '@playwright/test';
const root=resolve('dist'), evidence=resolve('../build/admin-verification');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://local').pathname;assert(path.startsWith('/iotcloud/'));const file=resolve(root,path.slice(10)||'index.html');assert(file.startsWith(root+'/'));res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.end(await readFile(file));}
 catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const base=`http://127.0.0.1:${server.address().port}/iotcloud/`;
await mkdir(evidence,{recursive:true});
const engines=process.env.BROWSER?[[process.env.BROWSER,{chromium,webkit}[process.env.BROWSER]]]:[['chromium',chromium],['webkit',webkit]];
try{for(const [engine,type] of engines){
 const browser=await type.launch();
 try{for(const width of [375,1280]){
  const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage(),errors=[];let isAdmin=true,expire=false,fail=false,requested=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url()),p=url.pathname;
   if(p==='/iotcloud/config.json')return route.fulfill({json:{}});
   if(p==='/api/auth/me')return route.fulfill({json:{username:'admin-fixture',is_admin:isAdmin}});
   if(p==='/api/admin/config')return route.fulfill({json:{register_level:2,contact_info:''}});
   if(p==='/api/admin/analytics')return route.fulfill({status:503,json:{error:'统计测试未启用'}});
   if(p==='/api/admin/verification-emails'){
    requested.push(url.searchParams);
    if(fail)return route.fulfill({status:503,json:{error:'记录加载失败，请重试'}});
    const now=Math.floor(Date.now()/1000),records=url.searchParams.get('page')==='2'?[]:[{id:1,email:'pending-with-a-long-address@example.com',created_at:now-60,sent_at:now-55,expires_at:expire?now-1:now+240,status:expire?'expired':'sent',code:expire?'':'112233'},...['registered','failed','expired','superseded','registration_failed','unknown'].map((status,i)=>({id:i+2,email:status+'@example.com',created_at:now-600,sent_at:status==='failed'||status==='unknown'?0:now-590,expires_at:now-290,status,username:status==='registered'?'new_user':'',registered_at:status==='registered'?now-580:0}))];
    return route.fulfill({json:{records,page:Number(url.searchParams.get('page')||1),page_size:50,total:51,days:30,server_time:now,summary:{sent_emails:5,registered_emails:1,unregistered_emails:4,expired_unregistered_emails:1,failed_attempts:1}}});
   }
   if(p.startsWith('/api/admin/'))return route.fulfill({json:[]});
   if(p.startsWith('/api/'))return route.fulfill({json:{}});
   return route.continue();
  });
  await page.goto(base+'#/admin');const section=page.getByRole('region',{name:'注册验证码记录'});
  await expect(section.locator('.verification-status').filter({hasText:'已发送，待注册'})).toBeVisible();
  await expect(section.getByLabel('有效验证码')).toHaveCount(0);
  await section.getByRole('button',{name:'查看验证码',exact:true}).click();await expect(section.getByLabel('有效验证码')).toHaveText('112233');
  await section.getByRole('button',{name:'隐藏验证码',exact:true}).click();await expect(section.getByLabel('有效验证码')).toHaveCount(0);
  await section.getByLabel('搜索邮箱').fill('pending');await section.getByRole('button',{name:'查询',exact:true}).click();await expect.poll(()=>requested.at(-1).get('email')).toBe('pending');
  await section.getByLabel('状态',{exact:true}).selectOption('expired');await expect.poll(()=>requested.at(-1).get('status')).toBe('expired');
  await section.getByRole('button',{name:'下一页',exact:true}).click();await expect(section.getByText('当前条件下暂无验证码记录。')).toBeVisible();
  await section.getByRole('button',{name:'上一页',exact:true}).click();await expect(section.getByRole('button',{name:'查看验证码',exact:true})).toBeVisible();
  await section.getByRole('button',{name:'查看验证码',exact:true}).click();expire=true;await section.getByRole('button',{name:'刷新记录',exact:true}).click();await expect(section.getByRole('button',{name:'查看验证码',exact:true})).toHaveCount(0);await expect(section.getByLabel('有效验证码')).toHaveCount(0);
  for(const control of await section.locator('input,select,button').all())assert((await control.boundingBox()).height>=40,'small form control');
  assert(await section.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'records overflow');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
  await section.screenshot({path:resolve(evidence,engine+'-'+width+'.png')});
  fail=true;await section.getByRole('button',{name:'刷新记录',exact:true}).click();await expect(section.getByRole('alert')).toHaveText('记录加载失败，请重试');await expect(section.getByLabel('有效验证码')).toHaveCount(0);
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log('PASS '+engine+': admin verification records, active-only code reveal, search/filter/pagination, expiry, errors and mobile/desktop layout');
 }finally{await browser.close();}
}}finally{await new Promise(done=>server.close(done));}
