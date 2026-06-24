# Starlink Admin ACC Córdoba

App web simple para administrar pagos compartidos del servicio Starlink, personas, pagos, mensajes de cobro, MACs y gestión manual del router.

Usa HTML, CSS y JavaScript vanilla con Supabase como base de datos online y autenticación. No usa backend propio, React, Vite ni Node obligatorio para operar.

## Alcance v1

La versión funcional actual incluye:

- Gestión de personas.
- Fundadores y usuarios posteriores.
- Cálculo mensual.
- Compra inicial del equipo.
- Abono mensual.
- Regularización proporcional.
- Saldo a favor / compensación.
- Registro de pagos.
- Mensajes de cobro.
- Alias bancario.
- WhatsApp manual asistido.
- MAC 1 / MAC 2.
- Gestión manual del router/MAC.
- Roles `ADMIN` y `LECTURA`.

Aclaraciones importantes:

- La app no envía WhatsApp automáticamente.
- La app no configura el router automáticamente.
- La app no maneja dinero real: solo registra pagos informados.
- La app no usa backend propio: usa Supabase.

## Estructura del proyecto

- `index.html`: estructura principal de la app y pantallas.
- `css/`: estilos visuales.
- `js/`: lógica de UI, cálculos, pagos, mensajes, autenticación y conexión Supabase.
- `sql/`: schema, RLS, seed y migraciones.
- `tests/`: pruebas manuales ejecutables desde navegador.

## Configuración Supabase

La app usa Supabase Auth para iniciar sesión y tablas públicas protegidas por RLS.

Tablas principales:

- `profiles`: perfil interno del usuario autenticado, rol y estado activo.
- `personas`: participantes, estado, fundador, contacto, MACs y estado manual del router.
- `pagos`: pagos informados por persona, mes y concepto.
- `cierres_mensuales`: cierres mensuales.
- `cargos_mensuales`: cargos calculados y persistidos por mes.
- `app_config`: configuración operativa.
- `audit_log`: auditoría.

RLS está activo. Los usuarios deben estar autenticados y tener profile activo.

Roles:

- `ADMIN`: puede operar y modificar datos según las políticas RLS.
- `LECTURA`: puede consultar, pero no debería modificar datos.

Nunca usar `service_role` en el frontend. `js/supabaseClient.js` debe usar solo la URL del proyecto y la publishable/anon key pública.

## Migraciones SQL

Ejecutar en Supabase SQL Editor en este orden:

1. `sql/001_schema.sql`
2. `sql/002_rls.sql`
3. `sql/003_seed_config.sql`
4. `sql/004_migracion_alias_bancario.sql`
5. `sql/004_migracion_componentes_cargos.sql`
6. `sql/005_migracion_contacto_mac.sql`
7. `sql/006_migracion_estado_router.sql`

Nota: hay dos migraciones con numeración `004`. Es una numeración repetida; no impide ejecutar la base si se corren ambas antes de `005` y `006`.

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

## Publicación GitHub Pages

- Subir los cambios con git.
- Configurar GitHub Pages para publicar desde `main` y la carpeta raíz del repositorio.
- Abrir la URL pública de GitHub Pages.
- Si no se ven cambios, hacer `Ctrl+F5` para forzar recarga del navegador.

## Flujo operativo mensual

1. Revisar personas activas.
2. Calcular el mes.
3. Revisar total a pagar y componentes del cargo.
4. Generar mensajes de cobro.
5. Enviar WhatsApp manualmente desde el enlace precargado.
6. Registrar pagos informados.
7. Revisar Gestión router / MAC.
8. Marcar `HABILITADO` o `BLOQUEADO` según la acción real hecha en el router.

## Pagos

Conceptos reales guardados:

- `COMPRA_INICIAL`
- `ABONO`
- `REGULARIZACION`
- `AJUSTE`

La opción `Pago completo del mes` es solo visual para facilitar la carga. No se guarda como concepto real: se descompone en los conceptos reales que correspondan según el cargo mensual.

Si el pago informado supera el total del cargo mensual, el excedente se registra automáticamente como `AJUSTE` con observación de pago excedente.

## Gestión router / MAC

`router_estado` es manual y representa lo que el administrador registró sobre el estado real en el router.

Opciones:

- `HABILITADO`
- `BLOQUEADO`

Prioridad de revisión:

1. Pagó y está bloqueado.
2. No pagó y está habilitado.
3. Pagó pero falta MAC.
4. Pagó y está habilitado.
5. No pagó y ya está bloqueado.

La app no toca el router automáticamente. Solo ayuda a priorizar acciones y registrar el estado manual.

## WhatsApp

La app usa enlaces `wa.me` para abrir WhatsApp con el mensaje de cobro precargado.

El usuario debe revisar el texto y tocar Enviar dentro de WhatsApp. No se envía automáticamente.

Los teléfonos deben cargarse en formato internacional, sin símbolos. Ejemplo para Argentina Córdoba:

```text
5493511234567
```

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
- Valida método rápido, redondeo y suma de cargos.

Abrir:

```text
http://localhost:8000/tests/test_manual_pagos.html
```

Resultado esperado:

- Debe mostrar `PRUEBA OK`.
- Valida pago mixto, pago parcial, cargo sin regularización y rechazo de pago excedente.

Estas pruebas deben ejecutarse después de modificar `js/calculos.js`, `js/pagos.js`, `js/utils.js` o la lógica de cierre/pagos en `js/app.js`.

## Seguridad

- No subir ni copiar `service_role` al frontend.
- El frontend debe usar solo publishable/anon key.
- La seguridad de datos se apoya en RLS.
- Usuarios anónimos no deben tener acceso.
- Usuarios con rol `LECTURA` no deberían modificar datos.
- Para desactivar usuarios o personas se usan estados o campos de estado, no borrado físico operativo.

## Estado v1 funcional

v1 funcional validada:

- Cálculo mensual validado.
- Pagos validados.
- Mensajes validados.
- WhatsApp manual asistido validado.
- Gestión router/MAC validada.
- Publicación online validada.
