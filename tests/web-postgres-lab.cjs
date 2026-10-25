const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { apiRequire, validarLocal, env } = require('./persistencia-fixture.cjs');
const root = path.resolve(__dirname, '..');

function conexiones() {
    const web = validarLocal(process.env.WEB_DATABASE_URL);
    assert.equal(new URL(web).username, 'gaona_web_pruebas');
    assert.equal(web, process.env.GAONA_PERSIST_TEST_DATABASE_URL);
    return { web, admin: validarLocal(process.env.GAONA_PERSIST_TEST_ADMIN_URL) };
}

async function puertoLibre() {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function iniciarEntrada(config = {}, inyectadas = {}) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gaona-web-entry-'));
    await fs.chmod(directory, 0o700);
    let child, closed = false, output = '';
    const close = async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill('SIGTERM');
            await exited;
        }
        if (!closed) { await fs.rm(directory, { recursive: true, force: true }); closed = true; }
    };
    try {
        const port = config.WEB_PORT ?? await puertoLibre();
        const variables = { ...env, MAIL_ENABLED: 'false', WHATSAPP_ENABLED: 'false', GAONA_WEB10_LOCAL: 'POSTGRES_AISLADO', WEB_HOST: '127.0.0.1', WEB_PORT: String(port), WEB_DATABASE_URL: conexiones().web, ...config };
        inyectadas = { ...inyectadas };
        const efectiva = { ...variables, ...inyectadas };
        if (efectiva.NODE_ENV === 'production' && process.env.GAONA_WEB10_TEST_CA) {
            const url = new URL(efectiva.WEB_DATABASE_URL);
            if (url.hostname === '127.0.0.1' && url.pathname === '/gaona_web3_aislada' && url.username === 'gaona_web_publico_pruebas') {
                url.searchParams.set('sslmode', 'require'); url.searchParams.set('sslaccept', 'strict');
                url.searchParams.set('sslcert', process.env.GAONA_WEB10_TEST_CA);
                const destino = inyectadas.WEB_DATABASE_URL ? inyectadas : variables;
                destino.WEB_DATABASE_URL = url.toString(); destino.WEB_DATABASE_ROLE = url.username;
            }
        }
        await fs.cp(path.join(root, 'api/src'), path.join(directory, 'src'), { recursive: true });
        await fs.copyFile(path.join(root, 'api/package.json'), path.join(directory, 'package.json'));
        await fs.cp(path.join(root, 'api/scripts'), path.join(directory, 'scripts'), { recursive: true });
        await fs.cp(path.join(root, 'api/propuestas'), path.join(directory, 'propuestas'), { recursive: true });
        await fs.symlink(path.join(root, 'api/node_modules'), path.join(directory, 'node_modules'), 'dir');
        await fs.writeFile(path.join(directory, '.env'), Object.entries(variables).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
        const trace = path.join(directory, 'imports.jsonl');
        const observer = path.join(directory, 'observar.cjs');
        await fs.writeFile(observer, `const Module = require('node:module');
const fs = require('node:fs');
const original = Module._load;
Module._load = function(name, ...args) {
  if (${JSON.stringify(['clientes.ts', 'empleado.ts', 'index.ts', 'lib/prisma.ts'].map(file => path.join(directory, 'src', file)))}.includes(Module._resolveFilename(name, args[0], args[1]))) fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(name) + '\\n');
  return original.call(this, name, ...args);
};
`, { mode: 0o600 });
        child = spawn(process.execPath, ['--require', observer, '--require', apiRequire.resolve('tsx/cjs'), path.join(directory, 'src/web.ts')], {
            cwd: directory, env: { PATH: process.env.PATH, ...inyectadas }, stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.on('data', data => { output += data; });
        child.stderr.on('data', data => { output += data; });
        let failed;
        child.on('error', error => { failed = error; });
        const base = `http://127.0.0.1:${port}`;
        for (let attempt = 0; attempt < 200; attempt++) {
            if (failed || child.exitCode !== null || child.signalCode !== null) throw Error(`Entrada web rechazada: ${failed?.message ?? output}`);
            if (output.includes('API web en ')) {
                const response = await fetch(base + '/salud', { signal: AbortSignal.timeout(2000) });
                assert.equal(response.status, 200);
                return { base, port, close, imports: async () => fs.readFile(trace, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error)) };
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error('La entrada web no confirmó su arranque local');
    } catch (error) { await close(); throw error; }
}

async function iniciarSimulada(db, options = {}) {
    const { createHarness } = require('./pdf-harness.cjs');
    const harness = createHarness({ entry: 'api-web.ts', prisma: db, env, apiEnv: env, timeout: 10000, ...options });
    const server = http.createServer(harness.app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { ...harness, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

async function sembrar(owner) {
    const id = randomUUID();
    await owner.categoria.create({ data: { id, nombre: 'PRUEBA AISLADA DE COTIZACIÓN ' + id } });
    const products = [];
    for (const [suffix, price, activo, tipo] of [['a', '1250.15', true, 'PRODUCTO'], ['b', '0.10', true, 'PRODUCTO'], ['inactivo', '9.00', false, 'PRODUCTO'], ['material', '9.00', true, 'MATERIAL']]) {
        products.push(await owner.producto.create({ data: { id: id + '-' + suffix, idCategoria: id, nombre: `PRUEBA AISLADA DE COTIZACIÓN ${id} ${suffix}`, precioDesde: price, activo, tipo } }));
    }
    return products;
}

function datos(products) {
    const id = randomUUID();
    return { cliente: { nombre: 'Prueba', apellido: 'WEB local', telefono: '0000000000', correo: `web-${id}@example.test` },
        whatsappConsentimiento: false, descripcion: 'PRUEBA AISLADA DE COTIZACIÓN ' + id,
        productos: [{ idProducto: products[0].id, cantidad: 2, medidasAprox: '90 x 210 cm' }, { idProducto: products[1].id, cantidad: 3 }] };
}

const post = (base, route, body, key = 'web-local-' + randomUUID(), headers = {}) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, ...headers }, body: JSON.stringify(body)
});
const sha = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');

module.exports = { apiRequire, env, conexiones, iniciarEntrada, iniciarSimulada, sembrar, datos, post, sha, root };
