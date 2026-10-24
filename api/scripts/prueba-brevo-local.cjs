const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const web5b = process.argv[3] === '--web5b';
const directory = path.join(os.homedir(), '.local', 'state', web5b ? 'gaona-web5b' : 'gaona-web5');

async function main() {
    const mode = process.argv[2];
    if (!((process.argv.length === 3) || (process.argv.length === 4 && web5b)) ||
        (web5b && process.versions.node.split('.')[0] !== '24') || !['preparar','simular','resumen','estado','enviar'].includes(mode) ||
        (process.env.NODE_ENV && process.env.NODE_ENV !== 'development')) throw Error();
    const lab = require('./brevo-unico.cjs');
    if (mode === 'resumen') { console.log(JSON.stringify(lab.json(directory,'resumen.json'),null,2)); return; }
    if (mode === 'estado') {
        const fs = require('node:fs');
        const name = fs.existsSync(path.join(directory,'resultado.json')) ? 'resultado.json' :
            fs.existsSync(path.join(directory,'intento-reservado.json')) ? 'intento-reservado.json' : 'simulacion.json';
        console.log(JSON.stringify(lab.json(directory,name),null,2)); return;
    }
    if (mode === 'simular') { console.log(JSON.stringify(await lab.simular(directory),null,2)); return; }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error();
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try {
        if (mode === 'preparar') {
            require('node:fs').mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
            const from = (await terminal.question('Remitente verificado en Brevo: ')).trim();
            const to = (await terminal.question('Único destinatario controlado y autorizado: ')).trim();
            console.log(JSON.stringify(await lab.preparar(directory,from,to,web5b ? 'WEB-5B' : 'WEB-5'),null,2));
            console.log(`Simulación terminada sin SMTP externo. Laboratorio privado: ${directory}. Solicita autorización en el chat antes de enviar.`);
            return;
        }
        const preview = lab.json(directory,'resumen.json');
        if (require('node:fs').existsSync(path.join(directory,'intento-reservado.json'))) throw Error();
        console.log(JSON.stringify(preview,null,2));
        console.log('Ejecutar solamente después de autorización expresa en un mensaje separado. No habrá reintentos, incluso ante incertidumbre.');
        const confirmacion = await terminal.question(`Escribe AUTORIZO ${preview.folio} A ${preview.destinatario}: `);
        if (confirmacion !== `AUTORIZO ${preview.folio} A ${preview.destinatario}`) throw Error();
        terminal.close();
        const secret = spawnSync('python3', ['-c', 'import getpass,json,sys,warnings\nwarnings.simplefilter("error",getpass.GetPassWarning)\ntry:\n u=getpass.getpass("Usuario SMTP Brevo (sin eco): ")\n p=getpass.getpass("Clave SMTP Brevo (sin eco; no API key): ")\n print(json.dumps([u,p]))\nexcept BaseException:\n sys.exit(1)'],
            { env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin' }, stdio: ['inherit','pipe','inherit'], encoding: 'utf8', maxBuffer: 8192 });
        if (secret.status !== 0) throw Error();
        const [user,password] = JSON.parse(secret.stdout);
        secret.stdout = '';
        const result = await lab.enviarUnaVez(directory,{user,password,confirmacion,fabrica: options => require('nodemailer').createTransport(options)});
        console.log(JSON.stringify(result,null,2));
    } finally { terminal.close(); }
}
main().catch(() => { console.error('Prueba SMTP detenida. No muestres credenciales ni reintentes; conserva el laboratorio para revisar su estado.'); process.exitCode = 1; });
