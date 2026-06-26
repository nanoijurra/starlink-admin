# Starlink Admin ACC Cordoba

App web simple para administrar pagos compartidos del servicio Starlink, personas, pagos, mensajes de cobro, MACs y gestion manual del router.

Usa HTML, CSS y JavaScript vanilla con Supabase como base de datos online y autenticacion. No usa backend propio, React, Vite ni Node obligatorio para operar.

## Alcance v1

La version funcional actual incluye:

- Gestion de personas.
- Fundadores y usuarios posteriores.
- Calculo mensual.
- Compra inicial del equipo.
- Abono mensual.
- Regularizacion proporcional.
- Saldo a favor / compensacion.
- Registro de pagos.
- Mensajes de cobro.
- Alias bancario.
- WhatsApp manual asistido.
- MAC 1 / MAC 2.
- Gestion manual del router/MAC.
- Roles `ADMIN`, `LECTURA` y `USUARIO`.

Aclaraciones importantes:

- La app no envia WhatsApp automaticamente.
- La app no configura el router automaticamente.
- La app no maneja dinero real: solo registra pagos informados.
- La app no usa backend propio: usa Supabase.

## Estructura del proyecto

- `index.html`: estructura principal de la app y pantallas.
- `css/`: estilos visuales.
- `js/`: logica de UI, calculos, pagos, mensajes, autenticacion y conexion Supabase.
- `sql/`: schema, RLS, seed y migraciones.
- `tests/`: pruebas manuales ejecutables desde navegador.
- `docs/`: documentacion operativa y changelog.

## Documentacion operativa

- [`docs/operacion_mensual.md`](docs/operacion_mensual.md): flujo mensual recomendado, roles, comprobantes, pagos, router/MAC, exportaciones y cierre operativo.
- [`docs/changelog.md`](docs/changelog.md): resumen de cambios funcionales relevantes.

## Configuracion Supabase

La app usa Supabase Auth para iniciar sesion y tablas publicas protegidas por RLS.

Tablas principales:

- `profiles`: perfil interno del usuario autenticado, rol y estado activo.
- `personas`: participantes, estado, fundador, contacto, MACs y estado manual del router.
- `pagos`: pagos informados por persona, mes y concepto.
- `cierres_mensuales`: cierres mensuales.
- `cargos_mensuales`: cargos calculados y persistidos por mes.
- `app_config`: configuracion operativa.
- `audit_log`: auditoria.

RLS esta activo. Los usuarios deben estar autenticados y tener profile activo.

Roles:

- `ADMIN`: puede operar y modificar datos segun las politicas RLS.
- `LECTURA`: puede consultar, pero no deberia modificar datos.
- `USUARIO`: puede ver solo su propia cuenta cuando esta vinculado a una persona.

Nunca usar `service_role` en el frontend. `js/supabaseClient.js` debe usar solo la URL del proyecto y la publishable/anon key publica.

## Migraciones SQL

Ejecutar en Supabase SQL Editor en este orden:

1. `sql/001_schema.sql`
2. `sql/002_rls.sql`
3. `sql/003_seed_config.sql`
4. `sql/004_migracion_alias_bancario.sql`
5. `sql/004_migracion_componentes_cargos.sql`
6. `sql/005_migracion_contacto_mac.sql`
7. `sql/006_migracion_estado_router.sql`
8. `sql/007_migracion_usuarios_personas.sql`
9. `sql/008_migracion_comprobantes_pago.sql`

Nota: hay dos migraciones con numeracion `004`. Es una numeracion repetida; no impide ejecutar la base si se corren ambas antes de `005` y `006`.

## Uso local

Desde una terminal:

```cmd
cd C:\PROYECTO\starlink-admin
py -m http.server 8000
```

Si `py` no funciona:

```cmd
python -m http.server 8000
```

Abrir:

```text
http://localhost:8000
```

## Publicacion GitHub Pages

- Subir los cambios con git.
- Configurar GitHub Pages para publicar desde `main` y la carpeta raiz del repositorio.
- Abrir la URL publica de GitHub Pages.
- Si no se ven cambios, hacer `Ctrl+F5` para forzar recarga del navegador.

## Flujo operativo mensual

1. Revisar personas activas.
2. Calcular el mes.
3. Revisar total a pagar y componentes del cargo.
4. Generar mensajes de cobro.
5. Enviar WhatsApp manualmente desde el enlace precargado.
6. Registrar pagos informados.
7. Revisar Gestion router / MAC.
8. Marcar `HABILITADO` o `BLOQUEADO` segun la accion real hecha en el router.

## Panel mensual

