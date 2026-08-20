# Prompt para Codex - Fase 1 reparar motor de cuenta corriente

Estamos trabajando en el proyecto `starlink-admin`.

Ya existe un documento rector que debe ser leido antes de tocar codigo:

```text
docs/contrato_motor_cuenta_corriente.md
```

Primero lee ese documento completo. Ese archivo es el contrato funcional del sistema.

El objetivo de esta tarea es reparar la FASE 1 del motor de cuenta corriente.

No quiero nuevas funciones accesorias. No quiero redisenar toda la app. No quiero tocar router, cierre mensual, ZIP, PWA ni exportaciones en esta fase.

---

## Objetivo principal

El sistema debe volver a cumplir su objetivo original:

```text
Todos los usuarios activos pagan proporcionalmente lo mismo por el equipo.
Todos los usuarios activos pagan proporcionalmente lo mismo por el abono mensual.
Cada pago real ingresado impacta en una cuenta corriente unica.
Si alguien paga de mas, queda saldo a favor para meses futuros.
```

Actualmente distintas pantallas calculan distinto. Eso debe corregirse.

En esta fase deben quedar alineados:

```text
Calculo mensual = Mi cuenta = Mensajes de cobro
```

---

## Alcance permitido

Modificar solo lo necesario para:

1. Reparar el motor de cuenta corriente.
2. Reparar la carga manual de pagos.
3. Reparar el procesamiento de pagos desde comprobantes, si existe.
4. Hacer que Calculo mensual use la fuente canonica.
5. Hacer que Mi cuenta use la misma fuente canonica.
6. Hacer que Mensajes use la misma fuente canonica.

---

## Fuera de alcance

No tocar en esta fase:

```text
Router / MAC
Cierre mensual
ZIP de cierre
PWA
Service worker
Storage
Exportaciones
Cambios esteticos generales
Nuevas pantallas
```

No borrar pagos existentes.

No modificar datos reales desde codigo.

No hacer migraciones destructivas.

No hacer commits automaticos.

---

## Fuente canonica

Revisar si existe la RPC:

```text
get_calculo_mensual_estado(p_mes)
```

Si existe, mantener ese nombre y reparar su logica.

La prioridad es que esta RPC sea la fuente canonica de la cuenta corriente mensual.

Si hace falta crear una migracion SQL nueva, crear un archivo nuevo, por ejemplo:

```text
sql/010_reparacion_motor_cuenta_corriente.sql
```

No modificar destructivamente migraciones anteriores.

Si no se puede resolver todo en SQL, explicar por que. Pero las pantallas no deben volver a calcular cada una por separado.

---

## Regla critica sobre pagos

La cuenta corriente NO debe depender de que `pagos.concepto` haya sido elegido correctamente.

Para saber cuanto dinero real ingreso una persona, usar:

```sql
sum(pagos.monto)
```

por persona y por mes.

Los conceptos internos pueden seguir existiendo para auditoria:

```text
COMPRA_INICIAL
REGULARIZACION
ABONO
AJUSTE
```

Pero el motor de cuenta corriente debe basarse en dinero real ingresado, no en que el concepto manual haya sido correcto.

---

## Modelo de cuenta corriente esperado

Para un mes consultado `p_mes`, calcular por persona:

```text
obligacion acumulada hasta p_mes
-
dinero real pagado acumulado hasta p_mes
=
pendiente o saldo a favor
```

El calculo debe ser acumulativo, no aislado del mes.

Esto es obligatorio porque el saldo a favor de meses anteriores debe aplicarse automaticamente a meses futuros.

---

## Participacion por mes

Usar los datos disponibles en el modelo actual.

Si no existe fecha de alta / fecha de ingreso, aplicar este fallback:

```text
Si es_fundador = true:
  participa desde el primer mes operativo del sistema.

Si es_fundador = false y tiene pagos:
  participa desde su primer mes_aplicado con pago.

Si es_fundador = false y no tiene pagos:
  participa desde el mes consultado.

Si estado <> ACTIVO:
  no debe generar deuda nueva en el mes consultado.
```

