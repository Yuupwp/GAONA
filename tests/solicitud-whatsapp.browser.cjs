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
        async function scenario(mode, run, width = 375) {
            const { app, state } = createHarness({ env: smtp });
            app.use(apiRequire('express').static(path.resolve(__dirname, '../Página')));
            const server = http.createServer(app);
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            const page = await browser.newPage({ viewport: { width, height: 1000 }, acceptDownloads: true });
            const base = `http://127.0.0.1:${server.address().port}`;
            const errors = [], external = [];
            let pdfCalls = 0, registrations = 0;
            page.on('pageerror', e => errors.push(e.message));
            page.on('request', req => {
                const url = req.url();
                if (url.startsWith(base + '/solicitudes/pdf')) pdfCalls++;
                if (url === base + '/solicitudes') registrations++;
                if (!url.startsWith(base) && !url.startsWith('https://fonts.googleapis.com/') && !url.startsWith('https://fonts.gstatic.com/')) external.push(url);
            });
            try {
                await page.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body: `const API_URL = ${JSON.stringify(base)};` }));
                await page.route('https://fonts.googleapis.com/**', r => r.abort());
                await page.addInitScript(mode => {
                    window.shareCalls = [];
                    window.canShareCalls = [];
                    window.openCalls = [];
                    window.shareMode = 'ok';
                    window.open = (...args) => { window.openCalls.push(args); return null; };
                    if (mode === 'insecure') {
                        Object.defineProperty(window, 'isSecureContext', { value: false });
                        Object.defineProperty(crypto, 'randomUUID', { value: undefined });
                    }
                    Object.defineProperty(navigator, 'canShare', { configurable: true, value: mode === 'absent' ? undefined : payload => {
                        window.canShareCalls.push({ files: payload.files?.map(f => ({ name: f.name, type: f.type })) });
                        if (mode === 'throws') throw new DOMException('Política simulada', 'SecurityError');
                        return mode !== 'unsupported';
                    } });
                    Object.defineProperty(navigator, 'share', { configurable: true, value: mode === 'absent' ? undefined : async payload => {
                        const call = { text: payload.text, title: payload.title, url: payload.url,
                            active: navigator.userActivation.isActive,
                            files: payload.files?.map(f => ({ name: f.name, type: f.type, size: f.size })) };
                        window.shareCalls.push(call);
                        if (!call.active) throw new DOMException('Sin activación', 'NotAllowedError');
                        call.bytes = Array.from(new Uint8Array(await payload.files[0].arrayBuffer()));
                        if (window.shareMode === 'cancel') throw new DOMException('Cancelado simulado', 'AbortError');
                        if (window.shareMode === 'denied') throw new DOMException('Permiso simulado', 'NotAllowedError');
                        if (window.shareMode === 'pending') await new Promise(resolve => { window.finishShare = resolve; });
                    } });
                }, mode);
                await page.goto(`${base}/cotizacion.html?producto=simulado-1`);
                await page.waitForFunction(() => document.querySelector('[name="producto"]')?.value === 'simulado-1');
                for (const field of ['nombre', 'apellido', 'telefono', 'correo']) await page.locator(`[name="${field}"]`).fill(valid.cliente[field]);
                await page.locator('[name="medidas"]').fill('90 x 210 cm');
                await page.locator('#submitQuote').click();
                await page.locator('#quoteSuccess:visible').waitFor();
                await page.locator('#manualSharingOptions summary').click();
                assert.equal(state.writes, 1);
                assert.equal(state.mailCalls, 1);
                assert.equal(pdfCalls, 0, 'Sin recuperación automática ni envío a terceros');
                await run({ page, state, pdfCalls: () => pdfCalls });
                assert.equal(state.writes, 1);
                assert.equal(state.mailCalls, 1);
                assert.equal(registrations, 1);
                assert.deepEqual(external, []);
                assert.deepEqual(errors, []);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Desbordamiento a ${width}px`);
                if (process.env.GAONA_SCREENSHOT_DIR) {
                    await fs.mkdir(process.env.GAONA_SCREENSHOT_DIR, { recursive: true });
                    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
                    await page.screenshot({ path: path.join(process.env.GAONA_SCREENSHOT_DIR, `whatsapp-${mode}-${width}.png`), fullPage: true });
                }
            } finally {
                await page.close();
                await new Promise(resolve => server.close(resolve));
            }
        }
        await scenario('native', async ({ page, state, pdfCalls }) => {
            let release;
            const held = new Promise(resolve => { release = resolve; });
            await page.route('**/solicitudes/pdf', async route => { await held; await route.continue(); });
            await page.locator('#sharePdf').click();
            await page.waitForFunction(() => !navigator.userActivation.isActive);
            assert.equal(await page.evaluate(() => window.shareCalls.length), 0);
            assert.equal(await page.locator('#sharePdf').isDisabled(), true);
            release();
            await page.getByRole('button', { name: 'Compartir PDF ahora', exact: true }).waitFor();
            await page.locator('#sharePdf').click();
            await page.getByText(/Se abrió la interfaz de compartir/).waitFor();
            const call = await page.evaluate(() => window.shareCalls[0]);
            assert.equal(call.active, true);
            assert.equal(call.files.length, 1);
            assert.equal(call.files[0].name, 'GAONA-Solicitud-11111111-2222-4333-8444-555555555555.pdf');
            assert.equal(call.files[0].type, 'application/pdf');
            const bytes = Buffer.from(call.bytes);
            assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
            assert.deepEqual(bytes, state.messages[0].message.attachments[0].content);
            assert.match(call.text, /GAONA.*11111111-2222-4333-8444-555555555555/);
            assert.equal(call.url, undefined);
            assert.equal(call.text, 'GAONA | Solicitud de cotización. Folio: 11111111-2222-4333-8444-555555555555. Comparto el PDF con el resumen y los importes estimados.');
            for (const pii of ['prueba@example.test', 'Cliente Simulado', 'token', 'http']) assert.ok(!call.text.includes(pii), pii);
            const downloadPromise = page.waitForEvent('download');
            await page.locator('#downloadPdf').click();
            const download = await downloadPromise;
            assert.equal(download.suggestedFilename(), call.files[0].name);
            assert.deepEqual(await fs.readFile(await download.path()), bytes);
            assert.equal(pdfCalls(), 1);
        });
        console.log('PASS: PDF real idéntico al adjunto SMTP y descarga, activación en segundo clic tras espera, nombre, folio y privacidad');
        await scenario('native', async ({ page, pdfCalls }) => {
            const downloading = page.waitForEvent('download');
            await page.locator('#downloadPdf').click();
            assert.equal(await (await downloading).failure(), null);
            await page.locator('#sharePdf').click();
            await page.getByText(/Se abrió la interfaz de compartir/).waitFor();
            assert.equal(await page.evaluate(() => window.shareCalls[0].active), true);
            assert.equal(pdfCalls(), 1);
        });
        await scenario('native', async ({ page, pdfCalls }) => {
            let release;
            const held = new Promise(resolve => { release = resolve; });
            await page.route('**/solicitudes/pdf', async route => { await held; await route.continue(); });
            await page.locator('#sharePdf').click();
            const downloading = page.waitForEvent('download');
            await page.locator('#downloadPdf').click();
            release();
            await page.getByRole('button', { name: 'Compartir PDF ahora', exact: true }).waitFor();
            assert.equal(await (await downloading).failure(), null);
            assert.equal(pdfCalls(), 1);
            assert.equal(await page.evaluate(() => window.shareCalls.length), 0);
        });
        console.log('PASS: archivo descargado reutilizado con activación nueva y preparación/descarga concurrentes comparten una recuperación');

        for (const mode of ['absent', 'unsupported', 'throws', 'insecure']) await scenario(mode, async ({ page }) => {
            if (mode === 'unsupported' || mode === 'throws') {
                await page.locator('#sharePdf').click();
                await page.locator('#whatsappFallback:visible').waitFor();
            }
            assert.equal(await page.locator('#sharePdf').isHidden(), true);
            assert.equal(await page.evaluate(() => window.openCalls.length), 0);
            await page.locator('#openWhatsapp').click();
            const [url, target, features] = await page.evaluate(() => window.openCalls[0]);
            const link = new URL(url);
            assert.equal(link.origin, 'https://wa.me');
            assert.equal(link.pathname, '/');
            assert.deepEqual([...link.searchParams.keys()], ['text']);
            assert.match(link.searchParams.get('text'), /GAONA.*11111111-2222-4333-8444-555555555555/);
            assert.ok(!url.includes(valid.cliente.correo));
            assert.equal(link.searchParams.get('text'), 'GAONA | Solicitud de cotización. Folio: 11111111-2222-4333-8444-555555555555. Compartiré el PDF con el resumen y los importes estimados.');
            assert.equal(target, '_blank');
            assert.equal(features, 'noopener,noreferrer');
            assert.match(await page.locator('#shareStatus').textContent(), /adjunta el PDF descargado manualmente.*No se ha confirmado ningún envío/);
            assert.equal(await page.evaluate(() => window.shareCalls.length), 0);
            const downloading = page.waitForEvent('download');
            await page.locator('#downloadPdf').click();
            const downloaded = await downloading;
            assert.equal(await downloaded.failure(), null);
        });
        console.log('PASS: APIs ausentes, PDF no compatible, excepción de canShare y contexto inseguro; enlace oficial sin teléfono ni token y adjunto manual');

        await scenario('native', async ({ page, pdfCalls }) => {
            await page.locator('#sharePdf').click();
            await page.getByRole('button', { name: 'Compartir PDF ahora', exact: true }).waitFor();
            await page.evaluate(() => { window.shareMode = 'cancel'; });
            await page.locator('#sharePdf').click();
            await page.getByText(/Se canceló la acción de compartir/).waitFor();
            assert.equal(await page.locator('#sharePdf').isEnabled(), true);
            await page.evaluate(() => { window.shareMode = 'denied'; });
            await page.locator('#sharePdf').click();
            await page.getByText(/El navegador no permitió compartir/).waitFor();
            assert.equal(await page.locator('#whatsappFallback').isVisible(), true);
            await page.evaluate(() => { window.shareMode = 'pending'; });
            await page.locator('#sharePdf').click();
            assert.equal(await page.locator('#sharePdf').isDisabled(), true);
            await page.evaluate(() => document.getElementById('sharePdf').dispatchEvent(new Event('click')));
            assert.equal(await page.evaluate(() => window.shareCalls.length), 3);
            await page.waitForFunction(() => typeof window.finishShare === 'function');
            await page.evaluate(() => window.finishShare());
            await page.getByText(/Se abrió la interfaz de compartir/).waitFor();
            assert.equal(pdfCalls(), 1);
        });
        console.log('PASS: cancelación, denegación y doble clic durante selector abierto sin reintentos externos');

        for (const failure of ['network', 'server', 'invalid', 'expired']) await scenario('native', async ({ page }) => {
            await page.route('**/solicitudes/pdf', route => {
                if (failure === 'network') return route.abort();
                if (failure === 'server') return route.fulfill({ status: 503, json: { error: 'Simulado' } });
                if (failure === 'expired') return route.fulfill({ status: 403, json: { error: 'Simulado' } });
                return route.fulfill({ contentType: 'application/pdf', body: 'archivo-invalido-simulado' });
            });
            await page.locator('#sharePdf').click();
            if (failure === 'expired') {
                await page.getByText(/El acceso al PDF ha caducado o ya no está disponible/).waitFor();
                assert.equal(await page.locator('#sharePdf').isHidden(), true);
                assert.equal(await page.locator('#downloadPdf').isHidden(), true);
            } else {
                await page.getByText(/No pudimos preparar el PDF/).waitFor();
                assert.equal(await page.locator('#sharePdf').isEnabled(), true);
                await page.unroute('**/solicitudes/pdf');
                await page.locator('#sharePdf').click();
                await page.getByRole('button', { name: 'Compartir PDF ahora', exact: true }).waitFor();
            }
            assert.equal(await page.evaluate(() => window.shareCalls.length), 0);
        });
        await scenario('native', async ({ page, pdfCalls }) => {
            await page.locator('#sharePdf').click();
            await page.getByRole('button', { name: 'Compartir PDF ahora', exact: true }).waitFor();
            await page.evaluate(() => {
                const actual = Date.now;
                Date.now = () => actual() + 31 * 60 * 1000;
            });
            await page.locator('#sharePdf').click();
            await page.getByText(/El acceso al PDF ha caducado o ya no está disponible/).waitFor();
            assert.equal(await page.evaluate(() => window.shareCalls.length), 0);
            assert.equal(pdfCalls(), 1);
        });
        console.log('PASS: errores de red, 503, firma PDF inválida y expiración local o 403, incluso con archivo preparado');
        for (const width of [1440, 768, 375, 320]) {
            for (const mode of ['native', 'absent']) await scenario(mode, async ({ page }) => {
                assert.equal(await page.locator('#downloadPdf').isVisible(), true);
                assert.equal(await page.locator('#mailStatus').isVisible(), true);
                assert.equal(await page.locator('#quoteFolio').isVisible(), true);
                assert.equal(await page.locator(mode === 'native' ? '#sharePdf' : '#openWhatsapp').isVisible(), true);
            }, width);
        }
        console.log('PASS: compartir y alternativa responsive 1440/768/375/320 px; sin escrituras, correos repetidos, tráfico externo ni excepciones JS');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