`Panel mensual` es una vista operativa para `ADMIN` y `LECTURA`. Usa el mes seleccionado y resume comprobantes pendientes, personas al dia, personas con deuda, pagos parciales, saldo a favor, alertas de router y personas sin MAC.

El panel no registra pagos, no modifica comprobantes y no cambia el router. Solo muestra indicadores, listas de acciones sugeridas y accesos internos a las secciones existentes.

## Exportacion

La seccion `Exportacion` contiene solo descargas CSV. Ademas de exportaciones generales de personas, pagos y cargos, permite generar un backup operativo mensual con una fila por persona activa, pagos del mes y comprobantes del mes. Estas exportaciones son solo lectura y usan el mes seleccionado en la seccion.

## Checklist de cierre mensual

`Cierre mensual` es una guia operativa de solo lectura para `ADMIN` y `LECTURA`. No cierra el mes de forma irreversible, no bloquea modificaciones, no registra pagos, no cambia comprobantes y no cambia router.

Sirve para revisar comprobantes pendientes, pagos pendientes, pagos parciales, alertas de router, personas sin MAC, backup mensual y mensajes de cobro antes de considerar el mes cerrado operativamente.

## Paquete de cierre mensual ZIP

Desde `Cierre mensual`, `ADMIN` y `LECTURA` pueden generar `cierre_starlink_AAAA-MM.zip`.

El paquete descarga un unico ZIP con respaldos CSV del mes: backup mensual, pagos, comprobantes, estado de cuenta, router/MAC, deudores, comprobantes pendientes, saldo a favor y personas. No modifica datos, no registra pagos, no cambia comprobantes, no toca router y no cierra el mes automaticamente.

Puede generarse aunque existan deudores, comprobantes pendientes, pagos parciales o alertas router. Las exportaciones CSV individuales siguen disponibles en `Exportacion`.

La generacion del ZIP usa una libreria local en `js/vendor/jszip.min.js`; no usa CDN externo.

## Pagos

Conceptos reales guardados:

- `COMPRA_INICIAL`
- `ABONO`
- `REGULARIZACION`
- `AJUSTE`

La opcion `Pago completo del mes` es solo visual para facilitar la carga. No se guarda como concepto real: se descompone en los conceptos reales que correspondan segun el cargo mensual.

Si el pago informado supera el total del cargo mensual, el excedente se registra automaticamente como `AJUSTE` con observacion de pago excedente.

## Usuarios vinculados a personas

La app admite usuarios comunes con rol `USUARIO`.

- `ADMIN` gestiona usuarios, roles, estado activo y vinculacion con personas.
- `LECTURA` ve informacion general sin modificar datos.
- `USUARIO` ve solo su propia cuenta.

Los usuarios comunes se registran con email y password desde la pantalla de login. Al registrarse quedan como `USUARIO`, activos y sin persona vinculada.

El administrador debe vincular cada usuario con una persona existente en `personas`. Hasta estar vinculado, el usuario ve:

```text
Tu cuenta esta pendiente de vinculacion con una persona. Avisa al administrador.
```

Esta etapa no permite a usuarios comunes registrar pagos ni editar MAC/router. Los usuarios vinculados pueden subir comprobantes como pendientes de revision.

## Comprobantes pendientes

La app permite recibir comprobantes de pago sin crear pagos automaticamente.

Canales de carga:

- Desde `Mi cuenta`, un usuario `USUARIO` vinculado puede subir PDF/JPG/PNG/WebP, indicar mes, monto informado y observaciones.
- Desde Android, la PWA puede recibir un archivo compartido mediante Web Share Target y guardarlo como comprobante pendiente.

Cada comprobante se guarda en el bucket privado `comprobantes-pago` y en la tabla `comprobantes_pago` con estado inicial `PENDIENTE`.

Estados:

- `PENDIENTE`: enviado por el usuario y pendiente de revision.
- `PROCESADO`: revisado por `ADMIN` y vinculado a pagos reales registrados manualmente.
- `DESCARTADO`: descartado manualmente por `ADMIN`.

Roles:

- `USUARIO`: puede ver y subir solo sus propios comprobantes, si esta vinculado a una persona.
- `ADMIN`: puede ver todos los comprobantes y descartarlos.
- `LECTURA`: puede ver todos los comprobantes.

La accion `Registrar pago` queda indicada como proxima etapa. No se crea ningun pago automaticamente desde un comprobante.

Descartar un comprobante no borra el registro ni el archivo de Storage. Queda como trazabilidad. La bandeja principal muestra `PENDIENTE` por defecto; los comprobantes `DESCARTADO` pueden consultarse desde el filtro `Descartados` o desde `Todos`.