No inventar una migracion grande de altas/bajas en esta fase.

---

## Equipo

El total actualizado del equipo se divide entre usuarios activos/participantes.

```text
cuota_equipo_por_persona = total_equipo_actualizado / usuarios_activos
```

Todos los usuarios activos deben terminar pagando lo mismo por el equipo.

Cuando aumenta la cantidad de usuarios activos, la cuota individual de equipo baja. Si alguien ya pago mas que su nueva cuota, esa diferencia debe transformarse en saldo a favor para meses futuros.

---

## Abono mensual

El abono mensual actualizado se divide entre los usuarios activos/participantes del mes.

```text
cuota_abono_mes = total_abono_actualizado / usuarios_activos_del_mes
```

---

## Saldo a favor

El saldo a favor debe aplicarse automaticamente a meses futuros.

Ejemplo:

```text
Saldo a favor previo: 2000.00
Abono del mes: 1178.13
Pago nuevo: 0.00

Resultado:
Pendiente: 0.00
Saldo a favor final: 821.87
Estado: SALDO A FAVOR
```

---

## Carga de pagos

La pantalla de carga de pagos no debe permitir elegir concepto manual.

Eliminar u ocultar como opciones elegibles:

```text
COMPRA_INICIAL
REGULARIZACION
ABONO
AJUSTE
Pago completo del mes
PAGO_COMPLETO_MES
```

El admin debe cargar solamente:

```text
Persona
Fecha de pago
Mes aplicado
Monto pagado
Medio
Observacion opcional
```

El sistema debe imputar automaticamente el monto en este orden:

```text
1. Equipo pendiente, si corresponde.
2. Abono / deuda mensual.
3. Saldo a favor, si sobra.
```

Internamente se pueden seguir guardando varias filas en `pagos` con conceptos para compatibilidad, pero esos conceptos deben ser generados por el sistema, no elegidos manualmente.

---

## Regla de ingreso

Si una persona todavia debe equipo, el sistema no debe aceptar un pago menor al minimo necesario para ingresar.

Minimo:

```text
equipo pendiente + abono pendiente del mes
```

considerando saldo a favor previo si existiera.

Mensaje fijo esperado, sin acentos:

```text
Para ingresar debe cubrir equipo y abono del mes como minimo.
```

Para personas que ya tienen cubierto el equipo, permitir pago parcial del abono y marcar estado `PARCIAL`.

---

## Procesamiento desde comprobantes

Si existe "Registrar pago desde comprobante", debe usar exactamente la misma logica que la carga manual de pagos:

```text
monto total informado
=> imputacion automatica
=> equipo
=> abono
=> saldo a favor
```

No debe elegir conceptos manuales.

Mantener la proteccion contra doble procesamiento.

---

## Calculo mensual

La vista Calculo mensual debe leer la fuente canonica.

No debe calcular deuda con una logica paralela.

Debe mostrar, como minimo:

```text
Persona
Equipo / cuota equipo objetivo
Abono del mes
Total pagado del mes
Saldo a favor inicial
Saldo a favor final
Pendiente hoy
Estado
Observacion
```

No debe mostrar totales globales como deuda personal.

---

## Mi cuenta

Mi cuenta debe usar la misma fuente que Calculo mensual, filtrada por la persona vinculada al usuario autenticado.

Para una misma persona y mes:

```text
Mi cuenta debe dar los mismos numeros que Calculo mensual.
```

---

## Mensajes

Mensajes no debe calcular deuda por su cuenta.

Debe leer la misma fuente canonica que Calculo mensual.

Si `pendiente_hoy > 0`, el mensaje debe pedir exactamente ese importe.

Si `pendiente_hoy <= 0` y hay saldo a favor, debe informar que no tiene que pagar este mes y mostrar el saldo restante.

Ejemplo de texto, sin acentos:

```text
No tenes que pagar este mes.
Tu cuota mensual es $X y tenes saldo a favor suficiente.
Saldo a favor restante: $Y.
```

---

## Estados

Usar textos fijos sin acentos:

```text
AL DIA
PENDIENTE
PARCIAL
SALDO A FAVOR
SIN CARGO
```

Criterios:

```text
AL DIA:
pendiente_hoy <= 0.01 y saldo_a_favor_final <= 0.01

SALDO A FAVOR:
pendiente_hoy <= 0.01 y saldo_a_favor_final > 0.01

PENDIENTE:
pendiente_hoy > 0.01 y total_pagado_mes <= 0.01

PARCIAL:
pendiente_hoy > 0.01 y total_pagado_mes > 0.01

SIN CARGO:
sin cargo mensual, sin deuda y sin pago
```

Usar tolerancia de redondeo:

```text
0.01
```

---

## Caso real obligatorio: PEREZ CARINA

Debe respetarse este caso real:

```text
Persona: PEREZ CARINA
Fecha de pago: 2026-07-04
Mes aplicado: 2026-07

COMPRA_INICIAL: 18854.48
ABONO: 1137.50
AJUSTE: 8.02

Total real pagado: 20000.00
```

Interpretacion correcta:

```text
Total real pagado: 20000.00
Saldo a favor: 8.02
Pendiente: 0.00
```

El sistema no debe volver a mostrar saldo a favor de 180008.02 para Carina.

---

## Casos de prueba obligatorios

Agregar o actualizar pruebas/manual tests si corresponde.

### Caso 1 - Usuario nuevo paga minimo mas excedente

Entrada:

```text
Equipo pendiente: 18854.48
Abono mes: 1137.50
Pago recibido: 20000.00
```

Salida esperada:

```text
Equipo imputado: 18854.48
Abono imputado: 1137.50
Saldo a favor: 8.02
Pendiente: 0.00
Estado: SALDO A FAVOR
```

### Caso 2 - Usuario con equipo cubierto paga mas que abono

Entrada:

```text
Equipo pendiente: 0.00
Abono mes: 1178.13
Pago recibido: 2000.00
```

Salida esperada:

```text
Abono imputado: 1178.13
Saldo a favor: 821.87
Pendiente: 0.00
Estado: SALDO A FAVOR
```

### Caso 3 - Usuario con saldo a favor cubre el mes

Entrada:

```text
Saldo a favor previo: 2000.00
Abono mes: 1178.13
Pago recibido: 0.00
```

Salida esperada:

```text
Pendiente: 0.00
Saldo a favor final: 821.87
Estado: SALDO A FAVOR
```

### Caso 4 - Pago parcial de usuario sin equipo pendiente

Entrada:

```text
Equipo pendiente: 0.00
Abono mes: 1178.13
Pago recibido: 500.00
```

Salida esperada:

```text
Pendiente: 678.13
Estado: PARCIAL
```

### Caso 5 - Usuario nuevo intenta ingresar sin cubrir equipo y abono

Entrada:

```text
Equipo pendiente: 18854.48
Abono mes: 1137.50
Pago recibido: 10000.00
```

Salida esperada:

```text
No registrar ingreso valido.
Mostrar error: Para ingresar debe cubrir equipo y abono del mes como minimo.
```

---

## Reglas tecnicas

* Usar `round2` o equivalente existente.
* No introducir librerias externas.
* No modificar service worker.
* No modificar PWA.
* No borrar pagos.
* No cambiar nombres de personas.
* No hacer SQL destructivo.
* No crear fuentes paralelas.
* No dejar a Mensajes calculando por su cuenta.
* No dejar a Mi cuenta calculando distinto a Calculo mensual.
* Mantener textos fijos sin acentos.

---

## Validaciones finales

Antes de terminar, correr:

```cmd
node --check js/app.js
```

Si se modifican otros archivos JS, revisar sintaxis tambien con `node --check`.

Informar al final:

1. Archivos modificados.
2. Si se creo migracion SQL nueva.
3. Que SQL debo ejecutar en Supabase, si corresponde.
4. Que pantallas quedaron conectadas a la fuente canonica.
5. Que pruebas manuales debo correr.
6. Confirmar que NO se tocaron router, cierre mensual, ZIP, PWA ni exportaciones.

No hacer commit.
