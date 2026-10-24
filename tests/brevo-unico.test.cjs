const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { apiRequire } = require('./pdf-harness.cjs');
const lab = require('../api/scripts/brevo-unico.cjs');
const nodemailer = apiRequire('nodemailer');
const parent = fs.mkdtempSync(path.join(os.tmpdir(),'gaona-smtp-test-'));
after(() => fs.rmSync(parent,{recursive:true,force:true}));
const from = 'remitente@example.test', to = 'cliente@example.test';
const prepare = (name, etapa) => lab.preparar(path.join(parent,name),from,to,etapa);
const options = preview => ({ user:'usuario-smtp-simulado',password:'clave-smtp-simulada',
    confirmacion:`AUTORIZO ${preview.folio} A ${to}` });

test('Ensayo SMTP único: PostgreSQL restringido, solicitud ficticia idempotente, PDF y MIME sin SMTP externo', async () => {
    const preview=await prepare('flujo'),directory=path.join(parent,'flujo');
    assert.equal(preview.remitente,from);assert.equal(preview.destinatario,to);
    assert.equal(preview.subtotal,'2500.30');assert.equal(preview.iva,'400.05');assert.equal(preview.total,'2900.35');
    assert.match(preview.folio,/^[a-f\d-]{36}$/);assert.match(preview.postgres,/sin BYPASSRLS/);
    const pdf=lab.leer(directory,preview.pdf),raw=lab.leer(directory,'mensaje-simulado.eml');
    assert.equal(lab.sha(pdf),preview.sha256);
    const parsed=spawnSync('python3',['-c',`import sys,json,base64
from email import policy
from email.parser import BytesParser
m=BytesParser(policy=policy.default).parsebytes(sys.stdin.buffer.read())
print(json.dumps(dict(sender=m['From'],to=m['To'],cc=m['Cc'],bcc=m['Bcc'],subject=m['Subject'],attachments=[dict(name=a.get_filename(),content=base64.b64encode(a.get_payload(decode=True)).decode()) for a in m.iter_attachments()])))`],{input:raw,encoding:'utf8'});
    assert.equal(parsed.status,0);const mime=JSON.parse(parsed.stdout);
    assert.ok(mime.sender.includes(from));assert.equal(mime.to,to);assert.equal(mime.cc,null);assert.equal(mime.bcc,null);
    assert.equal(mime.subject,preview.asunto);assert.equal(mime.attachments.length,1);
    assert.equal(mime.attachments[0].name,preview.pdf);assert.equal(lab.sha(Buffer.from(mime.attachments[0].content,'base64')),preview.sha256);
    const text=spawnSync('pdftotext',['-','-'],{input:pdf,encoding:'utf8'});
    assert.equal(text.status,0);
    for(const expected of [preview.folio,'Cliente Ficticio SMTP','Producto ficticio SMTP','2,500.30','400.05','2,900.35']) assert.ok(text.stdout.includes(expected),expected);
    assert.equal(fs.existsSync(path.join(directory,'intento-reservado.json')),false);
    assert.equal(lab.json(directory,'simulacion.json').intentos_reales,0);
    assert.deepEqual(await lab.simular(directory),preview);
    for(const file of ['resumen.json','laboratorio.json','mensaje-simulado.eml',preview.pdf]) assert.equal(fs.statSync(path.join(directory,file)).mode & 0o077,0);
});

