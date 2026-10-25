# GAONA
Pagina GAONA puertas y ventanas | Proyecto Integrador

## Web con Supabase Auth y Data API

Todos los integrantes utilizan la misma base GAONA (`kvuvetijtldpamrfslsg`). La instalación habitual requiere **Node.js 24 y npm**, sin PostgreSQL local, Docker, Electron, Python ni tmux. El backend Express utiliza HTTPS, una clave publicable y la cuenta técnica autorizada de Supabase Auth. El navegador solo conoce la URL de Express.

La instalación SQL y la actualización SMTP **ya fueron aplicadas y probadas en Supabase con autorización del equipo**, según su confirmación. No deben ejecutarse nuevamente sobre la base GAONA configurada. Los integrantes solo instalan las dependencias y completan su configuración privada; npm no ejecuta SQL ni migraciones.

### Instalación y configuración privada

Desde la raíz:

```sh
npm run web:instalar
npm run web:configurar
```

`web:instalar` ejecuta `npm ci` en `api` y genera Prisma para los módulos existentes; no conecta bases ni ejecuta migraciones. No hace falta instalar las dependencias de la raíz ni Electron. `web:configurar` crea `api/.env` con permisos 600 y rechaza sobrescribir un archivo existente.

Edita personalmente `api/.env` en tu equipo, por ejemplo con `nano api/.env`. Introduce allí la clave publicable oficial y la contraseña de **Supabase Auth**, no la contraseña SMTP ni una conexión administrativa. No las pegues en chats ni las pases como argumentos a comandos. Mantén ese archivo fuera de Git; usa comillas si los valores contienen espacios o `#`.

Variables efectivamente utilizadas:

