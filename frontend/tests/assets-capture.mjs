/** Read-only real library screenshots; accepts a running Vite URL through UI_BASE. */
import {chromium} from 'playwright'
const browser=await chromium.launch({headless:true})
const dir='docs/ui-review/assets-redesign'
const checks=[]
try {
for(const theme of ['dark','light','tactile']) {
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'})
 const writes=[]
 page.on('request',req=>{if(req.method()==='PATCH'&&req.url().includes('/assets/'))writes.push(req.url())})
 await page.addInitScript(theme=>{
  localStorage.setItem('fengmotion:api-config:v1',JSON.stringify({baseUrl:'http://127.0.0.1:8090/api'}))
  localStorage.setItem('fengmotion:settings',JSON.stringify({theme,reduceMotion:true}))
 },theme)
 await page.goto(`${process.env.UI_BASE||'http://127.0.0.1:5173'}/?view=assets`)
 await page.locator('.mya-card').first().waitFor()
 await page.locator('.mya-thumb img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode().catch(()=>{}))))
 await page.screenshot({path:`${dir}/after-${theme}-1440.png`})
 if(theme==='dark') {
  await page.locator('.mya-card').first().click()
  await page.locator('.mya-preview img').evaluate(img=>img.decode())
  await page.screenshot({path:`${dir}/detail-dark-1440.png`})
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  for(const [width,height] of [[1024,768],[768,800],[390,844]]) {
   await page.setViewportSize({width,height});await page.reload()
   await page.locator('.mya-card').first().waitFor()
   await page.locator('.mya-thumb img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode().catch(()=>{}))))
   await page.screenshot({path:`${dir}/real-${width}.png`})
   checks.push({width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)})
  }
 }
 checks.push({theme,writes})
 await page.close()
}
console.log(JSON.stringify(checks,null,2))
}finally{await browser.close()}
