const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { env } = require('./persistencia-fixture.cjs');
process.env.SOLICITUD_PDF_KEY = env.SOLICITUD_PDF_KEY;
const { apiRequire, conexiones, iniciarEntrada, iniciarSimulada, sembrar, datos, sha, root } = require('./web-postgres-lab.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
const { chromium } = apiRequire('playwright');

(async () => {
    const fresh = process.env.GAONA_WEB3_BROWSER === 'true';
    const urls = fresh ? { web: process.env.GAONA_WEB3_TEST_DATABASE_URL, admin: process.env.GAONA_WEB3_TEST_ADMIN_URL } : conexiones();
    if (fresh) {
        for (const [value,user] of [[urls.web,'gaona_web_publico_pruebas'],[urls.admin,'gaona_local_admin']]) {
            const parsed=new URL(value);
            assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.pathname,'/gaona_web3_aislada');
            assert.equal(parsed.username,user);assert.ok(parsed.port && parsed.port!=='5432');
        }
    }
    const entryConfig = fresh ? { WEB_DATABASE_URL: urls.web, WHATSAPP_IDEMPOTENCY_KEY: undefined } : {};
    const db = new PrismaClient({ datasources: { db: { url: urls.web } }, log: [] });
    const owner = new PrismaClient({ datasources: { db: { url: urls.admin } }, log: [] });
    const frontend = http.createServer(apiRequire('express')().use(apiRequire('express').static(path.join(root, 'Página'))));
    let browser, entry, simulated;
    try {
        const products = await sembrar(owner);
        await new Promise(resolve => frontend.listen(0, '127.0.0.1', resolve));
        const front = `http://127.0.0.1:${frontend.address().port}`;
        browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        async function pagina(base) {
            const page = await browser.newPage({ acceptDownloads: true });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
            await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: `const API_URL = ${JSON.stringify(base)};` }));
            return { page, errors };
        }
        async function llenar(page, input) {
            await page.waitForFunction(id => document.querySelector('[name="producto"]')?.value === id, products[0].id);
            await page.locator('[name="cantidad"]').fill('2');
            await page.locator('[name="medidas"]').fill('90 x 210 cm');
            await page.locator('#addItem').click();
            await page.locator('[name="producto"]').nth(1).selectOption(products[1].id);
            await page.locator('[name="cantidad"]').nth(1).fill('3');
            for (const [name, value] of Object.entries(input.cliente)) await page.locator(`[name="${name}"]`).fill(value);
            await page.locator('[name="descripcion"]').fill(input.descripcion);
            assert.match(await page.locator('#summaryTotal').textContent(), /2,900.7/);
        }

        entry = await iniciarEntrada(entryConfig);
        const actual = await pagina(entry.base);
        const input = datos(products);
        await actual.page.goto(front + '/Catalogo.html');
        await actual.page.locator(`a.quote-button[href="cotizacion.html?producto=${products[0].id}"]`).click();
        await llenar(actual.page, input);
        const keys = [];
        let original;
        await actual.page.route('**/solicitudes', async route => {
            keys.push(route.request().headers()['idempotency-key']);
            const response = await route.fetch({ maxRetries: 0 });
            assert.equal(response.status(), 201);
            original = await response.json();
            await route.abort();
        });
        await actual.page.locator('#submitQuote').click();
        await actual.page.locator('#quoteError:visible').waitFor();
        assert.equal(await owner.solicitud.count({ where: { descripcion: input.descripcion } }), 1);
        const stored = await actual.page.evaluate(() => sessionStorage.getItem('gaona-solicitud-intento-v1'));
        assert.ok(stored && !stored.includes(input.cliente.correo) && !stored.includes('token'));
        await actual.page.unroute('**/solicitudes');
        const port = entry.port;
        await entry.close(); entry = await iniciarEntrada({ ...entryConfig, WEB_PORT: String(port) });
        await actual.page.reload(); await llenar(actual.page, input);
        await actual.page.route('**/solicitudes', async route => { keys.push(route.request().headers()['idempotency-key']); await route.continue(); });
        await actual.page.locator('#submitQuote').click();
        await actual.page.locator('#quoteSuccess:visible').waitFor();
        assert.equal(await actual.page.evaluate(() => registeredQuote.id), original.id);
        assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
        assert.match(await actual.page.locator('#mailStatus').textContent(), /envío por correo no está disponible/);
        const waiting = actual.page.waitForEvent('download');
        await actual.page.locator('#downloadPdf').click();
        const download = await waiting;
        assert.equal(await download.failure(), null);
        const pdf = await fs.readFile(await download.path());
        const document = (await db.$queryRaw`SELECT pdf_sha256 FROM gaona_mensajeria.documentos WHERE solicitud_id=${original.id}`)[0];
        assert.equal(sha(pdf), document.pdf_sha256);
        assert.equal((await db.$queryRaw`SELECT intentos FROM gaona_mensajeria.correos WHERE solicitud_id=${original.id}`)[0].intentos, 0);
        for (const width of [1440, 768, 375, 320]) {
            await actual.page.setViewportSize({ width, height: 900 });
            assert.equal(await actual.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        }
        assert.equal(await entry.imports(), '');
        assert.deepEqual(actual.errors, []);
        await actual.page.close(); await entry.close(); entry = null;
        console.log('PASS: Chromium → web.ts real → PostgreSQL restringido: catálogo, formulario, respuesta perdida, reinicio, mismo folio y clave, PDF SHA-256 y correo desactivado.');

        const brevo = { ...env, SMTP_HOST: 'smtp-relay.brevo.com', SMTP_PORT: '587', SMTP_SECURE: 'false',
            SMTP_USER: 'usuario-brevo-simulado', SMTP_PASSWORD: 'clave-brevo-simulada', SMTP_FROM: 'remitente@example.test' };
        simulated = await iniciarSimulada(db, { env: brevo, apiEnv: brevo });
        const smtp = await pagina(simulated.base);
        const sentInput = datos(products);
        await smtp.page.goto(`${front}/cotizacion.html?producto=${products[0].id}`);
        await llenar(smtp.page, sentInput);
        await smtp.page.evaluate(() => {
            const form = document.getElementById('quoteForm');
            form.dispatchEvent(new Event('submit', { cancelable: true }));
            form.dispatchEvent(new Event('submit', { cancelable: true }));
        });
        await smtp.page.locator('#quoteSuccess:visible').waitFor();
        await smtp.page.waitForFunction(() => document.getElementById('mailStatus').textContent.includes('aceptó el mensaje'));
        const id = await smtp.page.evaluate(() => registeredQuote.id);
        const downloaded = smtp.page.waitForEvent('download');
        await smtp.page.locator('#downloadPdf').click();
        const attachment = await downloaded;
        assert.equal(await attachment.failure(), null);
        const content = await fs.readFile(await attachment.path());
        assert.equal(simulated.state.mailCalls, 1);
        assert.equal(simulated.state.smtp[0].host, brevo.SMTP_HOST);
        assert.equal(simulated.state.smtp[0].port, 587);
        assert.equal(simulated.state.smtp[0].requireTLS, true);
        assert.equal(simulated.state.smtp[0].tls.rejectUnauthorized, true);
        assert.equal(simulated.state.messages[0].message.from.address, brevo.SMTP_FROM);
        assert.equal(simulated.state.messages[0].message.to.address, sentInput.cliente.correo);
        assert.deepEqual(simulated.state.messages[0].message.envelope.to, [sentInput.cliente.correo]);
        assert.deepEqual(content, simulated.state.messages[0].message.attachments[0].content);
        const email = (await db.$queryRaw`SELECT estado, intentos, adjunto_sha256 FROM gaona_mensajeria.correos WHERE solicitud_id=${id}`)[0];
        assert.deepEqual(email, { estado: 'aceptado', intentos: 1, adjunto_sha256: sha(content) });
        assert.equal(await owner.solicitud.count({ where: { descripcion: sentInput.descripcion } }), 1);
        assert.equal(simulated.state.imports.includes('./clientes'), false);
        assert.equal(simulated.state.imports.includes('./empleado'), false);
        assert.deepEqual(smtp.errors, []);
        await smtp.page.close();
        console.log('PASS: Chromium → rutas públicas compartidas → PostgreSQL real → Brevo simulado con Stream Transport: destinatario del formulario, confirmación, un intento y PDF idéntico al documento descargado; cero envíos externos.');
    } finally {
        await browser?.close();
        await entry?.close(); await simulated?.close();
        if (frontend.listening) await new Promise(resolve => frontend.close(resolve));
        await db.$disconnect(); await owner.$disconnect();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
