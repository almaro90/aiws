# 12 — Review UI/UX de AIWS Web

> Fecha de revisión: 24 de julio de 2026
> Versión revisada: AIWS v0.5.1, commit `7d53e62`
> Estado: implementado y verificado; no modifica contratos ni comportamiento
> Fecha de cierre: 25 de julio de 2026
> Superficie: `apps/web`, contratos y documentación del MVP

## 1. Resumen ejecutivo

La revisión original constató que AIWS Web cubría el MVP completo y tenía una base técnica sólida:
rutas protegidas, layouts desktop/móvil diferenciados, formularios con validación, conflictos
optimistas que conservan borradores, polling de Runs, uploads secuenciales, Markdown seguro y
overlays con gestión de foco. Su línea base automatizada estaba formada por 12 tests Web y 18 casos
Playwright ejecutados en desktop y móvil, es decir, 36 escenarios.

El 25 de julio de 2026 se cerraron y verificaron los cinco lotes del backlog, UI-001–UI-030. La
línea base final queda en 28 tests Web y 95 escenarios Playwright aprobados, con 5 omisiones
deliberadas correspondientes a casos duplicados de la matriz desktop/móvil. La evaluación,
hallazgos y criterios originales se conservan en este documento como contexto histórico, no como
trabajo pendiente.

La revisión había detectado tres defectos de corrección que debían resolverse antes del rediseño:

1. `curating` no tenía presentación propia y caía en el fallback de `StatusBadge`.
2. Crear Task afirmaba que `userRequest` quedaba inmutable al crearla, aunque el dominio permite
   editarla en Draft y la congela al pasar a Curating.
3. El diálogo para descartar la última Question anunciaba retorno a Draft, pero la transición
   automática correcta es Blocked → Curating.

No se detectó un P0. La ejecución siguió el orden previsto: correcciones y fundamentos,
shell/listados, formularios/configuración, Task Detail y, finalmente, accesibilidad y resiliencia.
No se añadieron funcionalidades fuera del MVP.

## 2. Alcance, fuentes y método

### 2.1 Fuentes revisadas

- `PRD.md`, todos los documentos existentes de `docs/` y los ADR.
- `docs/contracts/openapi.yaml` y las migraciones SQL `0001`–`0009`.
- Router, shell, estilos, páginas, cliente HTTP y componentes de `apps/web`.
- Los 12 tests de `apps/web/test/web.test.ts`.
- Los 18 casos de `apps/web/e2e/ui.playwright.ts` en los proyectos
  `desktop-chromium` y `mobile-chromium`.
