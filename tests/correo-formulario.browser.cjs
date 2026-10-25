const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createHarness, valid, apiRequire } = require('./pdf-harness.cjs');
const smtp = { MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.simulado.test', SMTP_PORT: '587', SMTP_SECURE: 'false',
    SMTP_USER: 'usuario-ficticio', SMTP_PASSWORD: 'clave-ficticia', SMTP_FROM: 'gaona@example.test' };
(async () => {
    const browser = await apiRequire('playwright').chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    try {
        for (const address of ['Cliente@protonmai.com', 'Cliente+pdf@empresa-poco-comun.technology']) {
            let release;
            const gate = new Promise(r => { release = r; });
            const { app, state } = createHarness({ entry: 'api-web.ts', env: smtp, mailGate: gate });
            app.use(apiRequire('express').static(path.resolve(__dirname, '../Página')));
            const server = http.createServer(app);
            await new Promise(r => server.listen(0, '127.0.0.1', r));
            const base = `http://127.0.0.1:${server.address().port}`;
            const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
            const errors = []; page.on('pageerror', e => errors.push(e.name));
            let posts = 0;
            page.on('request', r => { if (r.url() === base + '/solicitudes' && r.method() === 'POST') posts++; });
            try {
                await page.route('**/*', route => {
                    const u = new URL(route.request().url());
                    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return route.abort();
                    if (u.pathname === '/config.js') return route.fulfill({ contentType: 'text/javascript', body: `const API_URL=${JSON.stringify(base)};` });
                    return route.continue();
                });
                await page.goto(base + '/cotizacion.html?producto=simulado-1');
                await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
                await page.locator('#submitQuote').click();
                assert.match(await page.locator('#quoteError').textContent(), /campos marcados/);
                assert.equal(posts, 0);
                for (const field of ['nombre', 'apellido', 'telefono']) await page.locator(`[name="${field}"]`).fill(valid.cliente[field]);
                await page.locator('[name="correo"]').fill('cliente@incompleto');
                await page.locator('#submitQuote').click();
                assert.equal(await page.locator('[name="correo"]').getAttribute('aria-invalid'), 'true');
                assert.match(await page.locator('#quoteError').textContent(), /dirección completa válida/);
                assert.equal(posts, 0);
                await page.locator('[name="correo"]').fill('  ' + address + '  ');
                await page.locator('[name="correo"]').blur();
                assert.equal(await page.locator('[name="correo"]').inputValue(), address);
                if (address.endsWith('@protonmai.com')) assert.match(await page.locator('#correoHint').textContent(), /Quisiste escribir protonmail.com/);
                else assert.match(await page.locator('#correoHint').textContent(), /Dirección indicada/);
                await page.evaluate(() => {
                    const f = document.getElementById('quoteForm');
                    f.dispatchEvent(new Event('submit', { cancelable: true }));
                    f.dispatchEvent(new Event('submit', { cancelable: true }));
                });
                if (address.endsWith('@protonmai.com')) {
                    await page.locator('#emailReview:visible').waitFor();
                    assert.equal(posts, 0); assert.equal(state.writes, 0);
                    assert.equal(await page.evaluate(() => registrationAttempt), null);
                    await page.locator('#confirmEmail').click();
                }
                await page.locator('#quoteSuccess:visible').waitFor();
                assert.equal(posts, 1); assert.equal(state.writes, 1); assert.equal(state.mailCalls, 1);
                assert.equal(state.saved.cliente.create.correo, address);
                assert.match(await page.locator('#mailStatus').textContent(), /está en proceso/);
                assert.equal(await page.locator('#quoteRecipient').textContent(), 'Correo indicado: ' + address);
                release();
                await page.waitForFunction(() => document.getElementById('mailStatus').textContent.includes('aceptó el mensaje'));
                assert.equal(state.messages[0].message.to.address, address);
                const preview = await browser.newPage({ viewport: { width: 320, height: 900 } });
                try {
                    await preview.setContent(state.messages[0].message.html);
                    assert.equal(await preview.locator('h1').textContent(), 'GAONA');
                    assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                    assert.match(await preview.locator('body').textContent(), /Total estimado/);
                } finally { await preview.close(); }
                assert.match(await page.locator('#mailStatus').textContent(), /entrega final todavía no está confirmada/);
                const folio = state.messages[0].message.subject.split(' - ')[1];
                assert.equal(await page.locator('#quoteFolio').textContent(), 'Folio: ' + folio);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
                const stored = await page.evaluate(() => sessionStorage.getItem('gaona-solicitud-confirmada-v1'));
                assert.deepEqual(JSON.parse(stored), { id: folio });
                assert.ok(!stored.includes(address) && !stored.includes('token'));
                await page.reload();
                await page.locator('#previousQuote:visible').waitFor();
                assert.ok((await page.locator('#previousQuote').textContent()).includes(folio));
                assert.equal(posts, 1); assert.equal(state.writes, 1); assert.equal(state.mailCalls, 1);
                assert.deepEqual(errors, []);
            } finally { release(); await page.close(); await new Promise(r => server.close(r)); }
        }
        console.log('PASS Chromium: validación, aviso de dominio sin corrección ni bloqueo, espacios recortados, destinatario exacto, doble pulsación y folio conservado tras recarga sin envíos adicionales.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
