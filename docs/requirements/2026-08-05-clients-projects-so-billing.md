# Requerimientos nuevos — Reunión de Revisión de Requerimientos Funcionales

**Fecha:** 2026-08-05
**Fuente:** transcripción de la reunión (Martin De León) + prototipo `southpoint-labs-prototype.html` (Eduardo) mostrado durante la call.
**Alcance de este documento:** únicamente lo que se pidió/decidió en esta reunión. No incorpora ni referencia el documento de requerimientos anterior (se descartó por desorganizado).

> Nota de transcripción: la call tiene varios términos que el transcriptor automático deformó. Interpretación usada en este doc: "MCA" → **MSA**, "show"/"sou"/"SO" → **SOW**, "isla"/"ISA" → **SLA**, "gesta" → **pestaña (tab)**. Todo el copy de la UI va en inglés (pedido explícito, repetido varias veces).

---

## 1. Módulo Clients (nuevo)

Alta de clientes.

| Campo | Tipo | Obligatorio |
|---|---|---|
| Client Name | texto | ✅ |
| Email | texto | — |
| Domain | texto | — |
| Primary Contact Name | texto | ✅ |
| Primary Contact Email | texto | ✅ |
| MSA (archivo) | file upload | ✅ |

El MSA se adjunta una vez por cliente en este módulo (no en Projects).

---

## 2. Módulo Projects and SO(W) (nuevo)

Reemplaza el alta de proyectos actual. Cubre: creación de proyectos y asociación de su SOW.

### 2.1 Vista principal: lista, no formulario

Al entrar al módulo, lo primero es una **tabla de proyectos con filtros arriba** (no un alta directa). El alta se dispara con un botón y abre un **popup con pestañas** (wizard). Decisiones de diseño visual (qué columnas mostrar en la tabla, cómo acomodar filtros) quedan a criterio del desarrollo — lo importante es que los datos de abajo estén.

### 2.2 Alta de proyecto — wizard por pestañas

No se puede avanzar de pestaña sin completar los campos obligatorios de la anterior. No se puede tocar nada hasta elegir el cliente (pestaña 1).

**Pestaña 1 — Identificación**
| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Cliente | dropdown (clientes existentes) | ✅ | al elegirlo, autopopula el MSA asociado |
| MSA | autopoblado desde Cliente | — | se puede mostrar como campo, pero no se edita a mano |
| Nombre del proyecto | texto | ✅ | |
| N.º de SOW | texto | ✅ | |
| Archivo del SOW | file upload | ✅ | mismo tratamiento que el MSA |
| Has stages? | boolean (checkbox/toggle) | ✅ | ver 2.2.1 |
| Nombre del stage | texto | condicional | obligatorio solo si Has stages = sí |
| N.º de proposal | texto | — | opcional, no todos los proyectos lo tienen |

**2.2.1 — Stages**
No todos los proyectos tienen stages (ej. proyectos chicos de Florencia, sin múltiples etapas). Se modela como boolean `has_stages`. Si es que sí, se pide el nombre del stage como string y pasa a ser obligatorio. Jerarquía acordada: **Cliente → Proyecto → Stages (opcional) → cada Stage tiene un SOW**. Si el proyecto no tiene stages, el SOW cuelga directamente del proyecto.

**Pestaña 2 — Alcance**
| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| Presupuesto de horas | numérico, manual | ✅ | hoy manual; a futuro se auto-completaría leyendo el documento del SOW (template fijo) |
| Modelo | **⚠️ a definir con Eduardo** | ✅ | no está claro si es texto libre o dropdown, ni qué valores tiene (el prototipo usa "Time & Materials") |
| Período | dos inputs: Start date / End date | ✅ | sección, no un solo campo |

**Pestaña 3 — Mantenimiento (opcional, no obligatoria salvo que se abra)**
Se modela igual que Stages: un toggle/botón que abre la sección. Mientras está colapsada no es obligatoria; en el momento en que el usuario la despliega y empieza a llenar, los campos pasan a ser obligatorios.

| Campo | Tipo | Notas |
|---|---|---|
| Plantilla | dropdown: Standard / Premium / Custom | Standard autopopula 60 días / 40 h / 6 meses; Premium autopopula sus propios valores fijos; Custom deja los campos editables |
| Transición a mantenimiento | dropdown: 30 días post-cierre / 60 días post-cierre | cada proyecto tiene una fecha de entrega (end date) que determina cuándo arranca esto |
| Bolsa de horas | numérico | horas/mes disponibles para mantenimiento de ese proyecto |
| Duración | texto/numérico (meses) | |
| Tabla de severidad/SLA | tabla | ver abajo |

Tabla de severidad (reproducir tal cual está en el prototipo — Martin la aprobó explícitamente: *"esto está impecable, reproducilo"*):

| Severidad | Tiempo de respuesta |
|---|---|
| Crítica | < 4 horas |
| Alta | < 1 día hábil |
| Media / Baja | < 3 días hábiles |

**Pestaña 4 — Tasks del SOW (opcional, mismo patrón que Mantenimiento)**
Tabla donde se van agregando filas. Por cada task, a modo de input solo hay 3 campos:

| Campo | Tipo | Obligatorio |
|---|---|---|
| Nombre de la task | texto | ✅ (si se agrega la fila) |
| Rol | texto/dropdown | ✅ |
| Horas estimadas | numérico | ✅ |

