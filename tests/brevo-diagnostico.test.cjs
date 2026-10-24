const { test } = require('node:test');
const assert = require('node:assert/strict');
const { opcionesPrueba, observarTransporte } = require('../api/scripts/brevo-diagnostico.cjs');
const base = { dnsTimeout:5000, connectionTimeout:5000, greetingTimeout:5000, socketTimeout:15000,
    requireTLS:true, secure:false, tls:{rejectUnauthorized:true,minVersion:'TLSv1.2'}, logger:false, debug:false };

test('Diagnóstico SMTP: plazos locales moderados conservan límites, TLS y configuración original', () => {
    const updated=opcionesPrueba(base,'WEB-5B');
    assert.equal(updated.dnsTimeout,10000);assert.equal(updated.connectionTimeout,15000);
    assert.equal(updated.greetingTimeout,5000);assert.equal(updated.socketTimeout,15000);
    assert.equal(updated.requireTLS,true);assert.equal(updated.tls.rejectUnauthorized,true);
    assert.equal(updated.tls.minVersion,'TLSv1.2');assert.equal(updated.logger,false);assert.equal(updated.debug,false);
    assert.equal(base.dnsTimeout,5000);assert.equal(base.connectionTimeout,5000);
    assert.equal(opcionesPrueba(base),base);
    assert.throws(()=>opcionesPrueba(base,'production'));
});

test('Diagnóstico SMTP: EDNS preserva código original, comando y duración sin mensajes ni datos privados', async () => {
    const privateValue='secreto-simulado-no-real';const saved=[];
    const error=Object.assign(Error(privateValue),{code:'EDNS',originalCode:'ETIMEOUT',command:'CONN',response:privateValue,stack:privateValue});
    const observed=observarTransporte({async sendMail(){throw error;},close(){}},base,'cliente@example.test',()=>{},value=>saved.push(JSON.stringify(value)));
    await assert.rejects(observed.transporte.sendMail({}),error);
    const diag=observed.diagnostico;
    assert.equal(diag.codigo_error,'EDNS');assert.equal(diag.codigo_original,'ETIMEOUT');assert.equal(diag.comando,'CONN');
    assert.equal(diag.estado,'error');assert.equal(diag.aceptacion_smtp,null);assert.equal(diag.respuesta_smtp,null);
    assert.ok(Number.isInteger(diag.duracion_ms)&&diag.duracion_ms>=0);
    assert.equal(diag.node,process.version);assert.match(diag.nodemailer,/^\d+\.\d+\.\d+$/);
    assert.equal(diag.limites_ms.operacion,25000);
    assert.equal(saved.length,2);assert.ok(saved.every(value=>!value.includes(privateValue)));
});

test('Diagnóstico SMTP: valores arbitrarios del error no se guardan como código, comando ni respuesta', async () => {
    const secret='credencial-simulada';
    const error=Object.assign(Error(secret),{code:secret,originalCode:secret,command:'AUTH PLAIN '+secret,responseCode:secret,response:secret});
    const observed=observarTransporte({async sendMail(){throw error;},close(){}},base,'cliente@example.test',()=>{},()=>{});
    await assert.rejects(observed.transporte.sendMail({}));
    assert.equal(observed.diagnostico.codigo_error,'OTRO');assert.equal(observed.diagnostico.codigo_original,'OTRO');
    assert.equal(observed.diagnostico.comando,'OTRO');assert.equal(observed.diagnostico.respuesta_smtp,null);
    assert.equal(JSON.stringify(observed.diagnostico).includes(secret),false);
});

test('Diagnóstico SMTP: aceptación SMTP saneada y validación previa impiden destinatarios arbitrarios', async () => {
    let calls=0;
    const observed=observarTransporte({async sendMail(){calls++;return {accepted:['cliente@example.test'],rejected:[],response:'250 respuesta privada no persistida'};},close(){}},
        base,'cliente@example.test',message=>assert.equal(message.to,'cliente@example.test'),()=>{});
    await assert.rejects(observed.transporte.sendMail({to:'otro@example.test'}));assert.equal(calls,0);
    await observed.transporte.sendMail({to:'cliente@example.test'});assert.equal(calls,1);
    assert.equal(observed.diagnostico.aceptacion_smtp,true);assert.equal(observed.diagnostico.respuesta_smtp,250);
    assert.equal(JSON.stringify(observed.diagnostico).includes('privada'),false);
});
