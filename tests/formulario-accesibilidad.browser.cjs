const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHarness, valid, apiRequire } = require('./pdf-harness.cjs');
const smtp = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-ficticio', SMTP_PASSWORD: 'clave-ficticia', SMTP_FROM: 'gaona@example.test' };
const chromiumOptions = { headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
(async () => {
    const browser = await apiRequire('playwright').chromium.launch(chromiumOptions);
    async function scenario(run, width = 375, setup) {
        const { app, state } = createHarness({ entry: 'api-web.ts', env: smtp });
        app.use(apiRequire('express').static(path.resolve(__dirname, '../Página')));
        const server = http.createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
        const base = `http://127.0.0.1:${server.address().port}`;
        const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.name));
        page.on('request', r => { if (r.url() === base + '/solicitudes' && r.method() === 'POST') requests.push(r); });
        try {
            await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
            await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: `const API_URL=${JSON.stringify(base)};` }));
            await setup?.(page);
            const fill = async (correo = 'Cliente@protonmai.com') => {
                await page.goto(base + '/cotizacion.html?producto=simulado-1');
                await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
                for (const [key, value] of Object.entries({ ...valid.cliente, correo, direccion: 'Calle Ficticia 10', descripcion: 'Café & nogal, 90 × 210 cm', cantidad: '2' })) await page.locator(`[name="${key}"]`).fill(value);
            };
            await run({ page, state, base, requests, fill });
            assert.deepEqual(errors, []);
        } finally { await page.close(); await new Promise(r => server.close(r)); }
    }
    try {
        await scenario(async ({ page, state, requests, fill }) => {
            await fill(); await page.locator('#submitQuote').click();
            await page.locator('#emailReview:visible').waitFor();
            assert.equal(requests.length, 0); assert.equal(state.writes, 0);
            assert.equal(await page.evaluate(() => registrationAttempt), null);
            assert.equal(await page.evaluate(() => sessionStorage.getItem('gaona-solicitud-intento-v1')), null);
            assert.equal(await page.locator('#correctEmail').evaluate(e => e === document.activeElement), true);
            await page.keyboard.press('Enter');
            assert.equal(await page.locator('[name="correo"]').evaluate(e => e === document.activeElement), true);
            assert.equal(await page.locator('[name="direccion"]').inputValue(), 'Calle Ficticia 10');
            assert.equal(await page.locator('[name="cantidad"]').inputValue(), '2');
            assert.equal(await page.locator('[name="descripcion"]').inputValue(), 'Café & nogal, 90 × 210 cm');
            await page.locator('[name="correo"]').fill('Cliente@protonmail.com');
            await page.locator('#submitQuote').click(); await page.locator('#quoteSuccess:visible').waitFor();
            await page.waitForFunction(() => document.querySelector('#mailStatus').textContent.includes('aceptó el mensaje'));
            assert.equal(requests.length, 1); assert.equal(state.writes, 1); assert.equal(state.mailCalls, 1);
            assert.equal(state.messages[0].message.to.address, 'Cliente@protonmail.com');
            assert.equal(state.saved.cliente.create.direccion, 'Calle Ficticia 10');
            assert.equal(await page.locator('#quoteSuccessTitle').evaluate(e => e === document.activeElement), true);
            assert.equal(await page.locator('#whatsappStatus').count(), 0);
            assert.equal(await page.locator('#manualSharingOptions').getAttribute('open'), null);
            assert.equal(await page.locator('#pdfStatus').textContent(), 'PDF listo para descargar.');
            assert.equal((await page.locator('#quoteSuccess').textContent()).match(/solicitud está registrada/gi)?.length || 0, 0);
            if (process.env.GAONA_SCREENSHOT_DIR) {
                await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, 'formulario-confirmacion-375.png'), fullPage: true });
            }
            const wait = page.waitForEvent('download'); await page.locator('#downloadPdf').click();
            assert.equal(await (await wait).failure(), null);
            assert.equal(state.mailCalls, 1);
        });
        await scenario(async ({ page, state, requests, fill }) => {
            await fill('  Cliente@protonmai.com  ');
            await page.locator('#submitQuote').click(); await page.locator('#emailReview:visible').waitFor();
            assert.equal(requests.length, 0);
            await page.locator('[name="correo"]').fill('OtraCuenta@protonmai.com');
            assert.equal(await page.locator('#emailReview').isHidden(), true);
            await page.locator('#submitQuote').click(); await page.locator('#emailReview:visible').waitFor();
            assert.ok((await page.locator('#emailReviewMessage').textContent()).includes('OtraCuenta@protonmai.com'));
            assert.equal(await page.evaluate(() => registrationAttempt), null);
            if (process.env.GAONA_SCREENSHOT_DIR) {
                await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, 'formulario-confirmar-correo-1440.png'), fullPage: true });
            }
            await page.locator('#confirmEmail').focus(); await page.keyboard.press('Enter');
            await page.locator('#quoteSuccess:visible').waitFor();
            await page.waitForFunction(() => document.querySelector('#mailStatus').textContent.includes('aceptó el mensaje'));
            assert.equal(requests.length, 1); assert.equal(state.mailCalls, 1); assert.equal(state.writes, 1);
            assert.equal(requests[0].postDataJSON().cliente.correo, 'OtraCuenta@protonmai.com');
            assert.equal(state.messages[0].message.to.address, 'OtraCuenta@protonmai.com');
        }, 1440);
        await scenario(async ({ page, state, requests, fill }) => {
            await fill('cliente@dominio-poco-comun.technology');
            assert.equal(await page.locator('#whatsappConsentimiento').count(), 0);
            assert.equal(await page.locator('#whatsappStatus').count(), 0);
            assert.equal(await page.locator('#whatsappHint').count(), 0);
            await page.locator('[name="telefono"]').fill('555abc5555');
            await page.locator('#submitQuote').click();
            assert.equal(requests.length, 0);
            assert.ok((await page.locator('[name="telefono"]').getAttribute('aria-describedby')).includes('quoteError'));
            assert.equal(await page.locator('[name="telefono"]').evaluate(e => e === document.activeElement), true);
            assert.equal(await page.locator('[name="telefono"]').evaluate(e => getComputedStyle(e).outlineStyle), 'solid');
            await page.locator('[name="telefono"]').fill(valid.cliente.telefono);
            const hold = deferred(), arrived = deferred();
            await page.route('**/solicitudes', async route => { arrived.resolve(); await hold.promise; await route.continue(); });
            await page.locator('#submitQuote').click(); await arrived.promise;
            assert.equal(await page.locator('#submitQuote').isDisabled(), true);
            assert.equal(await page.locator('#quoteForm').getAttribute('aria-busy'), 'true');
            assert.match(await page.locator('#quoteProgress').textContent(), /Estamos registrando/);
            await page.evaluate(() => document.getElementById('quoteForm').requestSubmit());
            assert.equal(requests.length, 1); hold.resolve();
            await page.locator('#quoteSuccess:visible').waitFor();
            assert.equal(await page.locator('#emailReview').isHidden(), true);
            assert.equal(state.writes, 1);
            assert.equal(requests[0].postDataJSON().whatsappConsentimiento, false);
        });
        await scenario(async ({ page, state, requests, fill }) => {
            await fill('cliente@example.test');
            const hold = deferred(), recorded = deferred(); let intercept = true;
            await page.route('**/solicitudes', async route => {
                if (!intercept) return route.continue();
                const response = await route.fetch({ maxRetries: 0 });
                assert.equal(response.status(), 201); recorded.resolve();
                await hold.promise; await route.fulfill({ response }).catch(() => {});
            });
            try {
                await page.locator('#submitQuote').click(); await recorded.promise;
                await page.evaluate(() => window.fireRegistrationTimeout());
                await page.locator('#quoteError:visible').waitFor();
                assert.match(await page.locator('#quoteError').textContent(), /No se reenviará automáticamente/);
                assert.equal(requests.length, 1); assert.equal(state.writes, 1); assert.equal(state.mailCalls, 1);
                const originalKey = requests[0].headers()['idempotency-key'];
                intercept = false; hold.resolve();
                await page.locator('#submitQuote').click(); await page.locator('#quoteSuccess:visible').waitFor();
                assert.equal(requests.length, 2); assert.equal(requests[1].headers()['idempotency-key'], originalKey);
                assert.equal(state.writes, 1); assert.equal(state.mailCalls, 1);
            } finally { hold.resolve(); }
        }, 375, page => page.addInitScript(() => {
            const original = window.setTimeout;
            window.setTimeout = (fn, ms, ...args) => {
                if (ms === 30000) window.fireRegistrationTimeout = () => fn(...args);
                return original(fn, ms, ...args);
            };
        }));
        await scenario(async ({ page, state, requests, fill }) => {
            await fill('cliente@example.test');
            const folio = '11111111-2222-4333-8444-555555555555';
            await page.route('**/solicitudes', route => route.fulfill({ status: 410, json: { codigo: 'COMPROBANTE_EXPIRADO', id: folio } }));
            await page.locator('#submitQuote').click(); await page.locator('#quoteError:visible').waitFor();
            assert.ok((await page.locator('#quoteError').textContent()).includes(folio));
            assert.equal(await page.locator('#submitQuote').isDisabled(), true);
            await page.evaluate(() => document.getElementById('quoteForm').requestSubmit());
            assert.equal(requests.length, 1); assert.equal(state.writes, 0); assert.equal(state.mailCalls, 0);
            await page.reload(); await page.locator('#previousQuote:visible').waitFor();
            assert.ok((await page.locator('#previousQuote').textContent()).includes(folio));
            assert.equal(requests.length, 1);
        });
        await scenario(async ({ page, base }) => {
            for (const width of [1440, 1280, 768, 375, 320]) {
                await page.setViewportSize({ width, height: 900 });
                for (const file of ['Inicio.html', 'Catalogo.html', 'cotizacion.html']) {
                    await page.goto(base + '/' + file);
                    if (file === 'Catalogo.html') await page.locator('.product-card').first().waitFor();
                    if (file === 'cotizacion.html') await page.locator('[name="producto"]').waitFor();
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${file} ${width}`);
                    assert.equal(await page.locator('main').count(), 1); assert.equal(await page.locator('h1').count(), 1);
                    assert.deepEqual(await page.locator('input,select,textarea').evaluateAll(controls => controls.filter(e => !e.closest('[hidden]') && !e.labels.length && !e.getAttribute('aria-label')).map(e => e.name)), []);
                    await page.keyboard.press('Tab');
                    assert.equal(await page.locator('.skip-link').evaluate(e => e === document.activeElement), true);
                    assert.ok(await page.locator('.skip-link').evaluate(e => e.getBoundingClientRect().top >= 0));
                    await page.keyboard.press('Enter');
                    assert.equal(await page.locator('#contenido').evaluate(e => e === document.activeElement), true);
                    const contrast = await page.locator('.btn-primary').first().evaluate(e => {
                        const s = getComputedStyle(e);
                        const lum = color => { const n = color.match(/[\d.]+/g).slice(0, 3).map(v => Number(v) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return n[0] * .2126 + n[1] * .7152 + n[2] * .0722; };
                        const values = [lum(s.color), lum(s.backgroundColor)].sort((a, b) => b - a);
                        return (values[0] + .05) / (values[1] + .05);
                    });
                    assert.ok(contrast >= 4.5, `${file}: contraste ${contrast}`);
                    if (process.env.GAONA_SCREENSHOT_DIR) {
                        await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                        await page.evaluate(() => document.activeElement.blur());
                        await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, `formulario-${file}-${width}.png`), fullPage: true });
                    }
                }
            }
        });
        console.log('PASS Chromium: corregir/confirmar dirección sospechosa sin clave ni registro previo, destinatario exacto, controles automáticos WhatsApp retirados, confirmación breve, descarga y timeout sin duplicados.');
        console.log('PASS Chromium: Inicio/catálogo/formulario a 1440/1280/768/375/320, etiquetas, teclado, foco visible, contraste y cero excepciones JavaScript; sin conexiones externas.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
