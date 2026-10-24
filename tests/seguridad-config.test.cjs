const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./pdf-harness.cjs');

test('la API pública escucha solo en loopback por defecto y permite un host explícito', async () => {
    const local = createHarness({ entry: 'web.ts' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(local.state.listenArgs[0], 3000);
    assert.equal(local.state.listenArgs[1], '127.0.0.1');
    const explicit = createHarness({ entry: 'web.ts', apiEnv: { WEB_HOST: '0.0.0.0', WEB_PORT: '4000' } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(explicit.state.listenArgs[0], 4000);
    assert.equal(explicit.state.listenArgs[1], '0.0.0.0');
    for (const PORT of ['abc', '0', '-1', '65536', '3000.5']) {
        assert.throws(() => createHarness({ entry: 'web.ts', apiEnv: { WEB_PORT: PORT } }), /PORT debe ser un puerto válido/);
    }
});