Desde la bandeja, `ADMIN` puede usar `Registrar pago` solo sobre comprobantes `PENDIENTE`. La app muestra persona, mes, monto, archivo, observaciones y pagos existentes del mismo mes para evitar duplicados. El administrador debe confirmar manualmente; recien entonces se registra como `Pago completo del mes`, se descompone en conceptos reales y el comprobante pasa a `PROCESADO` con los `pago_ids` asociados.

## Gestion router / MAC

`router_estado` es manual y representa lo que el administrador registro sobre el estado real en el router.

Opciones:

- `HABILITADO`
- `BLOQUEADO`

Prioridad de revision:

1. Pago y esta bloqueado.
2. No pago y esta habilitado.
3. Pago pero falta MAC.
4. Pago y esta habilitado.
5. No pago y ya esta bloqueado.

La app no toca el router automaticamente. Solo ayuda a priorizar acciones y registrar el estado manual.

## WhatsApp

La app usa enlaces `wa.me` para abrir WhatsApp con el mensaje de cobro precargado.

El usuario debe revisar el texto y tocar Enviar dentro de WhatsApp. No se envia automaticamente.

Los telefonos deben cargarse en formato internacional, sin simbolos. Ejemplo para Argentina Cordoba:

```text
5493511234567
```

## Recibir comprobantes desde Android

La app puede recibir comprobantes compartidos desde Android usando Web Share Target.

Requisitos:

- La app debe estar publicada por HTTPS, por ejemplo en GitHub Pages.
- Hay que instalar la PWA en Android desde el navegador compatible.
- Luego se puede compartir un PDF/JPG/PNG/WebP desde el celular hacia `Starlink ACC`.

Flujo esperado:

1. Abrir un comprobante en banco, galeria o archivos.
2. Tocar Compartir.
3. Elegir `Starlink ACC`.
4. La app abre `share-target.html`.
5. La pantalla exige sesion iniciada y usuario vinculado a una persona.
6. La pantalla muestra nombre, tipo, tamano y fecha de recepcion.
7. Completar mes, monto informado y observaciones si corresponde.
8. Tocar `Enviar comprobante`.
9. El comprobante queda `PENDIENTE` para revision administrativa.

Este flujo no registra pagos automaticamente.

## Instalacion PWA en Android

Para que Chrome Android ofrezca instalar la app:

1. Publicar la app por HTTPS en GitHub Pages.
2. Abrir la URL publica desde Chrome Android.
3. Usar menu de Chrome -> Instalar app o Agregar a pantalla principal.
4. Instalar la PWA.
5. Despues de instalar, probar compartir un comprobante hacia `Starlink ACC`.

Si no aparece la opcion de instalar, revisar:

- `manifest.webmanifest` valido.
- `service-worker.js` registrado sin errores.
- Iconos PNG `192x192` y `512x512`.
- Rutas relativas, por ejemplo `./manifest.webmanifest`, `./service-worker.js` y `./icons/icon-192.png`.
- Publicacion por HTTPS.
- Cache limpia o PWA previa desinstalada.

Para limpiar una prueba anterior en Android:

1. Desinstalar la PWA desde el icono o desde ajustes de Chrome.
2. En Chrome, borrar cache del sitio publicado.
3. Volver a abrir la URL publica.
4. Esperar unos segundos y volver a intentar Instalar app.

## Pruebas manuales

Levantar servidor local desde la carpeta del proyecto:

```cmd
py -m http.server 8000
```

Abrir:

```text
http://localhost:8000/tests/test_manual_calculos.html
```

Resultado esperado:

- Debe mostrar `PRUEBA OK`.
- Valida metodo rapido, redondeo y suma de cargos.

Abrir:

```text
http://localhost:8000/tests/test_manual_pagos.html
```

Resultado esperado:

- Debe mostrar `PRUEBA OK`.
- Valida pago mixto, pago parcial, cargo sin regularizacion y rechazo de pago excedente.

Estas pruebas deben ejecutarse despues de modificar `js/calculos.js`, `js/pagos.js`, `js/utils.js` o la logica de cierre/pagos en `js/app.js`.

## Seguridad

- No subir ni copiar `service_role` al frontend.
- El frontend debe usar solo publishable/anon key.
- La seguridad de datos se apoya en RLS.
- Usuarios anonimos no deben tener acceso.
- Usuarios con rol `LECTURA` no deberian modificar datos.
- Para desactivar usuarios o personas se usan estados o campos de estado, no borrado fisico operativo.

## Estado v1 funcional

v1 funcional validada:

- Calculo mensual validado.
- Pagos validados.
- Mensajes validados.
- WhatsApp manual asistido validado.
- Gestion router/MAC validada.
- Publicacion online validada.
