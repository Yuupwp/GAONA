const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { apiRequire } = require('./escritorio-harness.cjs');
const { transformSync } = apiRequire('esbuild');
const root = path.resolve(__dirname, '..');
function sesion() {
    const peticiones = [];
    const document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, dispatchEvent() {} };
    const context = { window: {}, document, URL, Headers, Request, Response, Date, CustomEvent: class {}, fetch: async (url, init) => {
        peticiones.push({ url, init });
        if (String(url).endsWith('/auth/login')) return Response.json({ token: 'jwt-simulado', usuario: { id: 'empleado', nombre: 'Prueba', apellido: 'Aislada', rol: { nombre: 'EMPLEADO' }, permisos: ['cuenta'] } });
        return Response.json(context.cuerpo ?? {}, { status: context.status ?? 200 });
    } };
    vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'Appescritorio/src/renderer/sesion.ts'), 'utf8'), { loader: 'ts' }).code, context);
    return { ...context, context, peticiones };
}
test('Electron centraliza Bearer, conserva encabezados JSON y no filtra token a otro origen ni redirecciones', async () => {
    const { window, peticiones } = sesion();
    await window.gaonaSesion.iniciar('empleado', 'clave-ficticia');
    assert.equal(peticiones[0].init.headers.has('Authorization'), false);
    await window.gaonaApiFetch('http://127.0.0.1:3001/productos', { headers: { 'Content-Type': 'application/json', Authorization: 'identidad-falsa' } });
    assert.equal(peticiones.at(-1).init.headers.get('Authorization'), 'Bearer jwt-simulado');
    assert.equal(peticiones.at(-1).init.headers.get('Content-Type'), 'application/json');
    assert.equal(peticiones.at(-1).init.redirect, 'error');
    const antes = peticiones.length;
    await assert.rejects(window.gaonaApiFetch('https://example.invalid/productos'), /Destino/);
    await assert.rejects(window.gaonaApiFetch('http://127.0.0.1:3000/productos'), /Destino/);
    assert.equal(peticiones.length, antes);
    window.gaonaSesion.cerrar();
    await window.gaonaApiFetch('http://127.0.0.1:3001/productos');
    assert.equal(peticiones.at(-1).init.headers.has('Authorization'), false);
});
test('Electron cierra la sesión si el backend rechaza el token', async () => {
    const { window, context } = sesion();
    await window.gaonaSesion.iniciar('empleado', 'clave-ficticia');
    context.status = 401;
    context.cuerpo = { codigo: "SESION_INVALIDA" };
    await window.gaonaApiFetch('http://127.0.0.1:3001/productos');
    assert.equal(window.gaonaSesion.token(), null);
    assert.equal(window.gaonaSesion.actual(), null);
});
test('todos los módulos usan la función central, PDF descargado antes de IPC sin token en URL', () => {
    const dir = path.join(root, 'Appescritorio/src/renderer');
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'sesion.ts')) {
        assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /\bfetch\(/, file);
    }
    const source = fs.readFileSync(path.join(dir, 'cotizaciones.ts'), 'utf8');
    assert.match(source, /gaonaApiFetch\(`\$\{API_URL\}\/cotizaciones\/\$\{encodeURIComponent\(id\)\}\/pdf`\)/);
    assert.match(source, /electronAPI\.abrirPdf\(await respuesta\.arrayBuffer\(\)\)/);
    assert.doesNotMatch(source, /window\.open\([^\n]*\/pdf|[?&](?:token|access_token)=/);
});
test('visor PDF valida bytes, crea copia privada y elimina los temporales al cerrar', async () => {
    const { crearVisorPdf } = apiRequire('../Appescritorio/src/visor-pdf.ts');
    let archivo;
    const visor = crearVisorPdf(async ruta => { archivo = ruta; return ''; });
    await assert.rejects(visor.abrir('ruta-arbitraria.pdf'), /inválido/);
    await assert.rejects(visor.abrir(new ArrayBuffer(20 * 1024 * 1024 + 1)), /grande/);
    await assert.rejects(visor.abrir(new TextEncoder().encode('otro-contenido').buffer), /inválido/);
    const bytes = new TextEncoder().encode('%PDF-1.4\nPrueba aislada');
    try {
        await visor.abrir(bytes.buffer);
        assert.deepEqual(fs.readFileSync(archivo), Buffer.from(bytes));
        assert.equal(fs.statSync(archivo).mode & 0o777, 0o600);
        assert.match(path.basename(path.dirname(archivo)), /^gaona-pdf-/);
    } finally { visor.limpiar(); }
    assert.equal(fs.existsSync(archivo), false);
    const rechazado = crearVisorPdf(async ruta => { archivo = ruta; return 'Error de visor simulado'; });
    await assert.rejects(rechazado.abrir(bytes.buffer), /No se pudo abrir/);
    assert.equal(fs.existsSync(archivo), false);
});

test('entrada de escritorio escucha en 127.0.0.1:3001 por defecto y valida PORT', () => {
    const source = transformSync(fs.readFileSync(path.join(root, 'api/src/index.ts'), 'utf8'), { loader: 'ts', format: 'cjs' }).code;
    function arrancar(env) {
        let args;
        vm.runInNewContext(source, { process: { env }, console: { log() {} }, require(name) {
            if (name === 'dotenv/config') return {};
            if (name === './escritorio') return { app: { listen(...valores) { args = valores; } } };
            throw new Error('Import inesperado');
        } });
        return args;
    }
    const args = arrancar({});
    assert.equal(args[0], 3001);
    assert.equal(args[1], '127.0.0.1');
    assert.equal(arrancar({ PORT: '3456' })[0], 3456);
    for (const PORT of ['0', '-1', '65536', 'texto', '3001.5']) assert.throws(() => arrancar({ PORT }), /PORT inválido/);
});

test('un 401 por contraseña actual incorrecta conserva la sesión autenticada', async () => {
    const { window, context } = sesion();
    await window.gaonaSesion.iniciar('empleado', 'clave-ficticia');
    context.status = 401;
    context.cuerpo = { error: 'La contraseña actual es incorrecta.' };
    await window.gaonaApiFetch('http://127.0.0.1:3001/cuenta/empleado/contrasena');
    assert.equal(window.gaonaSesion.token(), 'jwt-simulado');
});
