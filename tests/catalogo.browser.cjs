const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.join(__dirname, '../api/package.json'))('playwright');
const root = path.resolve(__dirname, '../Página');
const fixture = [
    { id: 'prueba-1', nombre: 'Silicón blanco', descripcion: null, precioDesde: '25.50', imagenUrl: 'img/chapa.jpg', categoria: { nombre: 'Accesorios nuevos' } },
    { id: 'prueba-2', nombre: 'Silicón especial', descripcion: 'Uso exterior', precioDesde: '100', imagenUrl: 'img/no-existe.jpg', categoria: { nombre: 'Accesorios nuevos' } },
    { id: 'prueba-3', nombre: '<img src=x onerror=alert(1)>', descripcion: '', precioDesde: '5000', imagenUrl: null, categoria: { nombre: 'Puertas' } }
];
const server = http.createServer(async (req, res) => {
    try {
        const target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
        if (!target.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        const body = await fs.readFile(target);
        const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg' }[path.extname(target)];
        res.writeHead(200, { 'Content-Type': type || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end(); }
});
(async () => {
    let browser;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        browser = await chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://fonts.googleapis.com/**', route => route.abort());
        let mode = 'ok', calls = 0, hold;
        await page.route('http://localhost:3000/productos', async route => {
            calls++;
            if (mode === 'network') return route.abort();
            if (mode === 'hold') await new Promise(resolve => { hold = resolve; });
            if (mode === 'http') return route.fulfill({ status: 500, json: { error: 'Error' } });
            if (mode === 'invalid') return route.fulfill({ json: { error: 'No es una lista' } });
            if (mode === 'json') return route.fulfill({ contentType: 'application/json', body: '{' });
            return route.fulfill({ json: mode === 'empty' ? [] : fixture });
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.goto(`${base}/Catalogo.html`);
        await page.waitForSelector('.product-card');
        assert.equal(await page.locator('.product-card').count(), 3);
        assert.equal(await page.locator('.product-card h2').last().textContent(), fixture[2].nombre);
        assert.equal(await page.locator('.product-info h2 img').count(), 0);
        assert.match(await page.locator('.product-bottom strong').first().textContent(), /25.5/);
        await page.waitForFunction(() => document.querySelectorAll('.product-image img').length === 1);
        assert.match(await page.locator('.product-info p').first().textContent(), /Descripción no disponible/);
        await page.locator('#searchInput').fill('SILICON');
        await page.locator('input[value="Accesorios nuevos"]').check();
        await page.locator('#sortProducts').selectOption('high');
        assert.equal(await page.locator('.product-card').count(), 2);
        assert.equal(await page.locator('.product-card h2').first().textContent(), 'Silicón especial');
        assert.equal(calls, 1, 'Los filtros deben operar sin repetir la consulta');
        await page.locator('#searchInput').fill('sin coincidencias');
        assert.match(await page.locator('#productsGrid').textContent(), /No encontramos/);
        await page.locator('#searchInput').fill('');
        await page.locator('.quote-button').first().click();
        await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'prueba-2');
        assert.match(page.url(), /cotizacion.html\?producto=prueba-2/);
        console.log('PASS: datos, imágenes, texto seguro, filtros combinados y navegación/preselección');

        await page.goto(`${base}/cotizacion.html?producto=inexistente`);
        await page.waitForSelector('#quoteError:visible');
        assert.match(await page.locator('#quoteError').textContent(), /no existe o ya no está disponible/);
        assert.equal(await page.locator('[name="producto"]').inputValue(), '');
        await page.locator('[name="producto"]').selectOption('prueba-1');
        await page.locator('[name="nombre"]').fill('Prueba');
        await page.locator('[name="apellido"]').fill('Catálogo');
        await page.locator('[name="telefono"]').fill('5555555555');
        await page.route('http://localhost:3000/solicitudes', route => route.fulfill({ status: 400, json: { error: 'Algún producto ya no está disponible' } }));
        await page.locator('#submitQuote').click();
        await page.waitForFunction(() => document.getElementById('quoteError').textContent.includes('Algún producto seleccionado ya no está disponible'));
        assert.equal(await page.locator('#submitQuote').isEnabled(), true);
        await page.unroute('http://localhost:3000/solicitudes');
        let submitted;
        await page.route('http://localhost:3000/solicitudes', route => {
            submitted = route.request().postDataJSON();
            return route.fulfill({ status: 201, json: { id: 'solicitud-prueba' } });
        });
        await page.locator('#submitQuote').click();
        await page.waitForSelector('#quoteSuccess:visible');
        assert.equal(submitted.productos[0].idProducto, 'prueba-1');
        assert.equal(submitted.productos[0].cantidad, 1);
        assert.equal(await page.locator('#quoteFolio').textContent(), 'Folio: solicitud-prueba');
        console.log('PASS: identificador inexistente, producto retirado y envío simulado con ID correcto');

        for (const failure of ['network', 'http', 'invalid', 'json']) {
            mode = failure;
            await page.goto(`${base}/Catalogo.html`);
            await page.getByRole('button', { name: 'Reintentar' }).waitFor();
            await page.locator('#searchInput').fill('Silicón');
            assert.match(await page.locator('#productsGrid').textContent(), /No pudimos cargar/);
            mode = 'ok';
            await page.getByRole('button', { name: 'Reintentar' }).click();
            await page.waitForSelector('.product-card');
            assert.equal(await page.locator('.product-card').count(), 2);
        }
        mode = 'hold';
        await page.goto(`${base}/Catalogo.html`);
        await page.waitForFunction(() => document.getElementById('productsGrid').getAttribute('aria-busy') === 'true');
        await page.locator('#searchInput').fill('Silicón');
        assert.match(await page.locator('#productsGrid').textContent(), /Cargando/);
        mode = 'ok'; hold();
        await page.waitForSelector('.product-card');
        console.log('PASS: carga, HTTP 500, red, respuesta inválida, JSON inválido y reintento');

        mode = 'empty';
        await page.goto(`${base}/Catalogo.html`);
        await page.getByText('Por el momento no hay productos disponibles.', { exact: true }).waitFor();
        assert.equal(await page.locator('#productCount').textContent(), '0 productos');
        await page.goto(`${base}/cotizacion.html`);
        await page.getByText('Por el momento no hay productos disponibles para cotizar.').waitFor();
        assert.equal(await page.locator('#submitQuote').isDisabled(), true);
        assert.equal(await page.locator('#addItem').isDisabled(), true);
        mode = 'network';
        await page.goto(`${base}/cotizacion.html`);
        await page.getByRole('button', { name: 'Reintentar' }).waitFor();
        mode = 'ok';
        await page.getByRole('button', { name: 'Reintentar' }).click();
        await page.waitForSelector('[name="producto"]');
        assert.equal(await page.locator('#submitQuote').isEnabled(), true);
        console.log('PASS: catálogo vacío y bloqueo/recuperación del formulario');

        await page.goto(`${base}/Inicio.html`);
        await page.locator('.category-card').first().click();
        await page.waitForSelector('.product-card');
        assert.equal(await page.locator('input[value="Puertas"]').isChecked(), true);
        assert.equal(await page.locator('.product-card').count(), 1);
        console.log('PASS: navegación Inicio → categoría real');

        for (const width of [1440, 768, 375, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${base}/Catalogo.html`);
            await page.waitForSelector('.product-card');
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Desbordamiento a ${width}px`);
            assert.equal(await page.locator('.quote-button').first().isVisible(), true);
            const columns = await page.locator('#productsGrid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
            assert.equal(columns, width > 950 ? 3 : width > 700 ? 2 : 1);
            if (process.env.GAONA_SCREENSHOT_DIR) {
                await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, `catalogo-${width}.png`), fullPage: true });
            }
        }
        assert.deepEqual(errors, []);
        console.log('PASS: responsive 1440/768/375/320px; sin excepciones JavaScript');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