- El [catálogo oficial vigente de shadcn/ui](https://ui.shadcn.com/docs/components), consultado el
  24 de julio de 2026.

El hito formal activo de `docs/09-implementation-plan.md` es el Hito 23, pero todos sus entregables
locales están marcados como completados. Esta review es documentación posterior al hito; no abre un
segundo hito de implementación ni altera el orden del pack.

### 2.2 Método

Para cada ruta se contrastaron objetivo, acciones, información, estados, navegación, responsive,
accesibilidad y manejo de errores con:

1. Las invariantes del dominio Task/Cycle/Delivery.
2. Los requisitos Web del PRD y `docs/06-web.md`.
3. El contrato HTTP disponible para la Web.
4. La implementación y sus tests.

La severidad usa estas definiciones:

| Severidad | Criterio |
| --- | --- |
| P0 | Impide completar un recorrido crítico, causa pérdida de datos o vulnera seguridad. |
| P1 | Comunica mal el dominio, oculta una decisión importante o produce una fricción repetida. |
| P2 | Reduce consistencia, legibilidad, eficiencia o calidad percibida sin bloquear el flujo. |

Los hallazgos se separan en `COR` (corrección), `UX` (interacción/arquitectura de información),
`VIS` (refinamiento visual), `A11Y` (accesibilidad) y `RES` (resiliencia).

### 2.3 Límites

- No se proponen cambios a OpenAPI, SQL, Core ni tipos públicos.
- Web y CLI siguen usando exclusivamente la API.
- No se añaden dashboard, Kanban, búsqueda global, shortcuts globales, tema personalizable,
  comentarios, prioridades, etiquetas, WebSockets ni previews avanzadas de Attachments.
- Se conserva el tema claro y la prioridad desktop operativa, sin degradar móvil.
- Los componentes shadcn/ui son medios, no entregables por sí mismos; solo se incorporan si
  resuelven un hallazgo aceptado.

## 3. Modelo mental que debe comunicar la Web

La interfaz debe hacer visibles, sin inventar estados, estas tres capas:

| Capa | Pregunta que responde | Ejemplos |
| --- | --- | --- |
| Task | ¿En qué fase de negocio está el trabajo actual? | Draft, Curating, Blocked, Ready, Implementing, Done |
| Cycle | ¿Qué intención incremental se está resolviendo? | petición inicial, contexto, cambio solicitado, Questions, spec |
| Delivery | ¿Qué continuidad Git entrega uno o varios Cycles? | Base Branch, rama de trabajo, PR y Runs de Implementation |

Un Run es un intento técnico de Curation o Implementation, no un estado de Task. Una pausa indica
que el trabajo pendiente del Cycle requiere intervención; no significa que el runner global esté
offline. La UI actual contiene todos estos datos, pero no mantiene siempre esa jerarquía.

Principios de evolución:

1. **Estado antes que historial.** La fase actual y la siguiente acción válida deben preceder a
   detalles técnicos.
2. **Una acción primaria por contexto.** Guardar, enviar, responder o reintentar no deben competir
   visualmente con archivar, copiar IDs o abrir logs.
3. **Dominio estable, instrucciones en español.** Se mantienen los nombres oficiales `Task`,
   `Project`, `Cycle`, `Delivery`, `Run`, `Question`, `Curator Spec`, `Curation` e
   `Implementation`; las acciones y ayudas se redactan consistentemente en español.
4. **Historial humano primero.** Los eventos técnicos siguen disponibles, pero se traducen a
   mensajes comprensibles y se subordinan a mensajes, Questions, revisiones y Runs.
5. **Densidad controlada.** Compactar no significa ocultar: lo vigente queda abierto y lo
   histórico o diagnóstico se revela progresivamente.

## 4. Inventario de rutas y diagnóstico por pantalla

### 4.1 Shell y navegación global

| Aspecto | Estado actual | Fricción / oportunidad |
| --- | --- | --- |
| Objetivo | Aloja navegación, versión, logout, salud API y estado del runner. | Correcto, pero la salud global y la del runner son señales visualmente próximas con significados distintos. |
| Acciones | Tasks, Projects, Automation, Notificaciones y logout. | Mezcla inglés/español; no hay rastro contextual dentro de rutas profundas. |
| Desktop | Sidebar fija de 240 px y barra superior con runner. | Buena estabilidad, pero la implementación manual duplica navegación desktop/móvil. |
| Móvil | Header, indicador compacto y Sheet lateral. | El Sheet funciona, aunque no muestra versión ni cierra explícitamente tras navegar. |
| Estados | API offline cada 30 s; runner cada 15 s. | El banner afirma que las mutaciones están deshabilitadas, pero no existe un mecanismo global que las deshabilite. |
| Accesibilidad | `nav` etiquetado, texto accesible en indicador y botón de menú. | Falta validar foco tras navegación, cierre del Sheet y zoom 200 %. |

Recomendación: consolidar ambas variantes con `Sidebar`, mantener dos señales inequívocas
(`API sin conexión` frente a `Runner sin señal`) y añadir breadcrumbs solo en detalle/creación,
aprovechando el componente ya instalado.

### 4.2 Login — `/login`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo y acciones | Inicio de sesión único, usuario/contraseña y submit. Adecuado al MVP. |
| Estados | Loading, credenciales inválidas y rate limit están diferenciados sin revelar existencia de usuario. |
| Navegación | Conserva de forma segura path, query y hash de la URL original. |
| Responsive | Card centrada de ancho limitado; no hay overflow previsible a 360 px. |
| Accesibilidad | Labels, autocomplete, errores asociados y botón deshabilitado durante request. |
| Fricción | El error no muestra Request ID; es correcto para credenciales, pero un fallo inesperado de red se presenta como credencial incorrecta. |

Recomendación: distinguir “no se puede contactar con AIWS” de la respuesta 401, manteniendo el
mensaje genérico para credenciales.

### 4.3 Projects — `/projects`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Inventario local y gestionado con filtros provider/scope/archivo. |
| Información | Desktop muestra ruta, provider, scope y fecha; móvil compacta la misma información. |
| Navegación | Filtros sobreviven reload mediante query string; crear y abrir Project son directos. |
| Estados | Loading, error, vacío y “Cargar más”. |
| Responsive | Tabla desde `md`; tarjetas en móvil, con rutas largas usando `break-all`. |
| Fricciones | No muestra `repositoryMode`; filtros aplicados no se resumen; labels mezclan español e inglés; “Cargar más” pierde orientación de página. |

Recomendación: separar visualmente Local/Gestionado, mostrar filtros activos y reservar la acción
primaria para crear/importar según el contexto, sin convertir la lista en dashboard.

### 4.4 Crear Project — `/projects/new`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo y acciones | Registra un Project local; el import gestionado vive en Automation. |
| Validación | Name, descripción, ruta, provider y scope; errores de servidor junto al campo. |
| Estados | Pending y error global; botón no se bloquea por validez hasta submit. |
| Accesibilidad | Labels reales en el formulario principal. |
| Fricciones | La bifurcación “crear local / importar gestionado” solo se descubre navegando a Automation; copy mixto; no hay prevención de pérdida de cambios. |

Recomendación: mantener dos rutas de dominio existentes pero explicarlas como elecciones hermanas:
“Registrar repositorio local” y enlace “Importar desde GitHub” hacia Automation.

### 4.5 Detalle de Project — `/projects/:projectId`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Editar inventario, archivar/restaurar, configurar automatización y ver Tasks. |
| Variantes | Los campos de repositorio gestionado quedan deshabilitados; los archivados son read-only. |
| Estados | Errores de carga/guardado/archivo, enlace a Tasks activas si no se puede archivar. |
| Información | Formulario general, estado de archivo, gran tarjeta de Automation y Tasks activas. |
| Responsive | Grids adaptativos, pero la página crece mucho y las áreas no tienen navegación interna. |
| Fricciones | “Automatización de implementación” contiene también Curation, Base Branch e infraestructura; los controles carecen de dirty state; varios `FieldLabel` no están enlazados a su Select/Input; la lista de Tasks ignora `nextCursor`. |

Recomendación: tres secciones inequívocas: “Repositorio”, “Curation” e “Implementation e
infraestructura”. Mantener `maxConcurrency` como dato compartido y explicar la dependencia de cada
perfil antes de permitir activar o enviar.

### 4.6 Tasks — `/tasks`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Cola general y filtros compartibles para curator/implementador. |
| Información | Title, ID, Project, estado, versión, indicador PR y actualización. |
| Estados | Loading, vacío, error y paginación incremental. |
| Responsive | Tabla desde `lg`, cards debajo; el E2E comprueba ausencia de overflow. |
| Navegación | Query string estable, pero el formulario conserva un draft separado de la URL. |
| Fricciones | Seis estados ocupan una fila completa; no hay chips de filtros activos; back/forward puede dejar el draft visual fuera de sincronía con la URL; `curating` carece de estilo; ID se muestra pero no se copia desde la lista; PR y versión comparten texto débil. |

Recomendación: filtros básicos siempre visibles y avanzados colapsables, resumen de filtros
activos, filas de cola más escaneables y estado/Cycle/PR como metadatos diferenciados.

### 4.7 Crear Task — `/tasks/new`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Crear Draft, elegir rama en managed y preparar hasta diez Attachments. |
| Variantes | Project local sin rama; managed carga catálogo de ramas y bloquea submit si falla. |
| Upload | La Task se crea, navega al detalle y la cola sube secuencialmente; un fallo parcial no elimina éxitos. |
| Validación | Project, User Request, Base Branch y validación preliminar de ficheros. |
| Fricciones | El copy de inmutabilidad es incorrecto; Select de Project no escala a catálogos grandes; no hay lista individual removible de ficheros; el estado parcial solo se ve tras navegar; no hay dirty guard. |

Recomendación: corregir el contrato mental de Draft, usar Combobox cuando el catálogo lo justifique
y mostrar la cola preparada con estado por fichero antes de enviar, sin cambiar el protocolo
secuencial.

### 4.8 Task Detail — `/tasks/:taskId`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Consola operativa completa del agregado Task. |
| Estructura | Header + User Request + timeline + composer/Questions; inspector sticky con Cycle, spec, Attachments y PR. |
| Estados | Archivado, pausa, conflictos, polling, Runs activos/terminales, logs ausentes, Questions y uploads parciales. |
| Responsive | Una columna en móvil; inspector se abre/cierra y fluye después de la timeline. |
| Accesibilidad | Choices nativos/semánticos, dialogs con foco, labels en editores y controles no comunicados solo por color. |
| Fricciones | La siguiente acción compite con archivo y edición; el inspector móvil queda tras todo el historial; spec/adjuntos/PR ocupan tarjetas equivalentes; eventos muestran `event.type` técnico; Cycle histórico usa ID crudo; Runs mezclan inglés técnico y controles; Activity existe como código muerto; el diálogo de descartar promete Draft. |

Recomendación: convertirla en una consola con tres zonas:

1. **Resumen operativo:** estado, Cycle, Project, pausa/Run activo y una acción primaria.
2. **Conversación:** mensajes, Questions, respuestas, revisiones y Runs agrupados por Cycle.
3. **Inspector:** spec vigente, Delivery/PR, Attachments y diagnóstico bajo revelado progresivo.

En móvil, el resumen y los bloqueos deben aparecer antes de la timeline; el inspector puede ser
Sheet o acordeón por secciones, conservando acceso a todo el contenido.

#### Cobertura de estados en Task Detail

| Estado | Presentación actual | Necesidad |
| --- | --- | --- |
| Draft | Editor de petición/title y acción “Enviar a curator”. | Corregir copy de congelación y agrupar guardado/envío. |
| Curating | Polling y transición manual Ready incluso en managed. | Badge propio; Run de Curation y pausa deben dominar la siguiente acción. |
| Blocked | Questions y composer de contexto. | Questions abiertas primero, CTA “Responder”; no sugerir que contexto resuelve. |
| Ready | Claim y posible pausa/retry. | Diferenciar claim local de espera/automatización managed. |
| Implementing | Polling, Runs, cancelar y completar. | Mostrar Run activo y Delivery antes de controles secundarios. |
| Done | Composer “Solicitar cambio”, PR/Delivery. | Destacar resultado y explicar que el nuevo mensaje crea Cycle → Curating. |
| Archivada | Banner y restaurar; resto read-only. | Correcto; mantener controles históricos navegables. |

### 4.9 Automation — `/automation`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Runner, GitHub Connections, importación y Agent Profiles. |
| Acciones | Comprobar runner, conectar/revocar, elegir repos, importar, crear/activar perfiles. |
| Estados | Loading/error por bloque y catálogo con retry. |
| Responsive | Cards flexibles, pero la fila repo + scope + importar no envuelve y puede comprimir/overflow en 360 px. |
| Fricciones | Tres modelos mentales distintos en una página lineal; acciones destructivas sin confirmación; repositorios sin empty específico; Profile Form no usa React Hook Form ni errores inline; terminología muy mixta. |

Recomendación: separar visualmente “Infraestructura”, “Repositorios gestionados” y “Perfiles de
agente”; usar acciones secundarias en menú solo cuando reduzca ruido sin ocultar Conectar/Importar.

### 4.10 Notificaciones — `/notifications`

| Aspecto | Evaluación |
| --- | --- |
| Objetivo | Configuración global ntfy con token preserve/replace/clear y prueba. |
| Seguridad | Advierte privacidad, enmascara token y exige HTTPS al reemplazarlo. |
| Estados | Loading, validación, guardado, prueba 204/503 y Request ID. |
| Responsive | El E2E verifica ausencia de overflow móvil. |
| Fricciones | Checkbox expresa una activación binaria mejor modelada por Switch; “Enviar prueba” puede probar valores no guardados de forma ambigua; falta dirty state; los errores se anuncian globalmente y no siempre se asocian con `aria-describedby`. |

Recomendación: Switch con estado textual, feedback de “cambios sin guardar” y aclarar que la prueba
usa la configuración persistida actual.

### 4.11 404, redirecciones y sesión

| Caso | Estado actual | Mejora |
| --- | --- | --- |
| `/` | Redirige a `/tasks`. | Correcto. |
| Ruta protegida sin sesión | Login con `redirect` seguro. | Correcto; añadir test E2E del retorno completo. |
| 401 global posterior | El guard solo actúa al entrar; el cliente no centraliza redirección durante una pantalla ya abierta. | P1 de resiliencia: limpiar cache/sesión y volver a login conservando ruta. |
| 404 de router | Empty con vuelta a Tasks. | Añadir identidad visual del shell solo si hay sesión; no filtrar existencia de recursos. |
| 404 de recurso | `ErrorNotice` genérico. | Dar salida contextual a listado anterior sin ocultar Request ID. |

## 5. Recorridos críticos

### 5.1 Crear Project local o importar uno gestionado

```text
Projects → Crear Project local → Detalle
Automation → Conectar GitHub → Elegir repo → Importar → Detalle de Project
```

El recorrido local es directo. El gestionado está disperso entre Automation y Projects y no ofrece
un enlace de retorno explícito al Project recién importado. Debe mantenerse la separación de
endpoints, pero ambos inicios deben ser descubribles desde Projects.

### 5.2 Configurar perfiles, ramas y automatización

```text
Automation → crear/activar perfiles
Project Detail → perfil Curation + Base Branch
Project Detail → perfil Implementation + cron/timezone + activación
```

Las dependencias existen en el dominio y el Server las valida, pero la UI las presenta después de
que el usuario ya ha tomado decisiones. El rediseño debe mostrar requisitos y estado de
completitud antes de habilitar acciones.

### 5.3 Crear Draft con Attachments y enviarlo a Curation

```text
Tasks → Crear Task → cola de upload → Task Detail Draft
→ editar/guardar → enviar a curator → Curating
```

El flujo técnico es correcto. El copy actual contradice la fase Draft y puede hacer creer que la
petición no podrá corregirse tras crear. Upload parcial es recuperable, pero la continuidad visual
entre formulario y detalle depende del panel de Attachments.

### 5.4 Resolver Questions y marcar Ready

```text
Curating → Question abierta → Blocked → responder/descartar última
→ Curating → guardar spec → decisión explícita Ready
```

La UI implementa la transición conservadora y el toast correcto al responder, pero el diálogo de
descartar anuncia Draft. Ready está condicionado visualmente a spec y cero Questions, como exige
el dominio.

### 5.5 Claim, Run, logs, cancelación, retry y Delivery

```text
Ready → claim local o Run managed → Implementing
→ logs/cancelación → Ready pausada
→ retry auto/full → publishing → Done + PR
```

Toda la capacidad existe, pero las acciones aparecen por Run histórico en la timeline. El Run
activo y el fallo accionable deben resumirse arriba; los attempts terminales deben conservar logs
sin competir con la acción vigente.

### 5.6 Solicitar cambios incrementales y recorrer Cycles

```text
Done → Solicitar cambio → nuevo Cycle → Curating
Blocked → Añadir contexto → mismo Cycle y mismas Questions abiertas
```

El composer explica correctamente ambas semánticas. La timeline no traduce bien los números de
Cycles históricos y puede mostrar el ID como si fuera el número, debilitando la continuidad.

### 5.7 Archivar, restaurar y recuperar conflictos

El modo archivado es coherente y read-only. Los conflictos se resuelven de forma segura:
preservación local, copia y recarga. La recuperación está implementada por formulario, no como
patrón transversal; faltan dirty state/conflicto en Project, Automation y Notificaciones.

### 5.8 Configurar y probar notificaciones

El token cumple preserve/replace/clear y nunca se devuelve. El flujo necesita distinguir con más
claridad estado guardado, cambios locales y qué configuración se usa al probar.

## 6. Hallazgos priorizados

| ID | Sev. | Tipo | Pantalla | Evidencia | Impacto | Recomendación |
| --- | --- | --- | --- | --- | --- | --- |
| COR-01 | P1 | Corrección | Global/Tasks | `statusPresentation` no define `curating`. | Estado central sin icono/color/label traducido específico. | Añadir presentación única, textual y WCAG AA para Curating. |
| COR-02 | P1 | Corrección | Crear Task | Descripción: “inmutable después de crear”. | Contradice R-DOM-001 y desincentiva usar Draft. | “Podrás editarla en Draft; se congelará al enviarla a Curation.” |
| COR-03 | P1 | Corrección | Task Detail | Descartar última Question anuncia retorno a Draft. | Enseña una transición imposible. | Cambiar a Curating y añadir regresión E2E. |
| COR-04 | P1 | Corrección | Shell | Banner offline afirma que cambios quedan deshabilitados. | Promesa falsa; los controles siguen activos. | O deshabilitar mutaciones mediante contexto común o decir que fallarán hasta reconectar. |
| COR-05 | P1 | Corrección | Task Detail | `_ActivitySection` no se monta; eventos timeline muestran `event.type`. | Activity implementada queda desplazada y los eventos son técnicos. | Integrar traducción humana en timeline; acceso secundario a metadata segura. |
| UX-01 | P1 | UX | Task Detail | Header ofrece transición y archivo con peso similar. | La acción válida no domina la consola. | Resumen operativo con CTA primaria y menú de acciones secundarias. |
| UX-02 | P1 | UX | Task Detail móvil | Inspector aparece después de timeline completa. | Estado/Delivery/spec pueden quedar a mucho scroll. | Resumen siempre arriba; inspector en Sheet/acordeones accesibles. |
| UX-03 | P1 | UX | Task Detail | Run activo/fallo accionable vive entre historial. | Retry/cancelación difíciles de localizar. | Proyectar Run vigente arriba, conservar cards históricas compactas. |
| UX-04 | P1 | UX | Project Detail | Una tarjeta combina Curation, Implementation, rama, cron y concurrencia. | Dependencias difíciles de entender; acción guardado ambigua. | Separar por fase e infraestructura, con un único modelo dirty. |
| UX-05 | P1 | UX | Tasks | Estado de filtros en React separado de search. | Back/forward puede desincronizar controles y resultados. | Derivar/resetear draft al cambiar search y mostrar filtros aplicados. |
| UX-06 | P1 | UX | Automation | Infraestructura, conexiones, repos y perfiles son una lista lineal. | Acciones operativas dispersas. | Secciones y jerarquía; estado del runner primero solo si requiere atención. |
| UX-07 | P2 | UX | Projects/Tasks | “Cargar más” añade resultados sin orientación. | Difícil saber posición o volver a un tramo. | Evaluar Pagination sobre cursor conservando semántica API. |
| UX-08 | P1 | UX | Project Detail | Tasks consume solo primera página. | Lista incompleta sin indicación. | Añadir paginación/carga incremental o enlace explícito a listado filtrado. |
| UX-09 | P2 | UX | Crear Task | Select simple para todos los Projects/ramas. | Catálogos largos son lentos de recorrer. | Combobox con búsqueda local sobre datos ya obtenidos. |
| UX-10 | P2 | UX | Uploads | Validación preliminar solo existe al crear Task. | El detalle acepta selección obviamente inválida antes del error Server. | Reutilizar `validateFiles`, mostrar estado por fichero y límites restantes. |
| UX-11 | P2 | UX | Timeline | Cycles históricos se rotulan con ID. | El usuario pierde la secuencia incremental. | Resolver número desde items/catálogo disponible; no llamar “Cycle” al ID. |
| UX-12 | P2 | UX | Logs | NDJSON se pretty-printa como bloque único. | Diagnóstico legible solo para usuarios técnicos. | Scroll Area, filas por evento y raw accesible bajo detalle. |
| UX-13 | P2 | UX | Notificaciones | No se distingue configuración guardada de draft ni alcance de Test. | Resultado de prueba ambiguo. | Dirty badge, reset y texto “prueba la configuración guardada”. |
| VIS-01 | P2 | Visual | Global | Mezcla `Tasks`, `Projects`, `Automation`, `Name`, `Work`, `Other` con acciones españolas. | Producto percibido como inconsistente. | Glosario UI y matriz de copy; dominio oficial sin traducir, instrucciones en español. |
| VIS-02 | P2 | Visual | Global | Cards, bordes y botones tienen peso parecido en todas las jerarquías. | Escaneo lento en páginas densas. | Tokens de superficie/densidad y tres niveles de acción. |
| VIS-03 | P2 | Visual | Listados | ID, versión, PR y fecha compiten como texto pequeño. | Colas poco escaneables. | Metadatos agrupados, monospace solo para valores técnicos y truncado copiable. |
| A11Y-01 | P1 | A11y | Project Detail | Labels de rama, perfiles, cron, timezone y concurrencia sin `htmlFor`/id. | Nombre accesible puede depender de estructura visual. | IDs estables, `aria-describedby` y errores ligados a cada control. |
| A11Y-02 | P1 | A11y | Notificaciones/Automation | Errores visuales no siempre se asocian al campo ni se anuncian. | Usuarios de lector de pantalla pierden causa y foco. | FieldError por campo, focus al primer error y región live para resultado async. |
| A11Y-03 | P2 | A11y | Global | Sin evidencia de zoom 200 %, 360/412 y textos extremos. | Riesgo de clipping y reflow defectuoso. | Matriz Playwright/manual con longitudes máximas y zoom. |
| A11Y-04 | P2 | A11y | Overlay móvil | Sheet y dialogs tienen pruebas parciales de foco/Escape. | Regresiones posibles en nuevos overlays. | Test común de trigger → foco inicial → tab trap → Escape → retorno de foco. |
| RES-01 | P1 | Resiliencia | Global | 401 posterior a cargar no se trata de forma central. | La sesión expirada deja la vista en error local. | Interceptor 401: limpiar query cache y redirigir conservando URL. |
| RES-02 | P1 | Resiliencia | Formularios | Solo Curator Spec bloquea navegación dirty. | Pérdida de cambios en Project, Automation y Notifications. | Patrón dirty compartido; no autosave. |
| RES-03 | P2 | Resiliencia | Polling | No hay indicador de actualización ni estado stale visible. | El usuario no sabe si ve un snapshot reciente. | Mostrar “actualizado hace…” y pausar/reintentar claramente tras red. |
| RES-04 | P2 | Resiliencia | Uploads | Cola es global y recuperable en la sesión, pero su vínculo con navegación es implícito. | Fallos parciales pueden pasar desapercibidos al cambiar de zona. | Resumen persistente dentro del detalle hasta cerrar; anunciar cada fallo. |

## 7. Fundamentos visuales y de interacción

### 7.1 Tokens

Antes de mover layouts se debe documentar y probar:

| Familia | Decisión propuesta |
| --- | --- |
| Tipografía | 14 px como cuerpo operativo; 12 px solo metadata; headings 20/24/30 con line-height consistente. |
| Densidad | Controles 36 px compactos y 40 px estándar; touch target efectivo mínimo 44 px en móvil. |
| Espaciado | Escala 4/8/12/16/24/32; cards densas 16, formularios 20–24. |
| Superficies | Fondo, card primaria, sección secundaria y diagnóstico; evitar añadir borde a cada agrupación. |
| Estado | Cada estado combina texto, icono y contraste; nunca solo color. |
| Focus | Ring de 2 px con separación y contraste AA sobre fondo/card/accent. |
| Acciones | Primaria única; secundaria outline/ghost; destructiva separada y confirmada. |
| Anchura | Texto largo 70–80 caracteres; logs/spec pueden usar todo el panel con scroll controlado. |

No se recomienda añadir dark mode ni selector de densidad: ambos están fuera de alcance.

### 7.2 Terminología UI

| Mantener como dominio | Redactar en español |
| --- | --- |
| Project, Task, Cycle, Delivery, Run, Question | Crear, guardar, archivar, restaurar, responder, descartar, reabrir |
| Draft, Curating, Blocked, Ready, Implementing, Done | Ayudas que expliquen cada estado |
| Curation, Implementation, Curator Spec, Base Branch | Frases y validaciones alrededor del término |
| GitHub, Codex, ntfy, PR | Estado operativo y acciones |

Evitar variantes como `Spec revision`, `attempt`, `Auth mode`, `Name`, `Work`, `Other`,
`private`, `Retry` y `Branch` cuando no son valores literales de contrato.

### 7.3 Patrón de estados de pantalla

Todas las regiones con datos deben usar la misma secuencia:

1. Skeleton con geometría aproximada.
2. Contenido o vacío accionable.
3. Error con mensaje, Request ID y retry manual cuando sea seguro.
4. Offline/stale sin borrar el último contenido válido.
5. Mutación pending que bloquea solo controles incompatibles.
6. Éxito anunciado y reflejado en la misma región.
7. `version_conflict` que conserva borrador y ofrece copiar/recargar.

## 8. Inventario shadcn/ui

### 8.1 Reconciliación del catálogo

La página oficial consultada enumera **63 componentes**, no los 64 anticipados en el plan previo.
El inventario local contiene **24 archivos**:

- 19 importados directamente desde páginas o componentes comunes.
- `sonner`, usado por el bootstrap en `main.tsx`; el catálogo vigente muestra `Toast` y ya no lista
  `Sonner` como entrada independiente.
- `label` y `separator`, dependencias transitivas de `field`.
- `breadcrumb` y `spinner`, sin consumidor.

Por tanto, una búsqueda superficial produce cinco archivos sin consumidor directo de
página/common (`breadcrumb`, `label`, `separator`, `sonner`, `spinner`), pero el análisis de
alcanzabilidad reduce los realmente huérfanos a dos. No se recomienda eliminarlos dentro de esta
review: `breadcrumb` es candidato inmediato y `spinner` puede sustituir indicadores ad hoc.

### 8.2 Clasificación completa del catálogo oficial

| Clasificación | Componentes | Decisión |
| --- | --- | --- |
| Usado (21) | Alert, Alert Dialog, Badge, Button, Card, Checkbox, Dialog, Empty, Field, Input, Label, Progress, Radio Group, Select, Separator, Sheet, Skeleton, Table, Tabs, Textarea, Tooltip | Mantener; normalizar patrones y evitar wrappers nuevos innecesarios. |
| Instalado sin uso (2) | Breadcrumb, Spinner | Breadcrumb se activa en rutas profundas; Spinner solo si reemplaza loaders inline. |
| Candidato justificado (15) | Accordion, Attachment, Button Group, Collapsible, Combobox, Command, Dropdown Menu, Input Group, Item, Message, Message Scroller, Pagination, Scroll Area, Sidebar, Switch | Evaluar por hallazgo y lote; no instalar en bloque. |
| No aplicable al MVP (25) | Aspect Ratio, Avatar, Bubble, Calendar, Carousel, Chart, Context Menu, Data Table, Date Picker, Direction, Drawer, Hover Card, Input OTP, Kbd, Marker, Menubar, Native Select, Navigation Menu, Popover, Resizable, Slider, Toast, Toggle, Toggle Group, Typography | No resuelven un problema demostrado o sugieren funcionalidad fuera de alcance. |

`Sonner` queda fuera de los 63 porque no aparece como componente independiente en el catálogo
vigente, aunque el wrapper local se usa y debe conservarse hasta una decisión explícita.

### 8.3 Candidatos y problema concreto

| Componente | Aplicación posible | Condición de adopción |
| --- | --- | --- |
| Sidebar | Unificar navegación desktop/móvil, estado activo, footer y colapso. | Mantener el mismo mapa de rutas y verificar foco/Sheet móvil. |
| Combobox + Command | Projects, ramas, repositorios y perfiles extensos. | Búsqueda local o sobre resultados ya contratados; no añadir búsqueda global/API. |
| Dropdown Menu | Archivo, copia y acciones secundarias en filas/header. | Nunca ocultar CTA primaria, responder Questions, Retry crítico o restaurar. |
| Collapsible / Accordion | Filtros avanzados, diagnóstico, snapshots y secciones del inspector móvil. | Estado abierto accesible y contenido crítico visible por defecto. |
| Scroll Area | Logs y regiones largas con altura acotada. | No crear scroll anidado para la timeline principal. |
| Pagination | Sustituir “Cargar más” donde mejore orientación. | Debe mapear cursores sin inventar total o número absoluto de páginas. |
| Switch | Activación de notificaciones e Implementation. | Label y estado textual; no usar para acciones con side effects ambiguos. |
| Input Group | URL + copiar/abrir, PR y valores técnicos. | Preservar label/error y targets móviles. |
| Button Group | Guardar/limpiar PR o acciones estrechamente relacionadas. | No agrupar destructivas con la CTA principal. |
| Attachment | Cola y metadata de ficheros. | Validar que soporta estados pending/uploaded/failed y acciones actuales. |
| Item | Filas de repositorios, perfiles y Attachments en móvil. | Debe mejorar truncado y semántica, no solo apariencia. |
| Message | Mensajes/contexto/revisiones en timeline. | Adaptar a dominio; no convertir AIWS en chat genérico. |
| Message Scroller | Mantener posición al paginar/actualizar timeline. | Solo si respeta paginación hacia atrás y no fuerza autoscroll al leer historia. |

No se instalarán componentes comunitarios ni el catálogo completo.

## 9. Backlog ejecutable

**Estado de cierre:** cerrado e implementado. Los criterios originales se conservan a continuación
como registro de aceptación; ya no representan trabajo pendiente.

| Lote | Rango | Resultado |
| --- | --- | --- |
| A — Corrección y fundamentos | UI-001–UI-005 | Completado y verificado |
| B — Shell, navegación y listados | UI-006–UI-011 | Completado y verificado |
| C — Formularios y configuración | UI-012–UI-018 | Completado y verificado |
| D — Task Detail como consola operativa | UI-019–UI-025 | Completado y verificado |
| E — Accesibilidad y resiliencia | UI-026–UI-030 | Completado y verificado |

Cada lote debía dejar `main` verificable. Se mantuvo un único lote en progreso y se respetó el
orden indicado.

### Lote A — Corrección y fundamentos

| Orden | ID | Sev. | Cambio | Criterio observable de aceptación | Dependencias |
| ---: | --- | --- | --- | --- | --- |
| 1 | UI-001 | P1 | Corregir badge de Curating y matriz de estados. | Draft/Curating/Blocked/Ready/Implementing/Done tienen texto, icono y contraste propios en lista y detalle; test E2E cubre Curating. | Ninguna. |
| 2 | UI-002 | P1 | Corregir copy de inmutabilidad y retorno de Question. | Crear Task dice que User Request se congela al enviar a Curation; descartar la última Question dice Curating; assertions E2E. | UI-001. |
| 3 | UI-003 | P2 | Aprobar glosario de copy UI. | No quedan labels accidentales `Name`, `Work`, `Other`, `Retry`, `attempt` o `Spec revision`; valores de dominio permanecen intactos. | UI-002. |
| 4 | UI-004 | P2 | Definir tokens de tipografía, espacio, densidad, focus y superficies. | Story/checklist de tokens en 360/412/1280/1440 y contraste AA documentado; no cambia tema. | UI-003. |
| 5 | UI-005 | P1 | Patrón común de error/Request ID/401/offline. | 401 limpia sesión y vuelve a login con redirect; offline conserva contenido y el copy coincide con controles realmente disponibles. | UI-004. |

### Lote B — Shell, navegación y listados

| Orden | ID | Sev. | Cambio | Criterio observable de aceptación | Dependencias |
| ---: | --- | --- | --- | --- | --- |
| 6 | UI-006 | P1 | Consolidar shell responsive con Sidebar. | Mismas cuatro rutas y logout; navegación activa; versión; runner; menú móvil cierra y devuelve foco; sin overflow. | UI-004, UI-005. |
| 7 | UI-007 | P2 | Añadir Breadcrumb en crear/detalle. | Project/Task muestran ancestro navegable y página actual; 404 no genera ruta falsa. | UI-006. |
| 8 | UI-008 | P1 | Compactar filtros y mostrar filtros activos. | URL es fuente observable; back/forward sincroniza controles; cada filtro activo puede retirarse y “Limpiar” restaura defaults. | UI-004. |
| 9 | UI-009 | P2 | Mejorar filas de Projects/Tasks. | Estado, Project, versión/Cycle, PR y fecha conservan jerarquía a 200 % y con strings máximos; ID copiable sin desbordar. | UI-001, UI-004. |
| 10 | UI-010 | P2 | Evaluar Pagination compatible con cursor. | Avanzar/retroceder no duplica items y conserva filtros; si no puede garantizarse retroceso con contrato actual, se mantiene carga incremental con contador de resultados cargados. | UI-008. |
| 11 | UI-011 | P1 | Completar paginación de Tasks en Project Detail. | Nunca se oculta `nextCursor`; existe carga adicional o enlace inequívoco al listado completo filtrado. | UI-008, UI-010. |

### Lote C — Formularios y configuración

| Orden | ID | Sev. | Cambio | Criterio observable de aceptación | Dependencias |
| ---: | --- | --- | --- | --- | --- |
| 12 | UI-012 | P1 | Patrón compartido dirty/validación/conflicto. | Project, Automation y Notificaciones señalan cambios, bloquean salida y llevan foco al primer error; Spec conserva comportamiento. | UI-004, UI-005. |
| 13 | UI-013 | P1 | Reorganizar Project Detail por Repositorio/Curation/Implementation. | Perfil curator, Base Branch, perfil implementador, cron/timezone y concurrencia explican dependencias; Curation se guarda con Implementation off. | UI-012. |
| 14 | UI-014 | P2 | Sustituir activaciones binarias por Switch. | Estado on/off tiene label, descripción y texto; teclado Space funciona; no se guarda hasta CTA explícita. | UI-012, UI-013. |
| 15 | UI-015 | P2 | Combobox en catálogos largos. | Project/rama/repo/perfil se localizan por texto; selección cerrada; loading/error/retry intactos; sin endpoint nuevo. | UI-013. |
| 16 | UI-016 | P1 | Hacer consistente el flujo de Attachments. | Crear y detalle comparten validación preliminar; cada fichero muestra pending/uploaded/failed; retry solo reenvía fallidos; éxito parcial permanece. | UI-012. |
| 17 | UI-017 | P1 | Reorganizar Automation. | Runner, Connections/repos y Agent Profiles son regiones con headings; fila repo refluye a 360 px; revocar confirma; errores son inline. | UI-012, UI-015. |
| 18 | UI-018 | P2 | Aclarar configuración/prueba ntfy. | Dirty state visible; “Enviar prueba” indica que usa settings guardados; preserve/replace/clear siguen cubiertos; Request ID accesible. | UI-012, UI-014. |

### Lote D — Task Detail como consola operativa

| Orden | ID | Sev. | Cambio | Criterio observable de aceptación | Dependencias |
| ---: | --- | --- | --- | --- | --- |
| 19 | UI-019 | P1 | Nuevo resumen operativo de Task. | Estado, Project, Cycle, pausa, Run activo y siguiente CTA aparecen antes del historial en desktop/móvil; archivar queda secundario. | Lotes A–C. |
| 20 | UI-020 | P1 | Reestructurar timeline por Cycle y tipo. | Cada Cycle muestra número; mensajes, Questions, revisiones, Runs y eventos se distinguen sin depender solo del color; items históricos son read-only. | UI-019. |
| 21 | UI-021 | P1 | Traducir Activity/eventos técnicos. | Ningún `event.type` crudo aparece por defecto; actor, transición, motivo y fecha son legibles; metadata segura queda bajo detalle. | UI-020. |
| 22 | UI-022 | P1 | Priorizar Questions abiertas y respuesta. | En Blocked, Questions abiertas y CTA Responder preceden a contexto; resolver última muestra Curating y nunca Ready/Draft. | UI-020. |
| 23 | UI-023 | P1 | Resumir Run activo/fallo y compactar attempts. | Cancelar/Retry vigente se encuentra sin recorrer historia; logs de attempts previos siguen accesibles; Curation no muestra rama/publishing. | UI-020. |
| 24 | UI-024 | P2 | Inspector progresivo y móvil. | Spec vigente, Delivery/PR, Attachments y diagnóstico son accesibles con teclado; móvil no exige llegar al final de timeline; no hay scroll horizontal. | UI-019, UI-020. |
| 25 | UI-025 | P2 | Mejorar logs con Scroll Area. | Inicio/ausencia/stream/terminal se diferencian; eventos se leen por fila; raw NDJSON sigue disponible; polling 3 s termina al estado terminal. | UI-023, UI-024. |

### Lote E — Accesibilidad y resiliencia

| Orden | ID | Sev. | Cambio | Criterio observable de aceptación | Dependencias |
| ---: | --- | --- | --- | --- | --- |
| 26 | UI-026 | P1 | Auditar nombres, descripción y foco de formularios. | Cada control tiene nombre; error usa `aria-describedby`; primer inválido recibe foco; resultados async se anuncian sin duplicación. | Lotes B–D. |
| 27 | UI-027 | P1 | Auditar overlays. | Dialog, AlertDialog, Sheet, Dropdown y Combobox soportan trigger, foco inicial, Tab/Shift+Tab, Escape y retorno al trigger. | UI-026. |
| 28 | UI-028 | P1 | Estados offline/stale/polling. | Pérdida de red conserva snapshot, indica antigüedad, permite retry y no duplica mutaciones; reconexión actualiza Task/timeline. | UI-005, UI-019. |
| 29 | UI-029 | P2 | Matriz de contenido extremo y reflow. | 360/412/1280/1440, zoom 200 %, IDs, branches, URLs, filenames y texto máximo no producen clipping ni scroll horizontal global. | UI-026, UI-027. |
| 30 | UI-030 | P1 | Completar regresión Playwright. | Nuevos casos descritos en §10 pasan en desktop/móvil; los 12 tests Web y 36 escenarios base siguen verdes. | UI-001–UI-029 según caso. |

## 10. Plan de verificación

### 10.1 Viewports y contenido

Cada lote visual se verifica al menos en:

- 360 × 800 y 412 × 915.
- 1280 × 800 y 1440 × 900.
- Zoom del navegador al 200 %.
- Nombres, IDs, ramas, URLs y filenames en longitud máxima razonable.
- User Request, Question, spec, logs y mensajes multilínea extensos.

### 10.2 Matriz de estados

Fixtures visuales/E2E deben cubrir:

- Task: Draft, Curating, Blocked, Ready, Implementing, Done y archivada.
- Question: open text/single/multiple, answered, dismissed, histórica y reabierta.
- Run por kind: queued, preparing, running, publishing solo Implementation, succeeded, failed,
  cancelled, sin logs, logs parciales y checkpoint publishing.
- Project: local, managed, archivado, perfiles faltantes/deshabilitados, ramas loading/error.
- Global: API online/offline, runner unknown/online/offline, sesión expirada.
- Configuración: ntfy sin token, preserve, replace, clear, error de prueba y dirty.

### 10.3 Backlog de pruebas Playwright

| Caso | Assertions mínimas |
| --- | --- |
| Curating | Badge específico en lista/detalle; copy de congelación correcto. |
| Filtros | Chips activos, URL, reload, back/forward y limpieza predecible. |
| Task Detail | CTA primaria por estado, Run activo, Questions abiertas e inspector móvil. |
| Dirty/conflicto | Project, Automation, Notifications y Spec conservan borrador; copiar/recargar. |
| Overlays | Teclado completo, Escape, trap y retorno de foco. |
| Textos extremos | Sin overflow global en cuatro viewports y 200 %. |
| Offline/polling | Snapshot stale, retry, reconexión y ausencia de duplicados. |
| Upload parcial | Éxitos conservados, fallos por fichero y retry solo de fallidos. |
| Sesión expirada | 401 limpia cache, login conserva URL y vuelve al detalle. |
| Cycles/Runs | Número de Cycle, historial read-only, logs parciales, cancel y Retry. |

### 10.4 Gates por lote

```bash
bun run format:check
bun run lint
bun run typecheck
bun test apps/web/test/web.test.ts
bun run --cwd apps/web test:e2e
bun run build
```

Cuando un lote toque contrato, cosa no prevista por este informe, debe detenerse y actualizar
simultáneamente docs, OpenAPI, cliente y tests según el pack. No se debe reinterpretar silenciosamente
un límite del API para obtener una mejora visual.

### 10.5 Evidencia final de cierre

La ejecución final consolidada del 25 de julio de 2026 registró:

- Formato correcto en 180 archivos.
- Lint y reglas de arquitectura correctos en 8 workspaces.
- Typecheck correcto en 8 workspaces.
- 28 de 28 tests Web aprobados.
- 95 escenarios Playwright aprobados y 5 omitidos deliberadamente por duplicar casos de la matriz
  desktop/móvil.
- 307 de 307 tests globales aprobados.
- OpenAPI válido, con 64 operaciones.
- Build global correcto.

La verificación automatizada incluye reflow y texto al 200 %. Esta cobertura reduce el riesgo de
regresión, pero no constituye una certificación formal de accesibilidad.

## 11. Aceptación de la review

- [x] Todas las rutas Web y redirecciones están inventariadas.
- [x] Se distinguen Project local/managed y estados de Task, Question, Run y archivo.
- [x] Se recorren los flujos críticos de creación, Curation, Implementation, Cycles, recuperación,
  archivo y notificaciones.
- [x] Cada hallazgo incluye evidencia, impacto, severidad y recomendación.
- [x] El catálogo oficial vigente se reconcilia con los 24 componentes locales.
- [x] Cada entrada del backlog tiene aceptación observable, dependencias y orden.
- [x] El plan de prueba cubre desktop, móvil, 200 %, teclado, errores, polling y uploads.
- [x] No se proponen cambios de contrato ni funcionalidades fuera del MVP.

## 12. Cambios de contrato y limitaciones

**Cambios de contrato:** ninguno. El informe no modifica OpenAPI, SQL, Core, API client ni tipos
públicos.

**Limitaciones de la review:**

- Queda pendiente únicamente una validación manual con datos reales representativos y lector de
  pantalla.
- El build muestra un aviso no bloqueante por un chunk Web de aproximadamente 535 kB. Su
  optimización no formó parte de UI-001–UI-030 y requeriría trabajo separado.
- Reflow y texto al 200 % tienen cobertura automatizada, sin que ello constituya una certificación
  formal de accesibilidad.

Se confirma explícitamente que el cierre no añade funciones fuera del MVP de AIWS, no abre un Lote
F ni crea un hito adicional.
