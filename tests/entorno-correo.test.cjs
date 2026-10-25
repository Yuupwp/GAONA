const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { apiRequire } = require('./pdf-harness.cjs');

test('el backend administrativo conserva dotenv sin sobrescribir variables inyectadas', () => {
    const env = { DATABASE_URL: 'conexion-inyectada-ficticia', PORT: '3999', API_HOST: 'localhost' };
    const before = { ...env };
    apiRequire('dotenv').populate(env, { DATABASE_URL: 'conexion-archivo-ficticia', PORT: '3888', API_HOST: '127.0.0.1' });
    assert.deepEqual(env, before);
    const source = fs.readFileSync(path.resolve(__dirname, '../api/src/index.ts'), 'utf8');
    assert.match(source, /import "dotenv\/config"/);
    assert.doesNotMatch(source, /configurar-entorno|"\.\/entorno"|crearApiWeb/);
});
