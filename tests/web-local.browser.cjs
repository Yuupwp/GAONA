const assert = require('node:assert/strict');
const { apiRequire } = require('./pdf-harness.cjs');
const { chromium } = apiRequire('playwright');
(async () => {
    const api = 'http://127.0.0.1:3000', front = 'http://127.0.0.1:5500';
    assert.equal((await fetch(api + '/salud')).status, 200);
    const products = await (await fetch(api + '/productos')).json();
    assert.deepEqual(products, []);
    const browser = await chromium.launch({ headless: true,
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    try {
        const page = await browser.newPage();
        const errors = [], posts = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
        await page.route('**/*', r => ['127.0.0.1', 'localhost'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort());
        await page.goto(front + '/Catalogo.html');
        await page.getByText('Por el momento no hay productos disponibles.').waitFor();
        assert.equal(await page.locator('.product-card').count(), 0);
        await page.goto(front + '/cotizacion.html');
        await page.getByText('Por el momento no hay productos disponibles para cotizar.').waitFor();
        assert.equal(await page.locator('#submitQuote').isDisabled(), true);
        assert.equal(await page.locator('[name="producto"] option:not([value=""])').count(), 0);
        assert.equal(await page.locator('#whatsappConsentimiento, #whatsappHint, #whatsappStatus, #refreshWhatsapp').count(), 0);
        assert.deepEqual(errors, []);
        assert.deepEqual(posts, []);
        console.log('PASS: catálogo y formulario vacíos sin datos ficticios, sin controles WhatsApp automáticos y sin escrituras.');
    } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
