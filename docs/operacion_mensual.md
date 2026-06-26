# Operacion mensual

Esta guia describe el flujo operativo recomendado para administrar un mes de Starlink Admin ACC Cordoba. La app ayuda a registrar y revisar informacion, pero no mueve dinero real, no envia WhatsApp automaticamente y no configura el router automaticamente.

## 1. Roles

ADMIN:

- administra personas;
- registra pagos;
- revisa comprobantes;
- procesa pagos desde comprobantes;
- gestiona router/MAC;
- vincula usuarios;
- exporta datos;
- genera paquete de cierre.

LECTURA:

- puede consultar informacion operativa;
- puede ver paneles y exportaciones si esta habilitado;
- no debe modificar pagos, personas, router, usuarios ni comprobantes.

USUARIO:

- ve solo Mi cuenta;
- ve sus pagos;
- ve sus comprobantes;
- puede subir comprobantes si esta vinculado a persona;
- no ve datos de otros usuarios.

## 2. Flujo de comprobantes

1. Usuario inicia sesion.
2. Usuario sube comprobante desde Mi cuenta o comparte desde Android hacia la PWA.
3. El comprobante queda asociado automaticamente a su persona.
4. Estado inicial: `PENDIENTE`.
5. ADMIN revisa el comprobante.
6. ADMIN puede ver comprobante, descartar o registrar pago.
7. Registrar pago siempre requiere confirmacion manual de ADMIN.
8. El sistema no registra pagos automaticamente.
9. Al registrar pago desde comprobante, se crean pagos reales: `COMPRA_INICIAL`, `REGULARIZACION`, `ABONO` y `AJUSTE` si corresponde.
10. Nunca se guarda `PAGO_COMPLETO_MES`.
11. El comprobante pasa a `PROCESADO` y guarda referencias a los pagos creados.

## 3. Estados de comprobantes

PENDIENTE:

- cargado por usuario;
- falta revision.

PROCESADO:

- ya fue usado para registrar pago;
- no debe procesarse nuevamente.

DESCARTADO:

- no sirve para registrar pago;
- no se borra;
- queda como trazabilidad.

## 4. Calculo mensual y Mi cuenta

`Calculo mensual` muestra el estado por persona para el mes seleccionado.

`Mi cuenta` debe mostrar al usuario comun el mismo estado que ve ADMIN para esa persona. No deben mostrarse totales globales del sistema como deuda personal.

El detalle correcto incluye:

- equipo a pagar;
- abono del mes;
- total del mes;
- pagado;
- ajuste / saldo a favor;
- pendiente hoy;
- estado.

## 5. Pagos

Conceptos validos:

- `COMPRA_INICIAL`
- `REGULARIZACION`
- `ABONO`
- `AJUSTE`

`Pago completo del mes` es solo una opcion visual. Internamente se descompone en conceptos reales.

Si hay pago excedente, se registra `AJUSTE`. `AJUSTE` representa saldo a favor visual.

`COMPRA_INICIAL` y `REGULARIZACION` son pagos de equipo. No son saldo a favor.

## 6. Router / MAC

La app no modifica el router automaticamente. Solo indica acciones sugeridas y permite registrar manualmente el estado operativo.

Estados principales:

- pago y bloqueado: habilitar MAC;
- debe y habilitado: bloquear MAC;
- falta MAC: pedir/cargar MAC;
- pago y habilitado: correcto;
- debe y bloqueado: correcto.

## 7. Panel mensual

`Panel mensual` es una vista de control. Muestra resumen operativo del mes:

- comprobantes pendientes;
- personas al dia;
- personas con deuda;
- pagos parciales;
- saldos a favor;
- alertas router;
- personas sin MAC.

No modifica datos.

## 8. Exportaciones

`Exportacion` es solo descarga de datos. No debe contener acciones de ingreso como `Recibir comprobantes`.

Los CSV usan:

- separador `;`;
- BOM UTF-8;
- headers sin acentos.

Exportaciones disponibles:

- backup mensual;
- pagos del mes;
- comprobantes del mes;
- personas;
- pagos;
- cargos, si aplica.

## 9. Paquete ZIP de cierre mensual

Se genera desde `Cierre mensual` y descarga un unico ZIP.

No modifica datos, no cierra el mes automaticamente y puede generarse aunque existan pendientes. Sirve como foto administrativa del mes.

Contenido esperado del ZIP:

- backup mensual;
- pagos del mes;
- comprobantes del mes;
- estado de cuenta;
- router/MAC;
- deudores;
- comprobantes pendientes;
- saldo a favor;
- personas.

## 10. Checklist de cierre mensual

Es una guia operativa. No es un cierre irreversible, no bloquea cambios, no borra datos, no modifica pagos, no modifica comprobantes y no modifica router.

Uso recomendado:

1. Revisar comprobantes pendientes.
2. Procesar o descartar comprobantes.
3. Revisar pagos pendientes.
4. Revisar pagos parciales.
5. Revisar alertas router.
6. Revisar personas sin MAC.
7. Generar paquete ZIP de cierre.
8. Guardar backup.
9. Considerar el mes cerrado operativamente.

Aclaracion importante: cerrar operativamente un mes no significa que todos hayan pagado. Puede cerrarse con deuda registrada si ya fue revisada y respaldada.

## 11. Convenciones de texto

- Los textos fijos de la app deben mantenerse sin acentos.
- Los headers CSV deben mantenerse sin acentos.
- No modificar datos reales guardados en Supabase solo para quitar acentos.
