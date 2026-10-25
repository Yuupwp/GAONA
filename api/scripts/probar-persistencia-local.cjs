const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const req = createRequire(path.join(root, 'api/package.json'));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gaona-persistencia-'));
fs.chmodSync(work, 0o700);
const data = path.join(work, 'postgres');
let started = false, pg, env;
function run(binary, args, options = {}) {
    const result = spawnSync(binary, args, { cwd: root, env, encoding: 'utf8', ...options });
    if (result.status !== 0) {
        fs.writeFileSync(path.join(work, 'error.log'), String(result.stderr || result.stdout));
        throw Error(`Falló ${path.basename(binary)}; diagnóstico local: ${path.join(work, 'error.log')}`);
    }
    return result.stdout;
}
(async () => {
    try {
        pg = process.env.PG_BIN || spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' }).stdout.trim();
        if (!pg || !fs.existsSync(path.join(pg, 'initdb'))) throw Error('Se necesita PostgreSQL local con initdb y pg_ctl');
        const port = await new Promise((resolve, reject) => {
            const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
        });
        if (port === 5432) throw Error('No se utiliza el puerto de la base habitual');
        env = { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: 'gaona_local_admin', PGDATABASE: 'postgres' };
        run(path.join(pg, 'initdb'), ['-D', data, '-U', 'gaona_local_admin', '--auth=trust', '--encoding=UTF8', '--locale=C', '--no-instructions']);
        const cert = path.join(work, 'servidor-ficticio.crt'), key = path.join(work, 'servidor-ficticio.key');
        run('/usr/bin/openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);
        fs.chmodSync(key, 0o600);
        fs.appendFileSync(path.join(data, 'postgresql.conf'), `\nssl=on\nssl_cert_file='${cert}'\nssl_key_file='${key}'\n`);
        run(path.join(pg, 'pg_ctl'), ['-D', data, '-l', path.join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${work}`, '-w', 'start']);
        started = true;
        run(path.join(pg, 'createdb'), ['gaona_persistencia_aislada']);
        env.PGDATABASE = 'gaona_persistencia_aislada';
        const admin = `postgresql://gaona_local_admin@127.0.0.1:${port}/gaona_persistencia_aislada?sslmode=disable`;
        const backend = `postgresql://gaona_web_pruebas@127.0.0.1:${port}/gaona_persistencia_aislada?sslmode=disable`;
        const cli = path.join(path.dirname(req.resolve('prisma/package.json')), 'build/index.js');
        const localSchema = path.join(work, 'schema.prisma');
        fs.copyFileSync(path.join(root, 'api/prisma/schema.prisma'), localSchema);
        const publicSql = run(process.execPath, [cli, 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', localSchema, '--script'], { cwd: work, env: { ...env, DATABASE_URL: admin, DIRECT_URL: admin } });
        const publicFile = path.join(work, 'public.sql'); fs.writeFileSync(publicFile, publicSql);
        const sql = args => run(path.join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', ...args]);
        sql(['-c', 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS']);
        sql(['-f', process.argv.includes('--supabase-audit') ? path.join(root, 'tests/fixtures/supabase-estructura.sql') : publicFile]);
        sql(['-c', `DO $$ DECLARE tabla record; BEGIN FOR tabla IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla.tablename); END LOOP; END $$`]);
        sql(['-f', path.join(root, 'api/propuestas/whatsapp-cloud.sql')]);
        const { PrismaClient } = req('@prisma/client');
        const db = new PrismaClient({ datasources: { db: { url: admin } }, log: [] });
        try { await require('../../tests/persistencia-fixture.cjs').seedLegado(db); } finally { await db.$disconnect(); }
        sql(['-f', path.join(root, 'api/propuestas/correo-smtp.sql')]);
        sql(['-f', path.join(root, 'api/propuestas/persistencia-permisos.sql')]);
        sql(['-f', path.join(root, 'api/propuestas/persistencia-login.sql')]);
        const { createHash } = require('node:crypto');
        const fingerprint = key => createHash('sha256').update(Buffer.from(key.repeat(64), 'hex')).digest('hex');
        sql(['--set=idempotencia_huella=' + fingerprint('c'), '--set=acceso_huella=' + fingerprint('e'), '--set=legado_huella=' + fingerprint('a'), '-f', path.join(root, 'api/propuestas/persistencia-huellas.sql')]);
        sql(['-c', 'CREATE ROLE gaona_web_pruebas LOGIN IN ROLE gaona_web_backend']);
        run(path.join(pg, 'createdb'), ['gaona_whatsapp_aislada']);
        const wa = `postgresql://gaona_local_admin@127.0.0.1:${port}/gaona_whatsapp_aislada?sslmode=disable`;
        const waEnv = { ...env, PGDATABASE: 'gaona_whatsapp_aislada' };
        run(path.join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE TABLE public.solicitudes(id text PRIMARY KEY)'], { env: waEnv });
        run(path.join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-f', path.join(root, 'api/propuestas/whatsapp-cloud.sql')], { env: waEnv });
        run(path.join(pg, 'createdb'), ['gaona_web3_aislada']);
        const web3Admin = `postgresql://gaona_local_admin@127.0.0.1:${port}/gaona_web3_aislada?sslmode=disable`;
        const web3Backend = `postgresql://gaona_web_publico_pruebas@127.0.0.1:${port}/gaona_web3_aislada?sslmode=disable`;
        const web3Env = { ...env, PGDATABASE: 'gaona_web3_aislada' };
        const web3Sql = args => run(path.join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', ...args], { env: web3Env });
        web3Sql(['-f', path.join(root, 'tests/fixtures/supabase-estructura.sql')]);
        const installation = path.join(root, 'api/propuestas/web/01-instalacion.sql');
        const blocked = spawnSync(path.join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-f', installation], { env: web3Env, encoding: 'utf8' });
        if (blocked.status === 0 || !blocked.stderr.includes('aprobar expresamente')) throw Error('La instalación debe bloquearse sin decisión sobre borrado');
        run(path.join(pg, 'psql'), ['-X', '-v', 'ON_ERROR_STOP=1', '-f', installation], { env: { ...web3Env, PGOPTIONS: '-c gaona.web3_fk_restrict_aprobado=si' } });
        web3Sql(['-f', path.join(root, 'api/propuestas/web/02-permisos.sql')]);
        web3Sql(['-f', path.join(root, 'api/propuestas/web/03-login.sql')]);
        web3Sql(['--set=idempotencia_huella=' + fingerprint('c'), '--set=acceso_huella=' + fingerprint('e'), '--set=legado_huella=', '-f', path.join(root, 'api/propuestas/persistencia-huellas.sql')]);
        web3Sql(['-c', 'CREATE ROLE gaona_web_publico_pruebas LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; GRANT gaona_web_publico TO gaona_web_publico_pruebas WITH INHERIT TRUE, SET FALSE, ADMIN FALSE']);
        web3Sql(['-f', path.join(root, 'api/propuestas/web/04-verificacion.sql')]);
        run(path.join(pg, 'createdb'), ['gaona_data_api_aislada']);
        const dataApiAdmin = `postgresql://gaona_local_admin@127.0.0.1:${port}/gaona_data_api_aislada?sslmode=disable`;
        const dataApiEnv = { ...env, PGDATABASE: 'gaona_data_api_aislada' };
        const dataSql = (args, input) => run(path.join(pg,'psql'), ['-X','-v','ON_ERROR_STOP=1',...args], {env:dataApiEnv,input});
        dataSql(['-f',path.join(root,'tests/fixtures/supabase-estructura.sql')]);
        dataSql([],`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
          CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
          GRANT USAGE ON SCHEMA auth TO authenticated,anon;
          INSERT INTO auth.users(id,email_confirmed_at) VALUES ('00000000-0000-4000-8000-000000000001',now());`);
        dataSql(['-c',`INSERT INTO public.clientes(id,nombre,apellido,telefono) VALUES ('administrativo-previo-aislado','Dato ficticio previo','No modificar','+15555550000')`]);
        const previousClient = dataSql(['-At','-c',`SELECT to_jsonb(c) FROM public.clientes c WHERE id='administrativo-previo-aislado'`]);
        const sharedSnapshot = `SELECT jsonb_build_object(
          'tablas',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles')),
          'columnas',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('productos','categorias','clientes','solicitudes','solicitud_detalles')),
          'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r),
          'membresias',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member) FROM pg_auth_members m),
          'predeterminados',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d));`;
        const sharedBefore = dataSql(['-At','-c',sharedSnapshot]);
        const rejectedInstall = spawnSync(path.join(pg,'psql'),['-X','-v','ON_ERROR_STOP=1','-v','backend_uid=00000000-0000-4000-8000-000000000001','-v','idempotencia_huella=huella-invalida','-v','acceso_huella='+fingerprint('e'),'-f',path.join(root,'api/propuestas/data-api/instalacion.sql')],{env:dataApiEnv,encoding:'utf8'});
        if (rejectedInstall.status===0 || dataSql(['-At','-c',`SELECT count(*) FROM pg_namespace WHERE nspname='gaona_web_interno'`]).trim()!=='0' || dataSql(['-At','-c',`SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'gaona_web_%'`]).trim()!=='0' || dataSql(['-At','-c',sharedSnapshot])!==sharedBefore) throw Error('La instalación inválida no revirtió todos los cambios');
        dataSql(['-v','backend_uid=00000000-0000-4000-8000-000000000001','-v','idempotencia_huella='+fingerprint('c'),'-v','acceso_huella='+fingerprint('e'),'-f',path.join(root,'api/propuestas/data-api/instalacion.sql')]);
        if (dataSql(['-At','-c',sharedSnapshot]) !== sharedBefore) throw Error('La instalación alteró ACL, estructura compartida, roles o permisos predeterminados');
        dataSql(['-f',path.join(root,'api/propuestas/data-api/04-verificacion.sql')]);
        console.log('Data API: instalación transaccional documentada verificada; ACL compartidas, roles y columnas intactos.');
        const testEnv = { ...env, WEB_DATABASE_URL: backend, GAONA_PERSIST_TEST_DATABASE_URL: backend, GAONA_PERSIST_TEST_ADMIN_URL: admin, GAONA_WHATSAPP_TEST_DATABASE_URL: wa, GAONA_SUPABASE_METADATA_FIXTURE: process.argv.includes('--supabase-audit') ? 'true' : 'false',
            GAONA_WEB3_TEST_DATABASE_URL: web3Backend, GAONA_WEB3_TEST_ADMIN_URL: web3Admin, GAONA_WEB10_TEST_CA: cert, GAONA_DATA_API_TEST_ADMIN_URL: dataApiAdmin,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) };
        console.log('PostgreSQL desechable: estructura aislada, migración v1→v2 con datos simulados y roles NOBYPASSRLS preparados.');
        run(process.execPath, [path.join(root, 'api/node_modules/typescript/bin/tsc'), '--noEmit', '-p', path.join(root, 'api/tsconfig.json')], { env: testEnv, stdio: 'inherit' });
        const tests = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.cjs')).map(f => 'tests/' + f);
        run(process.execPath, ['--test', '--test-concurrency=1', ...tests], { env: testEnv, stdio: 'inherit' });
        if (!process.argv.includes('--no-browser')) {
            for (const f of ['catalogo', 'solicitud-pdf', 'solicitud-correo', 'solicitud-whatsapp', 'whatsapp-cloud', 'solicitud-persistencia', 'api-web-postgres', 'correo-formulario', 'formulario-accesibilidad']) {
                run(process.execPath, [path.join(root, 'tests', f + '.browser.cjs')], { env: testEnv, stdio: 'inherit' });
            }
            run(process.execPath, [path.join(root,'tests/api-web-postgres.browser.cjs')], { env: { ...testEnv, GAONA_WEB3_BROWSER: 'true' }, stdio: 'inherit' });
        }
        if (dataSql(['-At','-c',`SELECT to_jsonb(c) FROM public.clientes c WHERE id='administrativo-previo-aislado'`])!==previousClient) throw Error('Se alteró un registro administrativo ficticio previo');
        console.log('PASS: pruebas locales completas sin credenciales compartidas ni transportes de envío reales.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    finally {
        if (started) {
            const stopped = spawnSync(path.join(pg, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { env, stdio: 'ignore' });
            if (stopped.status !== 0) { console.error('No se confirmó el cierre del clúster local; se conservan sus archivos'); process.exitCode = 1; }
        }
        if (!process.exitCode) fs.rmSync(work, { recursive: true, force: true });
        else console.error(`Artefactos locales de diagnóstico conservados en ${work}`);
    }
})();
