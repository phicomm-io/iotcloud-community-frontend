import {test,expect} from '@playwright/test';
const address='http://192.168.1.18',mac='aabbccdd0011';
test('IP entry before login opens backendless controls and keeps passwords out of storage',async({page})=>{
 const backends=[],errors=[];let local=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==address){if(local)backends.push(url.href);await route.fulfill({json:{enabled:false,providers:[]}});return;}
  expect(route.request().headers().authorization).toBe('Basic '+Buffer.from('admin:secret').toString('base64'));
  let data={device_id:mac,model:'m1',api_version:1,version:'1.0',ip:'192.168.1.18',pm25:10,temperature:25,humidity:60,mqtt_connected:false};
  if(url.pathname==='/api/v1/command'){
   const request=route.request().postDataJSON();
   if(request.action==='capabilities.get')data={actions:['status.get','config.get','config.set']};
   else if(request.action!=='status.get')data={};
  }
  await route.fulfill({json:{code:'ok',data}});
 });
 await page.goto('/#/login');
 const form=page.getByRole('region',{name:'本地直连'});
 await form.getByLabel('设备 IP',{exact:true}).fill('192.168.1.18');
 await form.getByLabel('设备网页管理密码').fill('secret');
 local=true;
 await form.getByRole('button',{name:'连接本地设备'}).click();
 await expect(page).toHaveURL(/#\/local$/);
 await expect(page.locator('.device-heading')).toContainText('内网已连接');
 await expect(page.getByRole('link',{name:'登录',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await expect(page.getByRole('heading',{name:'设备管理',exact:true})).toBeVisible();
 await expect(page.getByText('平台节点',{exact:true})).toHaveCount(0);
 await page.waitForTimeout(500);
 const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
 expect(storage).not.toContain('secret');expect(storage).toContain(address);
 expect(backends).toEqual([]);expect(errors).toEqual([]);
});
test('local route starts without backend requests and rejects public IP before fetching',async({page})=>{
 const requests=[];await page.route('**/api/**',async route=>{requests.push(route.request().url());await route.abort();});
 await page.goto('/#/local');
 await page.getByLabel('设备 IP',{exact:true}).fill('8.8.8.8');
 await page.getByRole('button',{name:'连接本地设备'}).click();
 await expect(page.getByRole('alert')).toContainText('内网');
 expect(requests).toEqual([]);
});
