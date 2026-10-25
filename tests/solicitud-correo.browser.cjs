const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHarness, valid, apiRequire } = require('./pdf-harness.cjs');
const { chromium } = apiRequire('playwright');
const smtp = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-simulado', SMTP_PASSWORD: 'clave-simulada-no-real', SMTP_FROM: 'gaona@example.test' };
(async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    try {
        async function scenario({ width = 375, env = smtp, mode = 'accepted', withoutEmail = false, failPdf = false, lostResponse = false, delayed = false, lostStatus = false, expected }) {
            let terminar;
            const mailGate = delayed ? new Promise(resolve => { terminar = resolve; }) : undefined;
            const { app, state } = createHarness({ env, timeout: delayed ? 10000 : mode === 'pending' ? 20 : 1000, mailGate });
            state.mailMode = mode; state.failPdf = failPdf;
            app.use(apiRequire('express').static(path.resolve(__dirname, '../Página')));
            const server = http.createServer(app);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
            const base = `http://127.0.0.1:${server.address().port}`;
            const errors = [];
            page.on('pageerror', e => errors.push(e.message));
            try {
                await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `const API_URL = ${JSON.stringify(base)};` }));
                await page.route('https://fonts.googleapis.com/**', r => r.abort());
                if (lostStatus) await page.route('**/solicitudes/correo/estado', r => r.abort());
                await page.goto(`${base}/cotizacion.html?producto=simulado-1`);
                await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
                for (const field of ['nombre', 'apellido', 'telefono', 'correo']) {
                    if (field !== 'correo' || !withoutEmail) await page.locator(`[name="${field}"]`).fill(valid.cliente[field]);
                }
                if (lostResponse) {
                    let attempts = 0;
                    const keys = [];
                    await page.route('**/solicitudes', async route => {
                        keys.push(route.request().headers()['idempotency-key']);
                        if (attempts++ === 0) { await route.fetch(); await route.abort(); }
                        else await route.continue();
                    });
                    await page.locator('#submitQuote').click();
                    await page.locator('#quoteError:visible').waitFor();
                    assert.equal(state.writes, 1);
                    assert.equal(state.mailCalls, 1);
                    await page.locator('#submitQuote').click();
                    await page.locator('#quoteSuccess:visible').waitFor();
                    assert.equal(keys.length, 2);
                    assert.ok(keys[0]);
                    assert.equal(keys[0], keys[1]);
                } else {
                    await page.evaluate(() => {
                        const form = document.getElementById('quoteForm');
                        form.dispatchEvent(new Event('submit', { cancelable: true }));
                        form.dispatchEvent(new Event('submit', { cancelable: true }));
                    });
                    await page.locator('#quoteSuccess:visible').waitFor();
                }
                if (delayed) {
                    assert.match(await page.locator('#mailStatus').textContent(), /está en proceso/);
                    assert.equal(await page.locator('#downloadPdf').isVisible(), true);
                    assert.equal(state.mailCalls, 1);
                    assert.equal(state.messages.length, 0);
                    const downloaded = page.waitForEvent('download');
                    await page.locator('#downloadPdf').click();
                    assert.equal(await (await downloaded).failure(), null);
                    terminar();
                }
                await page.waitForFunction(([source, flags]) => new RegExp(source, flags).test(document.getElementById('mailStatus').textContent), [expected.source, expected.flags]);
                assert.match(await page.locator('#mailStatus').textContent(), expected);
                assert.equal(await page.locator('#quoteForm').isHidden(), true);
                assert.equal(await page.locator('#downloadPdf').isVisible(), true);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                assert.equal(state.writes, 1);
                assert.equal(state.mailCalls, withoutEmail || !env.MAIL_ENABLED || failPdf ? 0 : 1);
                state.failPdf = false;
                const waiting = page.waitForEvent('download');
                await page.locator('#downloadPdf').click();
                const download = await waiting;
                assert.equal(await download.failure(), null);
                assert.equal(state.writes, 1);
                if (process.env.GAONA_SCREENSHOT_DIR) {
                    await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                    await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, `correo-${mode}-${withoutEmail ? 'sin-correo' : !env.MAIL_ENABLED ? 'deshabilitado' : failPdf ? 'fallo-pdf' : 'smtp'}-${width}.png`), fullPage: true });
                }
                assert.deepEqual(errors, []);
            } finally {
                terminar?.();
                await page.close();
                await new Promise(resolve => server.close(resolve));
            }
        }
        for (const width of [1440, 768, 375, 320]) await scenario({ width, expected: /aceptó el mensaje.*entrega final todavía no está confirmada/ });
        await scenario({ env: {}, expected: /envío por correo no está disponible/ });
        await scenario({ withoutEmail: true, expected: /No proporcionaste correo electrónico/ });
        await scenario({ mode: 'EAUTH', expected: /No pudimos enviar el correo/ });
        await scenario({ mode: 'pending', expected: /No pudimos confirmar.*No se reenviará automáticamente/ });
        await scenario({ failPdf: true, expected: /No pudimos generar el adjunto/ });
        await scenario({ lostResponse: true, expected: /aceptó el mensaje/ });
        await scenario({ delayed: true, expected: /aceptó el mensaje/ });
        await scenario({ lostStatus: true, expected: /No pudimos confirmar.*No se reenviará automáticamente/ });
        console.log('PASS: estados de correo, PDF descargable tras error, respuesta perdida e idempotencia sin duplicados');
        console.log('PASS: aceptación simulada con Stream Transport, responsive 1440/768/375/320 px y cero excepciones JavaScript');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
