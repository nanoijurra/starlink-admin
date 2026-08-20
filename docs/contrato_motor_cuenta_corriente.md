# Contrato del motor de cuenta corriente - Starlink Admin

## 1. Objetivo del sistema

El objetivo principal de Starlink Admin es llevar una cuenta corriente clara, justa y verificable para administrar los pagos compartidos del servicio Starlink del grupo.

El sistema debe asegurar que:

- Todos los usuarios activos paguen proporcionalmente lo mismo por el costo inicial del equipo.
- Todos los usuarios activos paguen proporcionalmente lo mismo por el abono mensual del plan.
- Cada pago real ingresado impacte correctamente en la cuenta corriente de la persona.
- Si una persona paga de mas, ese excedente quede como saldo a favor para meses futuros.
- Todas las pantallas importantes muestren la misma informacion.

La cuenta corriente es el corazon del sistema. Todo lo demas debe depender de ella.

---

## 2. Fuente unica de informacion

La app no debe tener varias pantallas calculando deuda de manera independiente.

Debe existir una fuente unica de cuenta corriente mensual, que puede conservar el nombre actual:

```text
get_calculo_mensual_estado(p_mes)
```

Esa fuente debe ser usada por:

- Calculo mensual.
- Mi cuenta.
- Mensajes de cobro.
- Panel mensual.
- Cierre mensual.
- Exportaciones.
- ZIP de cierre.
- Gestion router / MAC.

En una primera etapa de reparacion, la prioridad sera conectar correctamente:

- Calculo mensual.
- Mi cuenta.
- Mensajes de cobro.

Despues se conectaran las demas pantallas.

---

## 3. Usuarios activos

La division del costo se hace entre usuarios activos.

Un usuario activo es una persona registrada en `personas` con estado:

```text
ACTIVO
```

Las personas que no esten activas no deben generar nueva deuda mensual.

Regla general:

```text
cantidad_usuarios_activos = cantidad de personas con estado ACTIVO
```

Esa cantidad se usa para dividir:

- El costo inicial del equipo.
- El costo mensual del abono.

---

## 4. Costo inicial del equipo

El costo inicial actualizado del equipo Starlink debe dividirse entre todos los usuarios activos.

Formula conceptual:

```text
cuota_equipo_por_persona = total_equipo_actualizado / usuarios_activos
```

Todos los usuarios activos deben terminar pagando la misma cuota de equipo.

El pago del equipo es condicion necesaria para ingresar al grupo.

Por lo tanto, no debe existir una situacion valida donde un usuario nuevo quede debiendo equipo despues de ser incorporado.

---

## 5. Abono mensual

El abono mensual actualizado debe dividirse entre todos los usuarios activos del mes.

Formula conceptual:

```text
cuota_abono_mes = total_abono_actualizado / usuarios_activos
```

Cada usuario activo debe pagar su parte mensual del abono, salvo que tenga saldo a favor suficiente para cubrirla.

---

## 6. Carga de pagos

La carga de pagos debe ser simple y no debe depender de que el admin elija conceptos manualmente.

El admin debe cargar solamente:

- Persona.
- Fecha de pago.
- Mes aplicado.
- Monto pagado.
- Medio de pago.
- Observacion opcional.

No deben mostrarse como opciones manuales:

```text
COMPRA_INICIAL
REGULARIZACION
ABONO
AJUSTE
Pago completo del mes
```

Esos conceptos pueden seguir existiendo internamente, pero deben ser generados por el sistema, no elegidos manualmente por el admin.

---

## 7. Imputacion automatica del pago

Cuando se registra un pago, el sistema debe imputarlo automaticamente en este orden:

```text
1. Equipo pendiente, si corresponde.
2. Abono del mes.
3. Saldo a favor, si sobra dinero.
```

### Caso A - Usuario nuevo

Un usuario nuevo debe pagar como minimo:

```text
equipo pendiente + abono del mes
```

Si paga menos que eso, el sistema no debe registrar el ingreso como valido.

Mensaje esperado:

```text
Para ingresar debe cubrir equipo y abono del mes como minimo.
```

### Caso B - Usuario que ya pago el equipo

Si la persona ya tiene cubierto el equipo, el pago se aplica primero al abono del mes.

Si paga mas que el abono, el excedente queda como saldo a favor.

### Caso C - Usuario con saldo a favor

Si una persona tiene saldo a favor previo, ese saldo debe aplicarse automaticamente a la deuda mensual.

Si el saldo a favor alcanza para cubrir el mes, la persona no debe pagar nada ese mes.

---

## 8. Saldo a favor

El saldo a favor representa dinero pagado de mas por una persona.

Puede originarse por:

- Pago mayor al equipo mas abono.
- Pago mayor al abono mensual.
- Recalculo del costo del equipo al incorporarse nuevos usuarios activos.
- Correcciones manuales debidamente registradas.

El saldo a favor no se devuelve en efectivo.

Debe aplicarse automaticamente a obligaciones futuras.

Ejemplo:

```text
Abono del mes: 1178,13
Saldo a favor previo: 2000,00

Resultado:
Pendiente del mes: 0,00
Saldo a favor restante: 821,87
```

---

## 9. Conceptos internos de pago

Los conceptos internos pueden mantenerse para compatibilidad y auditoria:

```text
COMPRA_INICIAL
REGULARIZACION
ABONO
AJUSTE
```

Pero la cuenta corriente no debe depender de que el concepto haya sido elegido correctamente por una persona.

La fuente principal del dinero ingresado debe ser:

```text
sum(pagos.monto)
```

por persona y por mes.

Los conceptos sirven para explicar como fue imputado el pago, no para reemplazar el calculo de cuenta corriente.

---

## 10. Estados de cuenta

La cuenta corriente mensual debe devolver estados claros y sin acentos:

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
No tiene pendiente y no tiene saldo a favor relevante.

SALDO A FAVOR:
No tiene pendiente y tiene saldo a favor.

PENDIENTE:
Tiene deuda y no registro pago aplicable en el mes.

PARCIAL:
Tiene deuda, pero registro algun pago aplicable en el mes.

SIN CARGO:
No corresponde cargo mensual y no tiene deuda.
```

Tolerancia por redondeo:

```text
0,01
```

---

## 11. Informacion minima que debe devolver el motor

Para cada persona y mes, la fuente canonica debe devolver como minimo:

```text
persona_id
nombre
mes
usuarios_activos
cuota_equipo_por_persona
cuota_abono_mes
total_pagado_mes
total_pagado_acumulado
equipo_imputado_mes
abono_imputado_mes
saldo_a_favor_inicial
saldo_a_favor_final
pendiente_hoy
estado
observacion
```

Esta salida debe ser suficiente para alimentar:

- Calculo mensual.
- Mi cuenta.
- Mensajes.
- Panel.
- Exportaciones.
- Cierre.
- Router.

---

## 12. Mensajes de cobro

Mensajes no debe calcular deuda por su cuenta.

Debe leer el mismo resultado que Calculo mensual.

Si la persona tiene pendiente:

```text
Monto a pagar: pendiente_hoy
```

Si la persona tiene saldo a favor suficiente:

```text
No tenes que pagar este mes.
Tu cuota mensual es $X y tenes saldo a favor suficiente.
Saldo a favor restante: $Y.
```

Si la persona tiene saldo a favor parcial, el mensaje debe pedir solo la diferencia.

---

## 13. Caso real de control - PEREZ CARINA

Caso corregido:

```text
Persona: PEREZ CARINA
Fecha de pago: 2026-07-04
Mes aplicado: 2026-07

COMPRA_INICIAL: 18854,48
ABONO: 1137,50
AJUSTE: 8,02