test('Ensayo SMTP único: reserva duradera limita a un intento, conserva identificadores y bloquea repetir tras reinicio', async () => {
    const preview=await prepare('unico'),directory=path.join(parent,'unico');let calls=0,captured;
    const fabrica=opciones=>{
        assert.equal(opciones.auth.user,'usuario-smtp-simulado');assert.equal(opciones.auth.pass,'clave-smtp-simulada');
        const stream=nodemailer.createTransport({streamTransport:true,buffer:true});
        return {async sendMail(message){calls++;captured=message;await stream.sendMail(message);
            return {accepted:[to],rejected:[],messageId:message.messageId,response:'250 2.0.0 queued as cola-simulada-web5'};},close(){stream.close();}};
    };
    await assert.rejects(lab.enviarUnaVez(directory,{...options(preview),confirmacion:'NO AUTORIZO',fabrica}));
    assert.equal(calls,0);assert.equal(fs.existsSync(path.join(directory,'intento-reservado.json')),false);
    const result=await lab.enviarUnaVez(directory,{...options(preview),fabrica});
    assert.equal(result.estado,'aceptado');assert.equal(result.intentos,1);assert.equal(calls,1);
    assert.equal(result.respuesta_smtp,250);assert.equal(result.cola_smtp,'cola-simulada-web5');
    assert.equal(result.mensaje_id,captured.messageId);assert.equal(result.sha256,preview.sha256);
    assert.match(result.entrega,/pendiente/);
    await assert.rejects(lab.enviarUnaVez(directory,{...options(preview),fabrica}));
    await assert.rejects(lab.simular(directory));assert.equal(calls,1);
    assert.equal(lab.json(directory,'resultado.json').intentos,1);
    for(const change of [{cc:['otro@example.test']},{bcc:['otro@example.test']},{to:{address:'otro@example.test'}},
        {envelope:{from,to:[to,'otro@example.test']}},{attachments:[...captured.attachments,...captured.attachments]}]) {
        assert.throws(()=>lab.validarMensaje({...captured,...change},preview,lab.leer(directory,preview.pdf)));
    }
    assert.equal(fs.readFileSync(path.join(directory,'resultado.json'),'utf8').includes('clave-smtp-simulada'),false);
});

test('Ensayo SMTP único: errores e incertidumbre no permiten repetir y las respuestas no publican credenciales', async () => {
    for(const code of ['EAUTH','ETIMEDOUT','respuesta-sensible']) {
        const preview=await prepare(code),directory=path.join(parent,code);let calls=0;
        const fabrica=()=>({async sendMail(){calls++;
            if(code==='respuesta-sensible') return {accepted:[to],rejected:[],messageId:'clave-smtp-simulada',response:'250 queued as clave-smtp-simulada'};
            throw Object.assign(Error('detalle privado no publicable'),{code});},close(){}});
        const result=await lab.enviarUnaVez(directory,{...options(preview),fabrica});
        assert.equal(result.estado,code==='EAUTH'?'error':code==='ETIMEDOUT'?'no_confirmado':'aceptado');assert.equal(result.intentos,1);
        assert.equal(result.codigo_error,code==='respuesta-sensible'?null:code);
        assert.equal(JSON.stringify(result).includes('detalle privado'),false);
        assert.equal(JSON.stringify(result).includes('clave-smtp-simulada'),false);
        await assert.rejects(lab.enviarUnaVez(directory,{...options(preview),fabrica}));assert.equal(calls,1);
        assert.ok(fs.existsSync(path.join(directory,'intento-reservado.json')));
    }
});

test('Ensayo SMTP único: bloqueo previo y PDF alterado impiden crear un transporte', async () => {
    const preview=await prepare('integridad'),directory=path.join(parent,'integridad');let calls=0;
    const fabrica=()=>{calls++;throw Error('No debe crearse transporte');};
    fs.writeFileSync(path.join(directory,'ejecucion.lock'),'interrupcion-simulada',{mode:0o600});
    await assert.rejects(lab.enviarUnaVez(directory,{...options(preview),fabrica}));
    fs.unlinkSync(path.join(directory,'ejecucion.lock'));
    fs.appendFileSync(path.join(directory,preview.pdf),'alteracion-simulada');
    await assert.rejects(lab.enviarUnaVez(directory,{...options(preview),fabrica}));
    assert.equal(calls,0);assert.equal(fs.existsSync(path.join(directory,'intento-reservado.json')),false);
});

