const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: esperar } = require('node:timers/promises');
const { apiRequire, validarLocal, env } = require('./persistencia-fixture.cjs');
process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
const { createHarness } = require('./pdf-harness.cjs');
const { chromium } = apiRequire('playwright');
const { PrismaClient } = apiRequire('@prisma/client');
const url = validarLocal(process.env.GAONA_PERSIST_TEST_DATABASE_URL);
const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
(async () => {
    const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    let server;
    try {
        let harness;
        async function start(port = 0) {
            harness = createHarness({ prisma: db, env, apiEnv: env, timeout: 1000 });
            harness.app.use(apiRequire('express').static(path.resolve(__dirname, '../Página')));
            server = http.createServer(harness.app);
            await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
            return server.address().port;
        }
        const port = await start();
        const base = `http://127.0.0.1:${port}`;
        const page = await browser.newPage({ acceptDownloads: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `const API_URL = ${JSON.stringify(base)};` }));
        await page.route('https://fonts.googleapis.com/**', r => r.abort());
        const id = randomUUID(), email = `browser-${id}@example.test`, description = `PRUEBA LOCAL CHROMIUM ${id}`;
        async function fill() {
            await page.goto(`${base}/cotizacion.html?producto=simulado-1`);
            await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
            for (const [name, value] of Object.entries({ nombre: 'Prueba', apellido: 'Persistencia local', telefono: '0000000000', correo: email, cantidad: '1', medidas: '90 x 210 cm', descripcion: description })) await page.locator(`[name="${name}"]`).fill(value);
        }
        await fill();
        let firstKey, first;
        await page.route('**/solicitudes', async route => {
            firstKey = route.request().headers()['idempotency-key'];
            const response = await route.fetch({ maxRetries: 0 });
            assert.equal(response.status(), 201);
            first = await response.json();
            await route.abort();
        });
        await page.locator('#submitQuote').click();
        await page.locator('#quoteError:visible').waitFor();
        let accepted = false;
        for (let attempt = 0; attempt < 200; attempt++) {
            const rows = await db.$queryRaw`SELECT estado FROM gaona_mensajeria.correos WHERE solicitud_id=${first.id}`;
            if (rows[0]?.estado === 'aceptado') { accepted = true; break; }
            await esperar(25);
        }
        assert.equal(accepted, true);
        assert.equal(harness.state.mailCalls, 1);
        const stored = await page.evaluate(() => sessionStorage.getItem('gaona-solicitud-intento-v1'));
        assert.ok(!stored.includes(email)); assert.ok(!stored.includes('Persistencia local')); assert.ok(!stored.includes('token'));
        await page.unroute('**/solicitudes');
        await new Promise(resolve => server.close(resolve));
        await start(port);
        await fill();
        let replayKey;
        await page.route('**/solicitudes', async route => { replayKey = route.request().headers()['idempotency-key']; await route.continue(); });
        await page.locator('#submitQuote').click();
        await page.locator('#quoteSuccess:visible').waitFor();
        await page.waitForFunction(() => document.getElementById('mailStatus').textContent.includes('aceptó el mensaje'));
        assert.equal(replayKey, firstKey);
        assert.equal(harness.state.mailCalls, 0);
        assert.equal(await db.solicitud.count({ where: { descripcion: description } }), 1);
        assert.match(await page.locator('#mailStatus').textContent(), /entrega final todavía no está confirmada/);
        const waiting = page.waitForEvent('download'); await page.locator('#downloadPdf').click();
        assert.equal(await (await waiting).failure(), null);
        for (const width of [1440, 768, 375, 320]) {
            await page.setViewportSize({ width, height: 900 });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            assert.equal(await page.locator('#downloadPdf').isVisible(), true);
        }
        assert.deepEqual(errors, []);
        const confirmedFolio = await page.locator('#quoteFolio').textContent();
        await page.reload();
        await page.locator('#previousQuote:visible').waitFor();
        assert.ok((await page.locator('#previousQuote').textContent()).includes(confirmedFolio.replace('Folio: ', '')));
        assert.equal(harness.state.mailCalls, 0);
        assert.equal(await db.solicitud.count({ where: { descripcion: description } }), 1);
        await page.close();
        console.log('PASS: Chromium con PostgreSQL local, respuesta perdida, recarga de página, reinicio API, misma clave y folio, cero reenvíos y PDF disponible.');
        console.log('PASS: sessionStorage sin datos personales ni tokens; confirmación responsive 1440/768/375/320 y cero excepciones JavaScript.');
    } finally {
        await browser.close();
        if (server?.listening) await new Promise(resolve => server.close(resolve));
        await db.$disconnect();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