- `SOLICITUD_STORAGE=data-api` y `SUPABASE_URL=https://kvuvetijtldpamrfslsg.supabase.co`.
- `SUPABASE_PUBLISHABLE_KEY`: clave oficial publicable `sb_publishable_...` (también admite una clave legacy cuyo JWT tenga exclusivamente rol `anon` y el proyecto correcto). Rechaza `sb_secret_...` y `service_role`.
- `SUPABASE_AUTH_EMAIL=gaona.proyint1@gmail.com`, `SUPABASE_AUTH_PASSWORD` y `SUPABASE_AUTH_UID`: identidad técnica autorizada. Utiliza el UID verificado de esa cuenta, entregado por el responsable de la instalación.
- `SOLICITUD_IDEMPOTENCY_KEY` y `SOLICITUD_PDF_KEY`: las dos claves estables del backend compartido, hexadecimales de 64 caracteres y coincidentes con las huellas de la instalación SQL. No se deben regenerar por integrante.
- `WEB_HOST=127.0.0.1`, `WEB_PORT=3000`, `NODE_ENV=development`.
- `MAIL_ENABLED=false`, `WHATSAPP_ENABLED=false`. Este supervisor conserva correo simulado aunque alguien cambie el primer valor a `true`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`: preparación opcional de Brevo. No se utilizan para un transporte SMTP real en este arranque.

Únicamente para un proyecto nuevo e independiente, el responsable de la primera instalación genera las claves compartidas una vez. No ejecutar esta generación para incorporarse a la base GAONA ya configurada:

```sh
npm run web:claves
npm run web:parametros
```

`web:claves` guarda las claves en el `.env` privado sin mostrarlas ni reemplazar claves existentes. Los demás integrantes reciben esas mismas claves por un canal seguro y no ejecutan una generación independiente. `web:parametros` muestra únicamente el UID y las huellas SHA-256 necesarias para revisar el SQL; no imprime la clave publicable, contraseñas, sesiones o claves criptográficas originales. Conserva las claves en un respaldo privado: cambiarlas invalida la comprobación de persistencia y el acceso PDF.

`DATABASE_URL`, `DIRECT_URL` y `WEB_DATABASE_URL` no son necesarios para este modo. No se utilizan como respaldo. El modo Prisma anterior permanece disponible únicamente si se configura explícitamente `SOLICITUD_STORAGE=postgres`, `WEB_DATABASE_URL`, `WEB_DATABASE_ROLE` y su TLS estricto; no crea permisos ni usa identidades administrativas automáticamente.

### SQL instalado y referencia para nuevas instalaciones

Los siguientes archivos de `api/propuestas/data-api/` documentan la instalación ya aplicada. No repetirla en GAONA. Una instalación en otro proyecto o cualquier cambio futuro requiere revisión y autorización explícita:

1. `00-preflight.sql`: consultas de metadatos en una transacción de solo lectura.
2. `instalacion.sql`: transacción única que recibe `backend_uid`, `idempotencia_huella` y `acceso_huella`, comprueba una cuenta Auth activa y confirmada e incluye los tres archivos siguientes. No ejecutar hasta obtener aprobación explícita.
3. `01-tablas.sql`: crea exclusivamente `public.gaona_web_configuracion`, `gaona_web_registros`, `gaona_web_documentos` y `gaona_web_correos`, con índices, restricciones SHA-256 y claves foráneas **solo entre tablas nuevas**. No altera columnas, relaciones ni restricciones compartidas. Rechaza objetos previos, políticas compartidas no revisadas o DDL disponible para la identidad de Data API.
4. `02-permisos-rls.sql`: retira las concesiones automáticas exclusivamente de las cuatro tablas nuevas a `PUBLIC`, `anon`, `authenticated` y `service_role`. Solo permite SELECT de la configuración, protegido por el UID técnico; cotizaciones, PDF y correos no tienen acceso directo. Habilita y fuerza RLS en las cuatro tablas nuevas y añade únicamente dos políticas SELECT para el catálogo. Crea el esquema interno con USAGE para authenticated y sin CREATE para las identidades públicas. Conserva sin cambios todas las ACL y políticas administrativas existentes; si aparecen políticas compartidas no revisadas o faltan privilegios de lectura del catálogo, el preflight bloquea la instalación.
5. `03-rpc.sql` incluye `rpc-operacion.sql` y conserva `public.gaona_web_operacion(text,jsonb)` como entrada `SECURITY INVOKER` y define la función interna `gaona_web_interno.operacion(text,jsonb)` `SECURITY DEFINER`. Esta ejecuta con el propietario instalador existente, requiere rol `authenticated` y UID técnico y no depende de RLS para autorizar las operaciones elevadas. Ambas funciones tienen `search_path=pg_catalog,pg_temp`, referencias calificadas, acciones cerradas y ningún SQL dinámico; EXECUTE se limita a `authenticated`, sin DML directo ni CREATE en el esquema interno. El instalador exige un propietario de confianza independiente, con BYPASSRLS o superusuario, sin crear ni modificar roles. El backend sigue utilizando exclusivamente Auth y la clave publicable; nunca la identidad instaladora. El esquema y la función interna forman parte de la instalación autorizada; cambios futuros requieren aprobación específica.
6. `04-verificacion.sql`: verifica los objetos, políticas, claves foráneas y permisos mediante SELECT.

No hay CREATE/ALTER/DROP ROLE, cambios de membresía, cambios de privilegios predeterminados globales, nuevas políticas para PUBLIC/anon ni UPDATE/DELETE de datos administrativos. El instalador comprueba los controles mediante el rol `authenticated` antes de COMMIT. Solo inserta una fila inicial en la nueva configuración y emite `NOTIFY pgrst, 'reload schema'` para refrescar la caché de Data API al confirmar la transacción; no registra cotizaciones de prueba en producción.

**Operaciones posteriores del formulario:** la RPC inserta una nueva solicitud de origen WEB, un cliente nuevo y sus detalles, junto con la reserva de idempotencia, documento y correo, dentro de la misma transacción. Estas inserciones en `clientes`, `solicitudes` y `solicitud_detalles` forman parte del flujo funcional autorizado. No actualiza, reutiliza ni elimina registros administrativos existentes y no permite asignar empleados. Conserva el flujo de GAONA sin cambiar el backend administrativo. El historial privado permanece aunque el administrador elimine posteriormente el cliente y la solicitud por su procedimiento habitual.

El técnico que instale el SQL necesita una conexión autorizada para instalación, con TLS estricto y CA oficial. Esa identidad de instalación no se utiliza en Express. No pases cadenas de conexión con contraseña como argumentos de procesos: utiliza el mecanismo privado de conexión del equipo. Los parámetros del instalador son UID y huellas, nunca contraseñas o claves sin hash.

### Arranque, estado y parada

Con la base compartida ya configurada, después de completar las credenciales privadas:

```sh
npm run web:verificar
npm run web:iniciar
npm run web:estado
npm run web:detener
npm run web:reiniciar
```

El backend inicia sesión exclusivamente contra el Auth del proyecto GAONA. Las sesiones y refresh tokens permanecen en memoria del backend, con renovación anticipada y una única renovación concurrente. No se devuelven al navegador, no se escriben en archivos y no se registran. Una respuesta incierta o un 401 no repite automáticamente una escritura: la solicitud conserva su clave para recuperar el mismo folio.

`web:verificar` comprueba identidad, instalación, RLS y huellas mediante la acción de verificación, y consulta el catálogo público. No registra cotizaciones ni ejecuta SQL de instalación. Iniciar sesión puede crear/renovar una sesión de Supabase Auth; no equivale a ejecutar una migración o registrar solicitudes. Si faltan credenciales, permisos o SQL, el arranque se cierra con un diagnóstico saneado.

Direcciones predeterminadas: `http://127.0.0.1:5500/Catalogo.html`, `http://127.0.0.1:5500/cotizacion.html` y `http://127.0.0.1:3000/salud`. Cambia `WEB_PORT` en `.env` y, opcionalmente, copia `api/desarrollo-compartido.example` a `api/desarrollo-compartido.json` para cambiar `frontendPort`. El frontend recibe dinámicamente solo la dirección de la API en `config.js`.