test('Ensayo SMTP único: CLI rechaza producción, argumentos adicionales y ejecución sin terminal antes de pedir secretos', () => {
    const script=path.resolve(__dirname,'../api/scripts/prueba-brevo-local.cjs');
    for(const [args,env] of [[['enviar'],{NODE_ENV:'production'}],[['enviar','extra'],{}],[['enviar'],{}]]) {
        const result=spawnSync(process.execPath,[script,...args],{env:{PATH:process.env.PATH,...env},encoding:'utf8',stdio:['ignore','pipe','pipe']});
        assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/Prueba SMTP detenida/);
        assert.equal(result.stderr.includes('Usuario SMTP'),false);
    }
});

test('Ensayo SMTP único: destinatarios múltiples e inyección rechazados antes de crear el laboratorio', async () => {
    for(const [sender,recipient] of [[from,to+',otro@example.test'],[from,to+'\r\nBcc: otro@example.test'],[from+',otro@example.test',to]]) {
        const directory=path.join(parent,'invalida');
        await assert.rejects(lab.preparar(directory,sender,recipient));assert.equal(fs.existsSync(directory),false);
    }
});

test('Ensayo SMTP único: laboratorio nuevo conserva intento EDNS anterior y aplica diagnóstico a un único transporte simulado', async () => {
    const first=await prepare('anterior-edns'),old=path.join(parent,'anterior-edns');
    await lab.enviarUnaVez(old,{...options(first),fabrica:original=>{
        assert.equal(original.dnsTimeout,5000);assert.equal(original.connectionTimeout,5000);
        return {async sendMail(){throw Object.assign(Error('dato privado simulado'),{code:'EDNS',originalCode:'ETIMEOUT',command:'CONN'});},close(){}};
    }});
    const previous=fs.readdirSync(old).filter(n=>fs.statSync(path.join(old,n)).isFile());
    const hashes=Object.fromEntries(previous.map(n=>[n,lab.sha(fs.readFileSync(path.join(old,n)))]));
    const next=await prepare('web5b','WEB-5B'),directory=path.join(parent,'web5b');
    assert.equal(next.etapa,'WEB-5B');assert.notEqual(next.folio,first.folio);assert.notEqual(next.prueba,first.prueba);
    assert.deepEqual(await lab.simular(directory),next);
    const simulation=lab.json(directory,'diagnostico-simulado.json');
    assert.equal(simulation.limites_ms.dns,10000);assert.equal(simulation.limites_ms.conexion,15000);assert.equal(simulation.aceptacion_smtp,true);
    assert.equal(fs.existsSync(path.join(directory,'intento-reservado.json')),false);
    let calls=0;
    const fabrica=actual=>{
        assert.equal(actual.dnsTimeout,10000);assert.equal(actual.connectionTimeout,15000);assert.equal(actual.requireTLS,true);
        const stream=nodemailer.createTransport({streamTransport:true,buffer:true});
        return {async sendMail(message){calls++;const info=await stream.sendMail(message);return {accepted:info.envelope.to,rejected:[],messageId:info.messageId,response:'250 queued as simulacion-web5b'};},close(){stream.close();}};
    };
    const result=await lab.enviarUnaVez(directory,{...options(next),fabrica});
    assert.equal(result.estado,'aceptado');assert.equal(result.intentos,1);assert.equal(result.diagnostico.aceptacion_smtp,true);
    assert.equal(result.diagnostico.limites_ms.operacion,25000);assert.equal(result.diagnostico.node,process.version);
    await assert.rejects(lab.enviarUnaVez(directory,{...options(next),fabrica}));assert.equal(calls,1);
    for(const [n,digest] of Object.entries(hashes)) assert.equal(lab.sha(fs.readFileSync(path.join(old,n))),digest);
    const failure=lab.json(old,'resultado.json');assert.equal(failure.intentos,1);assert.equal(failure.codigo_error,'EDNS');
    assert.equal(failure.diagnostico.codigo_original,'ETIMEOUT');assert.equal(failure.diagnostico.comando,'CONN');
});
