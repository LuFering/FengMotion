const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1440, height: 960, show: true })
  await win.loadURL('http://localhost:5173/?view=knowledge')
  await new Promise((r) => setTimeout(r, 2000))

  // 点击 Remotion 画面代码库 Tab
  await win.webContents.executeJavaScript(`
    const tabs = Array.from(document.querySelectorAll('.fx-source-tab'));
    const t = tabs.find(x => x.textContent.includes('Remotion'));
    if (t) t.click();
  `)

  await new Promise((r) => setTimeout(r, 2000))

  // 点击第 1 张卡片打开详情抽屉
  await win.webContents.executeJavaScript(`
    const firstHit = document.querySelector('.fxc-hit');
    if (firstHit) firstHit.click();
  `)

  await new Promise((r) => setTimeout(r, 2500))

  const drawerImg = await win.capturePage()
  fs.writeFileSync('/home/lufering/.gemini/antigravity/brain/02bd2d8d-14db-488d-a7bf-6bacf9781e6e/scratch/remotion_drawer_render.png', drawerImg.toPNG())
  console.log('抽屉截图保存成功')

  app.quit()
})
