const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createHarness, valid, apiRequire } = require('./pdf-harness.cjs');
const { whatsappEnv, createStore, createMeta } = require('./whatsapp-cloud-harness.cjs');
const { chromium } = apiRequire('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    try {
        async function scenario(width, consent, mode = 'ok', enabled = true) {
            const meta = createMeta(); meta.state.mode = mode;
            const { app, state, whatsappStore } = createHarness({ whatsappEnv: enabled ? whatsappEnv : {}, whatsappStoreFactory: createStore, whatsappFetch: meta.fetch });
            app.use(apiRequire('express').static(path.resolve(__dirname, '../Página')));
            const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
            const base = `http://127.0.0.1:${server.address().port}`;
            const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
            const errors = []; let registrations = 0; const statusRequests = [];
            page.on('pageerror', e => errors.push(e.message));
            page.on('request', request => {
                if (request.url() === base + '/solicitudes') registrations++;
                if (request.url() === base + '/solicitudes/whatsapp/estado') statusRequests.push(request.postDataJSON());
            });
            try {
                await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
                await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: `const API_URL=${JSON.stringify(base)};` }));
                await page.goto(base + '/cotizacion.html?producto=simulado-1');
                await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
                assert.equal(await page.locator('#whatsappConsentimiento').count(), 0);
                assert.equal(await page.locator('#whatsappHint').count(), 0);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                for (const key of ['nombre', 'apellido', 'telefono', 'correo']) await page.locator(`[name="${key}"]`).fill(valid.cliente[key]);
                await page.evaluate(() => {
                    const form = document.getElementById('quoteForm');
                    form.dispatchEvent(new Event('submit', { cancelable: true }));
                    form.dispatchEvent(new Event('submit', { cancelable: true }));
                });
                await page.locator('#quoteSuccess:visible').waitFor();
                await page.locator('#manualSharingOptions summary').click();
                assert.equal(state.writes, 1); assert.equal(registrations, 1);
                assert.equal(await page.locator('#downloadPdf').isVisible(), true);
                assert.equal(await page.locator('#quoteSharing').isVisible(), true);
                assert.equal(await page.locator('#mailStatus').isVisible(), true);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                assert.equal(await page.locator('#whatsappStatus').count(), 0);
                assert.equal(await page.locator('#refreshWhatsapp').count(), 0);
                assert.equal(meta.state.calls.length, 0);
                assert.equal(statusRequests.length, 0);
                await page.evaluate(() => document.getElementById('quoteForm').dispatchEvent(new Event('submit', { cancelable: true })));
                assert.equal(state.writes, 1);
                assert.equal(registrations, 1);
                assert.deepEqual(errors, []);
            } finally { await page.close(); await new Promise(r => server.close(r)); }
        }
        for (const width of [1440, 768, 375, 320]) await scenario(width, true);
        await scenario(375, false);
        await scenario(375, true, 'ok', false);
        await scenario(375, true, 'ambiguous');
        console.log('PASS: formulario sin consentimiento ni estados automáticos WhatsApp; cero llamadas al proveedor');
        console.log('PASS: descarga y compartición manual conservadas sin controles automáticos; responsive 1440/768/375/320; cero duplicados y excepciones JS');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