El supervisor permanece en segundo plano y solo administra los procesos de esta carpeta mediante control local autenticado. Rechaza puertos ocupados sin detener servidores ajenos. No instala servicios permanentes ni crea bases locales. El estado de control y los MIME simulados quedan fuera de Git, bajo `~/.gaona-web-compartida/<identificador>`.

### Persistencia, PDF y correo

Se reutilizan la validación de la API, los cálculos decimales, PDFKit, los tokens de descarga y el servicio Nodemailer existentes. El catálogo consulta productos activos de tipo PRODUCTO con los campos públicos y el orden original. No se publican productos de ensayo.

Una única llamada RPC realiza cada operación atómica. La clave HMAC única, la comparación del contenido, las cuotas persistentes y el bloqueo transaccional evitan duplicados concurrentes. Un fallo revierte cliente, solicitud, detalles y reservas completos. La RPC vuelve a comprobar precios y totales con el catálogo compartido. Los PDF usan reservas limitadas, bytes canónicos y SHA-256 comprobado en SQL y Node.

El arranque predeterminado usa Stream Transport y un máximo de un intento simulado por solicitud. El destinatario proviene del comprobante persistido y no puede cambiarse mediante UPDATE. La API presenta `modo=simulado`; aceptación SMTP y entrega real no se afirman. El modo simulado queda registrado en la base compartida, de modo que reiniciar o utilizar otro backend no duplica el transporte. La capacidad de Brevo está instalada y validada según la confirmación del equipo, pero permanece desactivada en el arranque predeterminado; cada ensayo real exige activación explícita. WhatsApp permanece desactivado.

### Respaldo y recuperación

Referencia para instalaciones nuevas o cambios futuros autorizados; no repetir la instalación actual.

Antes de instalar: conservar preflight, ACL/políticas actuales de las cinco tablas compartidas y un respaldo verificado del proyecto mediante el procedimiento autorizado del equipo. No guardar respaldos en Git. La instalación es transaccional: ante cualquier error anterior al COMMIT, ROLLBACK deja todo sin aplicar.

Después de instalar: ejecutar `04-verificacion.sql`, verificar el backend y recién entonces autorizar una solicitud remota identificada como prueba. Mantener copia privada de las claves y un respaldo que incluya tablas nuevas, función, índices, políticas y permisos. Los ensayos restauran una base ficticia completa en otra base aislada y comparan las huellas de los PDF.

Ante un fallo después del COMMIT: detener la API web, conservar tablas, registros y respaldos, y revisar el diagnóstico. No ejecutar DROP, TRUNCATE ni borrar cotizaciones para repetir una prueba. La recuperación de ACL/políticas debe usar los valores respaldados y una aprobación específica; no conceder permisos generales como arreglo. Restaurar primero en una base aislada, verificar integridad e idempotencia y decidir con el equipo antes de cualquier restauración remota.

### Pruebas opcionales aisladas

Los integrantes no necesitan PostgreSQL para usar la web. Solo quien ejecute el laboratorio necesita PostgreSQL 17 y sus herramientas, incluida la extensión btree_gist:

```sh
npm --prefix api run typecheck
npm --prefix api exec -- playwright install chromium
npm --prefix api run test:persistencia -- --supabase-audit
npm --prefix api run test:instalacion
```

El ensayo Data API utiliza Auth y HTTP simulados sobre PostgreSQL real aislado; prueba SQL, RLS, concurrencia, renovación, errores, formulario Chromium, PDF, MIME y restauración, sin usar la cuenta técnica real ni enviar correos. Estos ensayos aportan evidencia aislada; la validación remota indicada arriba corresponde a la confirmación del equipo. El laboratorio manual opcional permanece bajo `lab:*`, separado de `web:*`, con datos ficticios exclusivamente de prueba.

### Ensayo SMTP independiente

El arranque `web:iniciar` conserva siempre el correo simulado, aunque `.env` contenga credenciales SMTP. Para preparar un PDF y MIME ficticios sin acceso a Supabase ni conexiones SMTP:

