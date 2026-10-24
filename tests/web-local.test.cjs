const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const { apiRequire,valid,fixture } = require('./pdf-harness.cjs');
const { crearApiWeb } = apiRequire('./src/api-web');

test('API local: inyección de transporte no permite enviar con correo desactivado o en producción', async()=>{
    for(const env of [{MAIL_ENABLED:'false'},{NODE_ENV:'production',MAIL_ENABLED:'true'}]){
        let calls=0;
        const db={producto:{findMany:async()=>fixture},solicitud:{create:async()=>({id:'11111111-2222-4333-8444-555555555555',creadoEn:new Date()})}};
        const app=crearApiWeb(db,env,false,()=>{calls++;throw Error('Transporte prohibido');});
        const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
        try{
            const r=await fetch(`http://127.0.0.1:${server.address().port}/solicitudes`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'web5c-guardia-simulada'},body:JSON.stringify(valid)});
            assert.equal(r.status,env.NODE_ENV==='production'?503:201);assert.equal(calls,0);
        }finally{await new Promise(resolve=>server.close(resolve));}
    }
});

test('API local: entrada local rechaza conexión remota, identidad administrativa y producción antes de conectar',()=>{
    const entry=path.resolve(__dirname,'../api/src/web-local.ts');
    const base={PATH:process.env.PATH,NODE_ENV:'development',GAONA_WEB_LOCAL:'WEB5C_POSTGRES_LOCAL',WEB_HOST:'127.0.0.1',WEB_PORT:'3000',
        GAONA_WEB_LOCAL_DIR:path.join(require('node:os').homedir(),'.local','state','gaona-web5c')};
    for(const input of [{WEB_DATABASE_URL:'postgresql://gaona_web5c_web@remote.invalid:6432/gaona_web5c_aislada'},
        {WEB_DATABASE_URL:'postgresql://administrador@127.0.0.1:6432/gaona_web5c_aislada'},
        {NODE_ENV:'production'},{WEB_PORT:'4000'}]){
        const r=spawnSync(process.execPath,['--require',apiRequire.resolve('tsx/cjs'),entry],{env:{...base,...input},encoding:'utf8',timeout:10000});
        assert.equal(r.status,1);assert.equal(r.stdout,'');assert.match(r.stderr,/API local rechazada/);
        assert.ok(!r.stderr.includes('postgresql://'));
    }
});
