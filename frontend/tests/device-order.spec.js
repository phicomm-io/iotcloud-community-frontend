import {test,expect} from '@playwright/test';
const devices=[{mac:'aabbccddee01',model:'tc1',version:'v1'},{mac:'aabbccddee02',model:'a1',version:'v2'},{mac:'aabbccddee03',model:'tc1',version:'v1'}];
const names=['插座 10','风机','插座 2'];
async function fixture(page,baseURL){
 await page.addInitScript(({baseURL,devices,names})=>{
  localStorage.setItem('phicomm.language','zh-CN');
  localStorage.setItem('phicomm.connection.'+baseURL+':sort-test','false');
  localStorage.setItem('phicomm.names.'+baseURL+':sort-test',JSON.stringify(Object.fromEntries(devices.map((d,i)=>[d.mac,names[i]]))));
 },{baseURL,devices,names});
 await page.route('**/config.json',r=>r.fulfill({json:{}}));
 await page.route('**/api/**',r=>{
  const path=new URL(r.request().url()).pathname;
  return r.fulfill({json:path==='/api/auth/me'?{username:'sort-test',mqtt_username:'sort-test'}:path==='/api/devices'?devices:{}});
 });
 await page.goto('/#/');
}
test('desktop sorting, custom persistence and settings share one order',async({page,baseURL})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1280,height:900});await fixture(page,baseURL);
 const panel=page.locator('.devices-panel'),labels=panel.locator('.rack-head b'),sort=panel.getByRole('combobox');
 await expect(labels).toHaveText(names);
 await sort.selectOption('name');await expect(labels).toHaveText(['插座 2','插座 10','风机']);
 await sort.selectOption('type');await expect(labels).toHaveText(['风机','插座 2','插座 10']);
 await sort.selectOption('custom');await expect(labels).toHaveText(names);
 await panel.getByRole('button',{name:'上移 插座 2',exact:true}).click();await expect(labels).toHaveText(['插座 10','插座 2','风机']);
 await page.reload();await expect(labels).toHaveText(['插座 10','插座 2','风机']);await expect(sort).toHaveValue('custom');
 await expect(panel.locator('.device-select[aria-pressed=true] .rack-head b')).toHaveText('插座 10');
 const geometry=await panel.locator('.tc1-body').first().evaluate(el=>({left:el.getBoundingClientRect().left,stat:el.querySelector('.stat').getBoundingClientRect().left}));expect(geometry.stat).toBe(geometry.left);
 await page.screenshot({path:'test-results/device-order-desktop.png'});
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:/设备管理/}).click();
 await expect(page.locator('.managed-device-list .rack-head b')).toHaveText(['插座 10','插座 2','风机']);
 await page.getByRole('combobox',{name:'设备排序'}).selectOption('name');
 await expect(page.locator('.managed-device-list .rack-head b')).toHaveText(['插座 2','插座 10','风机']);
 expect(errors).toEqual([]);
});
test('mobile picker reorders without selecting and fits the viewport',async({page,baseURL})=>{
 await page.setViewportSize({width:375,height:667});await fixture(page,baseURL);
 await page.locator('.device-picker-trigger').click();const picker=page.locator('.device-picker');
 await picker.getByRole('combobox').selectOption('custom');
 await picker.getByRole('button',{name:'下移 插座 10',exact:true}).click();
 await expect(picker.locator('.rack-head b')).toHaveText(['风机','插座 10','插座 2']);
 await expect(picker).toBeVisible();await expect(picker.locator('[aria-pressed=true] .rack-head b')).toHaveText('插座 10');
 await expect(picker.getByRole('button',{name:'上移 风机',exact:true})).toBeDisabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/device-order-mobile.png'});
 await page.keyboard.press('Escape');await expect(picker).not.toBeVisible();
});
