const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = readFileSync(path.join(__dirname, '../Página/productos.js'), 'utf8');
function library(overrides = {}) {
    const context = vm.createContext({
        URL, AbortController, setTimeout, clearTimeout,
        document: { baseURI: 'http://localhost:8080/Catalogo.html' },
        API_URL: 'http://localhost:3000/', ...overrides
    });
    vm.runInContext(source, context);
    return vm.runInContext('CatalogProducts', context);
}
const product = (extra = {}) => ({ id: 'prueba-1', nombre: 'Silicón', descripcion: null,
    precioDesde: '25.50', imagenUrl: null, categoria: { nombre: 'Accesorios' }, ...extra });

test('interpreta Decimal como número, campos opcionales e imagen relativa', () => {
    const [value] = library().parse([product({ imagenUrl: 'img/puerta.jpg' })]);
    assert.equal(value.price, 25.5);
    assert.equal(value.description, 'Descripción no disponible.');
    assert.equal(value.image, 'http://localhost:8080/img/puerta.jpg');
    assert.equal(library().parse([product({ imagenUrl: 'javascript:alert(1)' })])[0].image, '');
    assert.equal(library().parse([product({ imagenUrl: 'https://example.com/p.jpg' })])[0].image,
        'https://example.com/p.jpg');
});

test('rechaza respuestas inválidas, duplicados y precios que producirían NaN o cero ficticio', () => {
    for (const data of [null, {}, [null], [product({ id: '' })], [product({ nombre: null })],
        [product({ precioDesde: null })], [product({ precioDesde: '' })],
        [product({ precioDesde: 'abc' })], [product({ precioDesde: -1 })],
        [product({ categoria: null })], [product({ descripcion: {} })], [product(), product()]]) {
        assert.throws(() => library().parse(data));
    }
    assert.equal(library().parse([]).length, 0);
    assert.equal(library().parse([product({ precioDesde: 0 })])[0].price, 0);
});

test('combina búsqueda sin acentos, categoría real y orden numérico sin mutar productos', () => {
    const lib = library();
    const products = lib.parse([
        product(), product({ id: 'prueba-2', nombre: 'Silicón premium', precioDesde: '100' }),
        product({ id: 'prueba-3', nombre: 'Silicón ventana', precioDesde: '5', categoria: { nombre: 'Ventanas' } })
    ]);
    const ids = result => Array.from(result, p => p.id);
    assert.deepEqual(ids(lib.filter(products, 'SILICON', 'Accesorios', 'high')), ['prueba-2', 'prueba-1']);
    assert.deepEqual(ids(lib.filter(products, '', '', 'low')), ['prueba-3', 'prueba-1', 'prueba-2']);
    assert.equal(lib.filter(products, 'inexistente', '', 'low').length, 0);
    assert.deepEqual(ids(products), ['prueba-1', 'prueba-2', 'prueba-3']);
});

test('consulta una vez GET /productos y propaga errores HTTP, JSON y de red', async () => {
    let calls = 0;
    const lib = library({ fetch: async (url, options) => {
        calls++;
        assert.equal(url, 'http://localhost:3000/productos');
        assert.ok(options.signal);
        return { ok: true, json: async () => [product()] };
    } });
    assert.equal((await lib.load()).length, 1);
    assert.equal(calls, 1);
    for (const fetch of [async () => ({ ok: false, status: 500 }),
        async () => { throw new Error('Sin conexión'); },
        async () => ({ ok: true, json: async () => { throw new Error('JSON inválido'); } })]) {
        await assert.rejects(library({ fetch }).load());
    }
});

test('aborta consultas que exceden el límite y libera el temporizador', async () => {
    let expired, cleared = false;
    const lib = library({ setTimeout: callback => { expired = callback; return 1; },
        clearTimeout: () => { cleared = true; },
        fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('timeout')));
        }) });
    const pending = lib.load();
    expired();
    await assert.rejects(pending);
    assert.equal(cleared, true);
});
