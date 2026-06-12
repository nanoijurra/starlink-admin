# Starlink Admin ACC Cordoba

App web estatica para administrar el pago compartido de un servicio Starlink en un ambito laboral. Usa HTML, CSS y JavaScript vanilla, con Supabase como base de datos online y autenticacion.

## Alcance

- Acceso solo para administradores y usuarios de lectura creados en Supabase Auth.
- Roles:
  - `ADMIN`: puede leer, crear, editar y borrar.
  - `LECTURA`: puede ver y exportar, pero no modificar.
- No hay acceso individual para usuarios comunes.
- No usa React, Vite, backend propio ni Node obligatorio.
- No se guarda ninguna `service_role key` en el frontend.

## Instalacion

1. Crear un proyecto en Supabase.
2. En el SQL editor de Supabase, ejecutar en orden:
   - `sql/001_schema.sql`
   - `sql/002_rls.sql`
   - `sql/003_seed_config.sql`
3. Crear usuarios administradores desde Supabase Auth.
4. Insertar los profiles correspondientes desde el SQL editor. Ejemplo:

```sql
insert into public.profiles (id, email, rol, activo)
values (
  'UUID_DEL_USUARIO_AUTH',
  'admin@ejemplo.com',
  'ADMIN',
  true
);
```

Para un usuario de solo lectura:

```sql
insert into public.profiles (id, email, rol, activo)
values (
  'UUID_DEL_USUARIO_AUTH',
  'lectura@ejemplo.com',
  'LECTURA',
  true
);
```

5. Copiar `js/supabaseClient.example.js` como `js/supabaseClient.js`.
6. Completar `SUPABASE_URL` y `SUPABASE_ANON_KEY` con la URL del proyecto y la publishable/anon key publica de Supabase.
7. Abrir `index.html` localmente o publicar la carpeta `starlink-admin/` en GitHub Pages.

## Configuracion inicial

El seed carga:

- Compra inicial del equipo: `1.077.399 ARS`.
- Recargo de tarjeta sobre compra: `1,5%`.
- Abono mensual inicial: `65.000 ARS`.
- Recargo de tarjeta sobre abono mensual: `1,5%`.
- Fundadores iniciales confirmados: `49`.
- Mora para suspension: `3 meses`.
- Metodo de equilibrio: `RAPIDO`.

Estos valores pueden editarse desde la seccion Configuracion con un usuario `ADMIN`.

## Metodo rapido

La logica esta separada en `js/calculos.js`.

Cada mes:

- Se consideran usuarios activos con estado `ACTIVO`.
- Los suspendidos por mora no dividen el abono mensual, pero mantienen deuda registrada.
- Los fundadores tienen un aporte inicial teorico de compra equivalente al total actualizado dividido por 49.
- Los ingresantes posteriores regularizan solo su parte proporcional de la compra inicial.
- La regularizacion proporcional se aplica al pago del abono mensual.
- Los fundadores con saldo compensatorio pagan reducido o cero mientras haya compensacion aplicable.
- No se muestra como dinero a devolver: solo como saldo compensatorio.
- Cuando no hay deuda de regularizacion ni saldo compensatorio, todos los activos pagan la misma cuota mensual.

## Uso operativo

1. Iniciar sesion con un usuario creado en Supabase Auth y con profile activo.
2. Cargar o revisar la configuracion.
3. Cargar personas, estado, dependencia, fundador, MAC y observaciones.
4. Registrar pagos por persona, mes y concepto.
5. En Calculo mensual, elegir un mes y calcular cargos.
6. Revisar total del abono, suma de cargos y diferencia por redondeo.
7. Cerrar el mes para guardar cargos mensuales.
8. Generar mensajes de cobro y copiarlos.
9. Revisar Morosos / suspendidos para seguimiento de cargos pendientes.
10. Exportar CSV desde Pagos o Exportacion.

## WhatsApp

La app no envia mensajes automaticamente. En la seccion Mensajes genera un enlace de WhatsApp con el texto precargado para cada persona que tenga telefono cargado y monto a pagar mayor que cero.

El usuario debe revisar el mensaje y tocar Enviar dentro de WhatsApp.

Los telefonos deben cargarse en formato internacional, sin simbolos. Ejemplo para Argentina Cordoba: `5493511234567`.

## Pruebas manuales

Levantar un servidor local desde la carpeta del proyecto:

```bash
py -m http.server 8000
```

Si no funciona:

```bash
python -m http.server 8000
```

Abrir:

```text
http://localhost:8000/tests/test_manual_calculos.html
```

Resultado esperado:

* Debe mostrar `PRUEBA OK`.
* Valida método rápido, redondeo y suma de cargos.

Abrir:

```text
http://localhost:8000/tests/test_manual_pagos.html
```

Resultado esperado:

* Debe mostrar `PRUEBA OK`.
* Valida pago mixto, pago parcial, cargo sin regularización y rechazo de pago excedente.

Estas pruebas deben ejecutarse después de modificar `js/calculos.js`, `js/pagos.js`, `js/utils.js` o la lógica de cierre/pagos en `js/app.js`.

## Seguridad

- RLS esta activado en todas las tablas.
- Usuarios anonimos no tienen politicas de lectura.
- Solo usuarios autenticados con profile activo pueden acceder.
- `LECTURA` solo puede seleccionar.
- `ADMIN` puede modificar datos.
- El frontend usa solo la publishable/anon key. La `service_role key` nunca debe copiarse en `js/supabaseClient.js`.

## Archivos principales

- `index.html`: estructura de la app.
- `css/styles.css`: estilos.
- `js/app.js`: orquestacion de UI y Supabase.
- `js/calculos.js`: funciones puras de calculo.
- `js/mensajes.js`: mensajes copiables.
- `sql/001_schema.sql`: tablas, checks, indices y auditoria.
- `sql/002_rls.sql`: funciones de rol y politicas RLS.
- `sql/003_seed_config.sql`: configuracion inicial.
