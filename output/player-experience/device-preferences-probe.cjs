const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const url = 'http://127.0.0.1:8771/dist/index.html';
(async () => {
  const browser = await chromium.launch({headless:true});
  const evidence = [];
  let lastPage;
  try {
    for (const blocked of [false, true]) {
      const context = await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
      await context.addInitScript(blocked => {
        window.__vibrations = [];
        Object.defineProperty(navigator, 'vibrate', {configurable:true,value:ms => { window.__vibrations.push(ms); return true; }});
        if (blocked) {
          Storage.prototype.getItem = function () { throw new Error('test-storage-unavailable'); };
          Storage.prototype.setItem = function () { throw new Error('test-storage-unavailable'); };
          Storage.prototype.removeItem = function () { throw new Error('test-storage-unavailable'); };
        }
      }, blocked);
      const page = await context.newPage();
      lastPage = page;
      console.log('CHECK device preference storageBlocked=' + blocked);
      page.on('pageerror', error => console.log('PAGE ERROR: ' + error.message));
      await page.goto(url);
      await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
      await page.locator('#qixia-launch').waitFor({state:'detached'});
      await page.locator('[data-welcome-start]').click();
      await page.evaluate(() => { MergeUI.state().tutorial.completed = true; });
      await page.evaluate(() => MergeUI.openSettings());
      const toggle = page.locator('[data-ui-haptics-toggle]');
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute('aria-pressed'),'true');
      await toggle.click();
      assert.equal(await page.evaluate(() => MergeHaptics.pulse(8)),false);
      assert.equal(await page.evaluate(() => __vibrations.length),0);
      if (blocked) {
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-pressed'),'true');
        assert.equal(await page.evaluate(() => MergeHaptics.pulse(8)),true);
        evidence.push({storageUnavailable:true,sessionToggle:true,vibrationSuppressedWhenOff:true});
      } else {
        const exported = page.waitForEvent('download');
        await page.locator('[data-export-save]').click();
        const download = await exported;
        const payload = fs.readFileSync(await download.path());
        const parsed = JSON.parse(payload.toString());
        assert.equal(parsed.format,'shj-h5-save-export');
        assert.equal(JSON.stringify(parsed.data).includes('shj-merge-haptics-v1'),false);
        await page.locator('[data-import-save]').setInputFiles({name:'isolated-test-journey.json',mimeType:'application/json',buffer:payload});
        await page.locator('[data-confirm-import]').click();
        await page.waitForFunction(() => !document.querySelector('[data-confirm-import]'));
        assert.equal(await page.evaluate(() => MergeHaptics.isEnabled()),false);
        await page.evaluate(() => MergeUI.openSettings());
        await page.locator('[data-restart-journey]').click();
        await page.locator('[data-restart-journey][data-confirmed="true"]').click();
        await page.locator('[data-confirm-restart]').click();
        await page.waitForFunction(() => !document.querySelector('[data-confirm-restart]'));
        assert.equal(await page.evaluate(() => MergeHaptics.isEnabled()),false);
        await page.reload();
        await page.waitForFunction(() => window.MergeUI && window.__QIXIA_APP_READY__);
        assert.equal(await page.evaluate(() => MergeHaptics.isEnabled()),false);
        evidence.push({importRetainsDevicePreference:true,restartRetainsDevicePreference:true,reloadRetainsDevicePreference:true,notInJourneyPayload:true});
      }
      await context.close();
    }
    fs.writeFileSync(path.join(__dirname,'dist/device-preferences.json'),JSON.stringify({entry:url,result:'PASS',evidence},null,2));
    console.log('PASS device haptics: actual import/restart/reload retain preference; blocked storage session toggle works');
  } catch (error) {
    if (lastPage && !lastPage.isClosed()) {
      console.log(await lastPage.evaluate(() => ({modal:document.querySelector('#modal-root')?.innerText,haptics:typeof MergeHaptics,v14:document.body.className,settings:document.querySelector('.settings-modal')?.outerHTML.slice(0,150)})));
      await lastPage.screenshot({path:path.join(__dirname,'device-preferences-failure.png')});
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode=1; });