**Horas reales y desvío NO son input** — se calculan después, a partir de lo que se vaya cargando en Entries. No tiene sentido pedirlas al crear la task porque todavía no se ejecutó.

Al terminar (botón "Finish"): se crea el proyecto y aparece en la tabla principal.

### 2.3 Change Requests

- Asociados a un **proyecto**, no a un cliente ni a nivel global.
- **No van en la vista principal del módulo** — aparecen dentro del popup de detalle del proyecto (al hacer click en una fila de la tabla), en una sección al final.
- Flujo: se habla primero con el cliente; si da el OK, se genera el documento de CR para enviarle.
- Distinción importante entre **overage** y **change request**:
  - **Overage** = nos pasamos de las horas contratadas por nuestra cuenta (ej. un contractor cargó de más). Se decide caso a caso: o SouthPoint asume el costo (se le sigue pagando al contractor esas horas, pero no se factura al cliente — es pérdida propia), o se convierte en CR si el cliente acepta pagar el excedente.
  - Un **CR** solo existe si el cliente aceptó pagar horas adicionales — ahí sí se genera el documento formal.

---

## 3. Time Entries → separar en dos módulos: Entries y Billing

Hoy es un solo módulo. Se separa en **Entries** (paso previo, de triage/allocation) y **Billing** (lo que efectivamente se factura al cliente).

### 3.1 Entries

Acá se decide, por cada hora cargada, si:
1. **bill to client** — la paga el cliente
2. **overage** — la pagamos nosotros (caso descrito en 2.3)
3. **SP internal** — horas internas de SouthPoint, no asociadas a ningún proyecto (ej. reuniones internas)

Reglas de UX (explícitas, no son sugerencia):
- Las horas que llegan nuevas (recién sincronizadas) **no tienen allocation todavía** — tienen que aparecer **primero en el orden/filtrado** las que no tienen allocation asignada, no mezcladas con las que ya la tienen.
- **No** se edita el allocation haciendo click directo en la celda/dropdown de la tabla. El flujo correcto es: seleccionar una o varias filas (checkbox) → aparece una opción para elegir el nuevo allocation → **submit explícito**. Sirve tanto para una fila como para bulk. Razón dada explícitamente: *"para cosas que tienen que ver con plata, tiene que haber una confirmación en el medio."* No autoguardar on-click.
- Filtros: **Cliente, Proyecto, Contractor, Semana**. Explícitamente **NO** filtrar por SOW/Stage por separado — es 1:1 con el proyecto, sería redundante (*"filtrar por proyecto y filtrar por show me parece una boludez porque no hay más de un show por proyecto"*).
- Paginación: no cargar todo de una. Definir un máximo de filas por página/tab y cargar de a paquetes (mismo patrón que se usó en el proyecto Forecasting), para no tardar una eternidad si no hay filtros aplicados.
- Si en algún momento la tabla se llena de columnas al punto de necesitar un menú "⋯" de overflow, ahí sí conviene agregar selección de columnas — no antes, no es prioridad hoy.
- Gráfico resumen (cuando se filtra por proyecto): línea/barra que muestra horas totales del proyecto, cuánto se viene facturando al cliente, cuánto se asumió como pérdida (overage), y cuánto queda sin usar. Ubicación exacta en la pantalla (arriba de todo / debajo de filtros / al costado) es **decisión de diseño a validar con Martin antes de implementar** — no tirarlo a producción sin ese visto bueno.

### 3.2 Billing

Similar al Entries de hoy, pero filtrado únicamente a lo que corresponde facturar al cliente (bill to client). **Pendiente de terminar de definir con Eduardo** — Martin no cerró esta parte en la call (*"Billing todavía hay que definir... no te voy a decir nada hasta que no lo defina con Eduardo, iba a quedar pendiente"*).

---

## 4. Módulo Client Summary / Resumen de clientes (nuevo)

Tabla con filtro por cliente. Por cada cliente se muestran sus proyectos y, por proyecto:

| Campo | Origen |
|---|---|
| Estado del proyecto | — |
| Budget de horas | definido al crear el proyecto (sección Alcance) |
| Horas consumidas | calculado a partir de lo cargado en Entries |
| Overage | calculado a partir de las entries marcadas como overage |
| Salud (health) | **⚠️ a definir** — qué determina que un proyecto esté "sano" o no |

Interacciones:
- Click en el cliente → va a Entries filtrado por ese cliente.
- Click en un proyecto → va a Entries filtrado por ese proyecto.

El dashboard actual **no se toca** — no es prioridad para esta entrega.

---

## 5. Prioridad para esta entrega (orden dado por Martin)

1. Client Summary
2. Split de Time Entries en Entries + Billing
3. Projects and SO (project console + alta)
4. Clients (creación de cliente)

---

## 6. Abierto / pendiente de definir con Eduardo

- **Modelo** (pestaña Alcance): ¿texto libre o dropdown? ¿qué valores?
- **Salud** en Client Summary: qué la define.
- **Billing**: alcance y comportamiento todavía no cerrado.

## 7. Decisiones de diseño delegadas al desarrollo (Martin fue explícito en que no son su bola)

- Layout visual de la tabla de proyectos y sus filtros.
- Ubicación exacta del gráfico resumen en Entries (validar antes de implementar).
- Selección de columnas en tablas: solo si realmente se necesita (tabla saturada), no de entrada.