```sh
nvm use 24
npm run web:smtp:simular
```

Después de autorizar expresamente una prueba real, `npm run web:smtp:prueba` solicita en una terminal privada el único destinatario autorizado, presenta remitente, folio, asunto, PDF e importe, y exige escribir `AUTORIZO UN ENVIO SMTP` seguido del identificador mostrado. Lee las credenciales exclusivamente del `.env` privado; no las pide en argumentos ni las registra. Reutiliza Nodemailer, PDFKit y las plantillas existentes, con Brevo 587, STARTTLS obligatorio y certificados validados. No importa el cliente de base de datos ni llama a Supabase.

Los documentos, MIME, reserva y resultado quedan con permisos privados fuera del repositorio, en `~/.gaona-smtp-pruebas/`. Antes de llamar al transporte se reserva un único intento mediante creación exclusiva y fsync. Esa reserva no se elimina ante error, interrupción o resultado incierto; no hay reintentos automáticos. `web:smtp:enviar -- ID` recupera una preparación existente y exige de nuevo la confirmación; rechaza una prueba ya reservada. Aceptación SMTP no acredita entrega.

### Cotizaciones nuevas con el PDF persistido y Brevo

La actualización `api/propuestas/data-api/05-correo-real.sql`, que incluye `rpc-operacion.sql`, ya fue autorizada, aplicada y probada en GAONA según la confirmación del equipo. No ejecutarla nuevamente en la base compartida configurada. El cambio modifica únicamente el CHECK de modo en la tabla privada `gaona_web_correos` y redefine únicamente la función interna existente con soporte de ambos modos, conservando su propietario y ACL; no actualiza filas, no cambia roles, políticas ni tablas administrativas. Solo en otra instalación que aún requiera esta actualización, y previa autorización explícita, se utiliza psql con `-X -v ON_ERROR_STOP=1 -f api/propuestas/data-api/05-correo-real.sql` y conexión privada con TLS estricto y CA oficial, nunca una contraseña en argumentos. Para ese procedimiento se requiere respaldo privado verificable del esquema, funciones y datos web; ante un fallo antes del COMMIT la transacción revierte íntegramente. Después del COMMIT, desactivar SMTP y conservar los registros y la RPC v2; no restaurar la función anterior sobre correos SMTP ni estrechar el CHECK si existen filas SMTP ni modificar su modo para revertir. La instalación nueva incorpora ya el mismo contrato, sin ejecutar automáticamente SQL desde npm.

Con la actualización ya instalada en la base compartida, `npm run web:verificar` comprueba la persistencia sin registrar cotizaciones. La activación local explícita es:

```sh
nvm use 24
npm run web:iniciar
npm run web:smtp
```

`web:smtp` comprueba la versión de la RPC antes de detener el entorno propio. Solicita un único destinatario autorizado para la sesión y exige `ACTIVAR BREVO PARA COTIZACIONES NUEVAS`. Mantener esa terminal abierta y crear una cotización NUEVA en `http://127.0.0.1:5500/cotizacion.html`, con ese mismo correo. El catálogo, precios, cantidades, IVA y totales proceden del flujo habitual; SMTP recibe exactamente los bytes del PDF canónico guardado en Supabase, también utilizados por la descarga protegida. La herramienta de PDF ficticio permanece aislada y no interviene en este flujo.

Cada correo guarda su modo al registrar la cotización y no permite cambiar su destinatario. La reserva, el SHA-256 y el único intento se verifican en la RPC. Repetir una solicitud, cambiar de modo o reiniciar no provoca reenvíos SMTP; una solicitud simulada conserva su historial. Los resultados inciertos permanecen `no_confirmado`, sin reintentos, y `aceptado` solo acredita aceptación SMTP.

Ctrl+C, cierre normal o el límite de 15 minutos detienen la sesión y restauran el entorno simulado. `npm run web:estado` informa `smtp_real`; `npm run web:detener` también cierra el supervisor propio. El puerto API permanece en 127.0.0.1:3000 y los POST reales exigen el Origin del frontend 127.0.0.1:5500. La lista temporal de ensayo no es una lista fija de clientes. No habilita correo en producción. El envío general requerirá una activación de despliegue autorizada y conservar estos controles; ninguna variable del navegador configura SMTP.

Los SQL heredados de `api/propuestas/web/`, `whatsapp-cloud.sql`, `correo-smtp.sql` y `persistencia-*.sql` se conservan para las pruebas y laboratorios opcionales. No son el procedimiento de instalación de Supabase Auth/Data API y no deben aplicarse a la base compartida como alternativa. La instalación compartida utiliza exclusivamente los archivos revisados de `api/propuestas/data-api/`.