Total real pagado: 20000,00
```

Interpretacion correcta:

```text
Equipo imputado: 18854,48
Abono imputado: 1137,50
Saldo a favor: 8,02
Total pagado: 20000,00
Pendiente: 0,00
```

El sistema no debe volver a interpretar que Carina tiene saldo a favor de 180008,02.

---

## 14. Casos de prueba obligatorios

### Caso 1 - Usuario nuevo paga minimo mas excedente

Entrada:

```text
Equipo pendiente: 18854,48
Abono mes: 1137,50
Pago recibido: 20000,00
```

Salida esperada:

```text
Equipo imputado: 18854,48
Abono imputado: 1137,50
Saldo a favor: 8,02
Pendiente: 0,00
Estado: SALDO A FAVOR
```

---

### Caso 2 - Usuario con equipo cubierto paga mas que el abono

Entrada:

```text
Equipo pendiente: 0,00
Abono mes: 1178,13
Pago recibido: 2000,00
```

Salida esperada:

```text
Abono imputado: 1178,13
Saldo a favor: 821,87
Pendiente: 0,00
Estado: SALDO A FAVOR
```

---

### Caso 3 - Usuario con saldo a favor cubre el mes

Entrada:

```text
Saldo a favor previo: 2000,00
Abono mes: 1178,13
Pago recibido: 0,00
```

Salida esperada:

```text
Pendiente: 0,00
Saldo a favor final: 821,87
Estado: SALDO A FAVOR
```

---

### Caso 4 - Usuario sin equipo pendiente paga parcialmente el abono

Entrada:

```text
Equipo pendiente: 0,00
Abono mes: 1178,13
Pago recibido: 500,00
```

Salida esperada:

```text
Pendiente: 678,13
Estado: PARCIAL
```

---

### Caso 5 - Usuario nuevo intenta ingresar sin cubrir equipo y abono

Entrada:

```text
Equipo pendiente: 18854,48
Abono mes: 1137,50
Pago recibido: 10000,00
```

Salida esperada:

```text
No registrar ingreso valido.
Mostrar error: Para ingresar debe cubrir equipo y abono del mes como minimo.
```

---

## 15. Reglas de reparacion tecnica

Durante la reparacion del motor:

- No borrar pagos existentes.
- No modificar nombres de personas.
- No modificar datos reales manualmente desde codigo.
- No hacer migraciones destructivas.
- No tocar router, cierre, ZIP ni PWA en la primera etapa.
- No crear nuevas fuentes paralelas de calculo.
- No agregar pantallas nuevas.
- No permitir que Mensajes calcule deuda distinto a Calculo mensual.
- No permitir que Mi cuenta muestre valores distintos a Calculo mensual.

---

## 16. Criterio de aceptacion

La reparacion se considera correcta cuando, para una misma persona y un mismo mes:

```text
Calculo mensual = Mi cuenta = Mensajes
```

Y cuando se cumpla que:

```text
El equipo se divide entre usuarios activos.
El abono se divide entre usuarios activos.
Los pagos se cargan como monto total.
La imputacion es automatica.
El saldo a favor se aplica a meses futuros.
Nadie ve totales globales como deuda personal.
No existen deudas de equipo para usuarios ingresados validamente.
```

---

## 17. Orden recomendado de implementacion

Primera etapa:

```text
1. Reparar motor de cuenta corriente.
2. Reparar carga de pagos.
3. Reparar procesamiento de pago desde comprobante.
4. Conectar Calculo mensual.
5. Conectar Mi cuenta.
6. Conectar Mensajes.
7. Probar con casos reales.
```

Segunda etapa:

```text
1. Conectar Panel mensual.
2. Conectar Cierre mensual.
3. Conectar Exportaciones.
4. Conectar ZIP de cierre.
5. Conectar Gestion router / MAC.
```

La segunda etapa no debe comenzar hasta que la primera etapa este validada.