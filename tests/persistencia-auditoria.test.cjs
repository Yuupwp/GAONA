const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { apiRequire, validarLocal, env } = require('./persistencia-fixture.cjs');
const { PrismaClient } = apiRequire('@prisma/client');
const url = process.env.GAONA_PERSIST_TEST_DATABASE_URL;
const adminUrl = process.env.GAONA_PERSIST_TEST_ADMIN_URL;
if (url) validarLocal(url);
if (adminUrl) validarLocal(adminUrl);
const local = (name, run) => test(name, { skip: !url || !adminUrl }, run);
let db, owner;
before(() => {
    if (!url || !adminUrl) return;
    db = new PrismaClient({ datasources: { db: { url } }, log: [] });
    owner = new PrismaClient({ datasources: { db: { url: adminUrl } }, log: [] });
});
after(async () => { await db?.$disconnect(); await owner?.$disconnect(); });
const como = (rol, fn) => {
    assert.ok(['anon', 'authenticated', 'service_role', 'gaona_web_login'].includes(rol));
    return owner.$transaction(async tx => { await tx.$executeRawUnsafe(`SET LOCAL ROLE ${rol}`); return fn(tx); });
};
local('Auditoría: login propuesto queda deshabilitado, hereda solo el grupo y carece de privilegios administrativos', async () => {
    const roles = await owner.$queryRaw`SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname='gaona_web_login'`;
    assert.deepEqual(roles[0], { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false });
    const members = await owner.$queryRaw`SELECT r.rolname, m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member='gaona_web_login'::regrole`;
    assert.deepEqual(members, [{ rolname: 'gaona_web_backend', admin_option: false, inherit_option: true, set_option: false }]);
    const granted = await como('gaona_web_login', tx => tx.$queryRaw`SELECT has_table_privilege(current_user,'public.clientes','INSERT') AS registrar,
      has_table_privilege(current_user,'public.usuarios','SELECT') AS empleados,
      has_table_privilege(current_user,'public.cotizaciones','INSERT') AS cotizar,
      has_table_privilege(current_user,'public.productos','UPDATE') AS inventario,
      has_schema_privilege(current_user,'public','CREATE') AS ddl,
      has_table_privilege(current_user,'gaona_mensajeria.configuracion','UPDATE') AS claves,
      pg_has_role(current_user,'gaona_local_admin','MEMBER') AS propietario`);
    assert.deepEqual(granted[0], { registrar: true, empleados: false, cotizar: false, inventario: false, ddl: false, claves: false, propietario: false });
});
local('Auditoría: RLS conserva denegación pública y el esquema privado no es accesible a roles Supabase', async () => {
    for (const rol of ['anon', 'authenticated']) {
        const permisos = await owner.$queryRawUnsafe(`SELECT has_table_privilege('${rol}','public.clientes','SELECT') AS lectura`);
        if (process.env.GAONA_SUPABASE_METADATA_FIXTURE === 'true') {
            assert.equal(permisos[0].lectura, true);
            assert.deepEqual(await como(rol, tx => tx.$queryRaw`SELECT id FROM public.clientes`), []);
        }
    }
    for (const rol of ['anon', 'authenticated', 'service_role']) {
        await assert.rejects(como(rol, tx => tx.$queryRaw`SELECT solicitud_id FROM gaona_mensajeria.correos`));
    }
    const policies = await owner.$queryRaw`SELECT policyname, roles::text FROM pg_policies WHERE schemaname='public'`;
    assert.equal(policies.length, 8);
    assert.ok(policies.every(p => p.roles === '{gaona_web_backend}'));
});
local('Auditoría: catálogo filtra productos inactivos y materiales sin conceder escritura administrativa', async () => {
    const prefix = randomUUID();
    const categoria = await owner.categoria.create({ data: { nombre: 'PRUEBA AISLADA auditoría ' + prefix } });
    for (const [sufijo, activo, tipo] of [['visible', true, 'PRODUCTO'], ['inactivo', false, 'PRODUCTO'], ['material', true, 'MATERIAL']]) {
        await owner.producto.create({ data: { id: prefix + sufijo, idCategoria: categoria.id, nombre: 'SIMULADO ' + sufijo, precioDesde: '1.00', activo, tipo } });
    }
    const rows = await db.producto.findMany({ where: { idCategoria: categoria.id }, select: { id: true } });
    assert.deepEqual(rows, [{ id: prefix + 'visible' }]);
    await assert.rejects(db.producto.update({ where: { id: prefix + 'visible' }, data: { precioDesde: '2.00' } }));
    await assert.rejects(db.usuario.findMany());
    await assert.rejects(db.$executeRaw`UPDATE public.clientes SET nombre=nombre WHERE false`);
    await assert.rejects(db.$executeRaw`TRUNCATE public.clientes`);
});
local('Auditoría: el backend solo puede dar de alta solicitudes WEB nuevas sin asignación administrativa', async () => {
    const cliente = await owner.cliente.create({ data: { nombre: 'PRUEBA', apellido: 'AISLADA auditoría', telefono: '5555555555' } });
    for (const data of [{ origen: 'ESCRITORIO' }, { estado: 'EN_REVISION' }]) {
        await assert.rejects(db.solicitud.create({ data: { idCliente: cliente.id, ...data } }));
    }
    const alta = await db.solicitud.create({ data: { idCliente: cliente.id }, select: { id: true } });
    assert.ok(alta.id);
    await assert.rejects(db.solicitud.update({ where: { id: alta.id }, data: { estado: 'COTIZADA' } }));
    const admin = await owner.solicitud.update({ where: { id: alta.id }, data: { estado: 'EN_REVISION' } });
    assert.equal(admin.estado, 'EN_REVISION');
});
local('Auditoría: FK preserva históricos vinculados y documenta conflicto con borrado administrativo de clientes', async () => {
    const categoria = await owner.categoria.create({ data: { nombre: 'PRUEBA AISLADA FK ' + randomUUID() } });
    const producto = await owner.producto.create({ data: { idCategoria: categoria.id, nombre: 'SIMULADO auditoría FK', precioDesde: '3950.00' } });
    const input = { cliente: { nombre: 'PRUEBA', apellido: 'AISLADA FK', telefono: '5555555555' }, whatsappConsentimiento: false,
        productos: [{ idProducto: producto.id, cantidad: 1, medidasAprox: '90 x 210 cm' }] };
    const store = apiRequire('./src/solicitud-persistencia').crearPersistenciaSolicitudes(db, { ...env, MAIL_ENABLED: 'false' });
    const record = await store.registrar('auditoria-' + randomUUID(), input, tx => apiRequire('./src/solicitud-registro').registrarSolicitud(tx, input), 'auditoria-' + randomUUID());
    assert.equal(record.comprobante.estimado.total, '4582.00');
    await assert.rejects(owner.solicitud.delete({ where: { id: record.comprobante.id } }), e => e.code === 'P2003');
    assert.ok(await owner.solicitud.findUnique({ where: { id: record.comprobante.id } }));
    const previo = await owner.solicitud.create({ data: { cliente: { create: input.cliente } } });
    await owner.solicitud.delete({ where: { id: previo.id } });
});
local('Auditoría: fixture conserva restricciones y triggers administrativos que Prisma no representa', async () => {
    if (process.env.GAONA_SUPABASE_METADATA_FIXTURE !== 'true') return;
    const extras = await owner.$queryRaw`SELECT conname FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname IN ('citas_fin_mayor_inicio','citas_sin_empalme','pagos_monto_check') ORDER BY conname`;
    assert.deepEqual(extras.map(r => r.conname), ['citas_fin_mayor_inicio', 'citas_sin_empalme', 'pagos_monto_check']);
    const triggers = await owner.$queryRaw`SELECT count(*)::int AS total FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal`;
    assert.equal(triggers[0].total, 7);
    const cliente = await owner.cliente.create({ data: { nombre: 'PRUEBA', apellido: 'TRIGGER AISLADO', telefono: '5555555555' } });
    await owner.$executeRaw`UPDATE public.clientes SET "actualizadoEn"='2000-01-01'::timestamp WHERE id=${cliente.id}`;
    assert.ok((await owner.cliente.findUnique({ where: { id: cliente.id } })).actualizadoEn.getUTCFullYear() > 2000);
});
local('Auditoría: respaldo local SHA-256 restaura estructura y rechaza migraciones repetidas o RLS divergente', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gaona-auditoria-'));
    fs.chmodSync(work, 0o700);
    const bin = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout.trim();
    const base = new URL(adminUrl);
    const localEnv = { PATH: process.env.PATH, PGHOST: '127.0.0.1', PGPORT: base.port, PGUSER: 'gaona_local_admin', PGDATABASE: base.pathname.slice(1) };
    const run = (program, args, success = true) => {
        const r = spawnSync(path.join(bin, program), args, { env: localEnv, encoding: 'utf8' });
        if (success) assert.equal(r.status, 0, r.stderr);
        else assert.notEqual(r.status, 0);
        return r;
    };
    const archive = path.join(work, 'respaldo.dump');
    let restored;
    try {
        run('pg_dump', ['--no-password', '--format=custom', '--schema=public', '--schema=gaona_mensajeria', '--file', archive]);
        const hash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
        fs.writeFileSync(archive + '.sha256', hash, { mode: 0o600 });
        assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), fs.readFileSync(archive + '.sha256', 'utf8'));
        const list = run('pg_restore', ['--list', archive]).stdout;
        assert.match(list, /gaona_mensajeria correos/);
        run('createdb', ['gaona_auditoria_restaurada']);
        run('psql', ['-X', '-d', 'gaona_auditoria_restaurada', '-v', 'ON_ERROR_STOP=1', '-c', 'DROP SCHEMA public']);
        const restore = section => run('pg_restore', ['--no-password', '--exit-on-error', '--section=' + section, '--dbname', 'gaona_auditoria_restaurada', archive]);
        restore('pre-data');
        if (process.env.GAONA_SUPABASE_METADATA_FIXTURE === 'true') run('psql', ['-X', '-d', 'gaona_auditoria_restaurada', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE EXTENSION btree_gist WITH SCHEMA public']);
        restore('data');
        restore('post-data');
        base.pathname = '/gaona_auditoria_restaurada';
        restored = new PrismaClient({ datasources: { db: { url: base.toString() } }, log: [] });
        const tables = await restored.$queryRaw`SELECT count(*)::int AS total FROM pg_tables WHERE schemaname='gaona_mensajeria'`;
        assert.equal(tables[0].total, 6);
        const verification = path.resolve(__dirname, '../api/propuestas/persistencia-verificacion.sql');
        run('psql', ['-X', '-d', 'gaona_auditoria_restaurada', '-v', 'ON_ERROR_STOP=1', '-f', verification]);
        run('psql', ['-X', '-d', 'gaona_auditoria_restaurada', '-v', 'ON_ERROR_STOP=1', '-c', 'SET ROLE gaona_web_login', '-f', verification]);
        const snapshot = async () => JSON.stringify(await restored.$queryRaw`SELECT version,idempotencia_huella,acceso_huella FROM gaona_mensajeria.configuracion`);
        const initial = await snapshot();
        for (const file of ['whatsapp-cloud.sql', 'correo-smtp.sql', 'persistencia-huellas.sql']) {
            const fail = run('psql', ['-X', '-d', 'gaona_auditoria_restaurada', '-v', 'ON_ERROR_STOP=1', '-f', path.resolve(__dirname, '../api/propuestas', file)], false);
            assert.match(fail.stderr, /already exists|ya existe|version 1|no se sobrescriben/);
            assert.equal(await snapshot(), initial);
        }
        await restored.$executeRaw`ALTER TABLE public.productos DISABLE ROW LEVEL SECURITY`;
        const fail = run('psql', ['-X', '-d', 'gaona_auditoria_restaurada', '-v', 'ON_ERROR_STOP=1', '-f', path.resolve(__dirname, '../api/propuestas/persistencia-permisos.sql')], false);
        assert.match(fail.stderr, /requieren RLS previamente revisado/);
        assert.equal(await snapshot(), initial);
    } finally {
        await restored?.$disconnect();
        run('dropdb', ['--if-exists', 'gaona_auditoria_restaurada']);
        fs.rmSync(work, { recursive: true, force: true });
    }
});
