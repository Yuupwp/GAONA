const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHarness, valid, apiRequire } = require('./pdf-harness.cjs');
const { chromium } = apiRequire('playwright');
const { app, state } = createHarness();
const express = apiRequire('express');
app.use(express.static(path.resolve(__dirname, '../Página')));
const server = http.createServer(app);
(async () => {
    let browser;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gaona-download-'));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        const page = await browser.newPage({ acceptDownloads: true });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.route('**/config.js', route => route.fulfill({ contentType: 'text/javascript', body: `const API_URL = ${JSON.stringify(base)};` }));
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        let escenarioPdf = 0;
        async function fill() {
            await page.goto(`${base}/cotizacion.html?producto=simulado-1`);
            await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
            await page.locator('[name="cantidad"]').fill('2');
            await page.locator('[name="medidas"]').fill(valid.productos[0].medidasAprox);
            await page.locator('[name="notas"]').fill(valid.productos[0].notas);
            await page.locator('#addItem').click();
            await page.locator('[name="producto"]').nth(1).selectOption('simulado-2');
            await page.locator('[name="cantidad"]').nth(1).fill('3');
            await page.locator('[name="medidas"]').nth(1).fill(valid.productos[1].medidasAprox);
            for (const field of ['nombre', 'apellido', 'telefono', 'correo']) await page.locator(`[name="${field}"]`).fill(valid.cliente[field]);
            await page.locator('[name="descripcion"]').fill(`PRUEBA PDF escenario ${++escenarioPdf}`);
            assert.match(await page.locator('#summarySubtotal').textContent(), /2,500.6/);
            assert.match(await page.locator('#summaryIva').textContent(), /400.1/);
            assert.match(await page.locator('#summaryTotal').textContent(), /2,900.7/);
        }
        await fill();
        await page.locator('[name="correo"]').fill('prueba@equipo');
        assert.equal(await page.locator('[name="correo"]').evaluate(input => input.checkValidity()), true);
        await page.locator('#submitQuote').click();
        await page.getByText(/Revisa correo electrónico/).waitFor();
        assert.equal(await page.locator('[name="correo"]').evaluate(input => input.classList.contains('invalid')), true);
        assert.equal(state.writes, 0);
        assert.equal(await page.locator('#quoteError').textContent().then(text => text.includes('ya no está disponible')), false);
        await page.route('**/solicitudes', route => route.fulfill({ status: 400, json: { error: 'Error desconocido simulado' } }));
        await page.locator('[name="correo"]').fill(valid.cliente.correo);
        await page.locator('#submitQuote').click();
        await page.getByText(/no pudimos confirmar si la solicitud quedó registrada/).waitFor();
        const attemptKey = await page.evaluate(() => registrationAttempt.key);
        const originalData = await page.evaluate(() => registrationAttempt.data);
        assert.equal(await page.locator('#quoteForm').isVisible(), true);
        assert.equal(state.writes, 0);
        await page.unroute('**/solicitudes');
        console.log('PASS: correo aceptado por HTML y rechazado por la validación del formulario señala el campo; 400 desconocido conserva datos y clave sin reenviar');
        await page.evaluate(() => {
            const form = document.getElementById('quoteForm');
            form.dispatchEvent(new Event('submit', { cancelable: true }));
            form.dispatchEvent(new Event('submit', { cancelable: true }));
        });
        await page.locator('#quoteSuccess:visible').waitFor();
        assert.equal(state.writes, 1);
        assert.equal(await page.evaluate(() => registrationAttempt.key), attemptKey);
        assert.equal(await page.evaluate(() => registrationAttempt.data), originalData);
        assert.deepEqual(JSON.parse(JSON.stringify(state.saved.detalles.create)), valid.productos);
        state.failPdf = true;
        await page.locator('#downloadPdf').click();
        await page.getByText(/Reintenta con este botón/).waitFor();
        assert.equal(await page.locator('#quoteForm').isHidden(), true);
        assert.equal(await page.locator('#downloadPdf').isEnabled(), true);
        assert.equal(state.writes, 1);
        state.failPdf = false;
        const downloaded = page.waitForEvent('download');
        await page.locator('#downloadPdf').click();
        const download = await downloaded;
        assert.equal(await download.failure(), null);
        assert.match(download.suggestedFilename(), /^GAONA-Solicitud-.*\.pdf$/);
        const target = path.join(temp, 'descarga.pdf');
        await download.saveAs(target);
        assert.equal((await fs.readFile(target)).subarray(0, 5).toString(), '%PDF-');
        assert.equal(state.writes, 1);
        console.log('PASS: Chromium descarga PDF real, importes correctos, doble envío bloqueado y reintento tras 503 sin duplicados');
        await fill();
        await page.locator('#submitQuote').click();
        await page.locator('#quoteSuccess:visible').waitFor();
        await page.route('**/solicitudes/pdf', route => route.fulfill({ status: 403, json: { error: 'Caducado simulado' } }));
        await page.locator('#downloadPdf').click();
        await page.getByText(/El acceso al PDF ha caducado o ya no está disponible/).waitFor();
        assert.equal(await page.locator('#downloadPdf').isHidden(), true);
        assert.equal(state.writes, 2);
        await page.unroute('**/solicitudes/pdf');
        state.failReceipt = true;
        await fill();
        await page.locator('#submitQuote').click();
        await page.locator('#quoteSuccess:visible').waitFor();
        await page.getByText(/PDF no está disponible/).waitFor();
        assert.equal(await page.locator('#downloadPdf').isHidden(), true);
        assert.equal(state.writes, 3);
        state.failReceipt = false;
        console.log('PASS: acceso caducado y comprobante no disponible conservan folio y estado registrado');
        for (const width of [1440, 768, 375, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await fill();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Formulario desborda a ${width}px`);
            if (process.env.GAONA_SCREENSHOT_DIR) {
                await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, `solicitud-${width}.png`), fullPage: true });
            }
            await page.locator('#submitQuote').click();
            await page.locator('#quoteSuccess:visible').waitFor();
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Éxito desborda a ${width}px`);
            assert.equal(await page.locator('#downloadPdf').isVisible(), true);
            assert.equal(await page.locator('#manualSharingOptions').getAttribute('open'), null);
            await page.locator('#manualSharingOptions summary').click();
            assert.equal(await page.locator('#quoteSharing').isVisible(), true);
            assert.equal(await page.locator('#mailStatus').isVisible(), true);
            const alignment = await page.locator('#quoteSuccess h2').evaluate(title => {
                const card = title.closest('#quoteSuccess').getBoundingClientRect();
                const heading = title.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(title);
                const text = range.getBoundingClientRect();
                const icon = title.closest('#quoteSuccess').querySelector('.quote-success-icon');
                return {
                    align: getComputedStyle(title).textAlign,
                    headingOffset: Math.abs(heading.x + heading.width / 2 - card.x - card.width / 2),
                    textOffset: Math.abs(text.x + text.width / 2 - card.x - card.width / 2),
                    iconColor: getComputedStyle(icon).backgroundColor
                };
            });
            assert.equal(alignment.align, 'center');
            assert.ok(alignment.headingOffset < 1, `Título descentrado a ${width}px`);
            assert.ok(alignment.textOffset < 1, `Texto descentrado a ${width}px`);
            assert.equal(alignment.iconColor, 'rgb(196, 119, 32)');
            if (process.env.GAONA_SCREENSHOT_DIR) {
                await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, `confirmacion-simulada-${width}.png`), fullPage: true });
            }
        }
        await page.route('**/productos', route => route.fulfill({ json: [{
            id: 'simulado-maximo', nombre: 'Producto simulado de importe máximo', precioDesde: '9999999999.99', categoria: { nombre: 'Pruebas' }
        }] }));
        await page.goto(`${base}/cotizacion.html?producto=simulado-maximo`);
        await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-maximo');
        await page.evaluate(() => {
            for (let i = 1; i < 30; i++) addItem('simulado-maximo');
            document.querySelectorAll('[name="cantidad"]').forEach(input => { input.value = '999'; });
            updateSummary();
        });
        const maximo = apiRequire('./src/solicitud-estimado').calcularEstimado(
            Array.from({ length: 30 }, () => ({ idProducto: 'maximo', cantidad: 999 })),
            [{ id: 'maximo', nombre: 'Simulado', precioDesde: new (apiRequire('@prisma/client').Prisma.Decimal)('9999999999.99') }]
        );
        const formato = value => {
            const [entero, decimal] = value.split('.');
            const fraccion = decimal.replace(/0+$/, '');
            return `$${BigInt(entero).toLocaleString('es-MX')}${fraccion ? '.' + fraccion : ''} MXN`;
        };
        assert.equal(await page.locator('#summarySubtotal').textContent(), formato(maximo.subtotal));
        assert.equal(await page.locator('#summaryIva').textContent(), formato(maximo.iva));
        assert.equal(await page.locator('#summaryTotal').textContent(), formato(maximo.total));
        assert.deepEqual(errors, []);
        console.log('PASS: formulario y descarga responsive 1440/768/375/320 px; cero excepciones JavaScript');
        console.log('PASS: resumen exacto con 30 productos, cantidad 999 y precio máximo del esquema');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(temp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
