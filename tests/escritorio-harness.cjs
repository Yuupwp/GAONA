const path = require('node:path');
const { createRequire, Module } = require('node:module');
const apiRequire = createRequire(path.join(__dirname, '../api/package.json'));
apiRequire('tsx/cjs');
const secreto = 'secreto-exclusivo-de-pruebas-aisladas-32-bytes';
function crearHarness(prisma) {
    process.env.JWT_SECRET = secreto;
    process.env.MAIL_ENABLED = 'false';
    const file = apiRequire.resolve('./src/lib/prisma.ts');
    const mock = new Module(file);
    mock.loaded = true;
    mock.exports = { prisma };
    require.cache[file] = mock;
    const { app } = apiRequire('./src/escritorio.ts');
    const jwt = apiRequire('jsonwebtoken');
    return { app, token: (id, opciones = {}) => jwt.sign({ id, rol: 'ADMINISTRADOR' }, secreto, { expiresIn: '1h', ...opciones }), apiRequire };
}
module.exports = { crearHarness, apiRequire };
