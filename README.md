# GAONA

## Envío de cotizaciones por correo en PDF 2.0

Catálogo y cotizaciones web con Supabase Auth y Data API, documentos PDF protegidos y correo mediante Brevo SMTP. Se conservan los módulos administrativos y de escritorio del proyecto.

### Instalación web

Requisitos: Node.js 24, npm y la configuración privada autorizada del backend. Todos los integrantes utilizan la misma base de Supabase; no necesitan instalar PostgreSQL ni crear bases independientes.

```sh
nvm use 24
npm run web:instalar
npm run web:configurar
```

Completa personalmente `api/.env` a partir de la plantilla. No compartas credenciales en Git. Usa las mismas claves criptográficas estables aprobadas para la instalación compartida; no regenerarlas por integrante.

```sh
npm run web:verificar
npm run web:iniciar
npm run web:estado
```

Catálogo: http://127.0.0.1:5500/Catalogo.html. Formulario: http://127.0.0.1:5500/cotizacion.html. La API pública escucha en 127.0.0.1:3000 y excluye clientes y empleados administrativos. Para detener los servicios, ejecuta `npm run web:detener`.

El correo se simula por defecto. `npm run web:smtp` exige confirmación manual para un ensayo local con cotizaciones nuevas y el PDF persistido. No usar `web:smtp:prueba` para enviar una cotización de cliente: esa herramienta prepara un documento ficticio independiente.

Consulta la [guía de configuración, seguridad, SQL y pruebas](Página/README.md). La instalación SQL y la actualización SMTP ya fueron aplicadas y probadas en Supabase con autorización del equipo, según su confirmación. No deben ejecutarse nuevamente en la base compartida configurada. npm no ejecuta SQL ni migraciones; los archivos SQL se conservan como referencia para instalaciones nuevas y futuros cambios expresamente autorizados. El laboratorio `lab:*` es opcional y está separado del arranque habitual.

Las pruebas usan datos aislados y transporte SMTP simulado. La aceptación SMTP no confirma por sí sola la entrega del mensaje.
