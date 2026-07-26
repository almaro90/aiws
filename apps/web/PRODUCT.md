# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

AIWS sirve a una única persona administradora que opera una instalación privada desde la Web y a
curators e implementadores —humanos o agentes— que colaboran mediante la misma API y el CLI. La
persona administradora necesita leer deprisa estados técnicos y de negocio, responder bloqueos,
revisar especificaciones y mantener la continuidad del trabajo tanto en escritorio como en móvil.

## Product Purpose

AIWS convierte una petición original en trabajo implementable y verificable. Conserva por separado
la intención del usuario, la Curation, las Questions, los Cycles, los Runs y la Delivery Git, para
que personas y agentes puedan continuar el trabajo sin perder contexto ni confundir el estado de
negocio con el intento técnico vigente.

El éxito consiste en que la siguiente acción válida, el bloqueo actual y la evidencia disponible
sean inequívocos, y en que cada mutación conserve concurrencia, historial y trazabilidad.

## Positioning

AIWS no es un gestor de tareas generalista ni un dashboard de métricas. Su mecanismo distintivo es
un agregado Task versionado y preparado para agentes: petición original preservada, preguntas
estructuradas, especificación explícita, ciclos incrementales, ejecución aislada y evidencia de
entrega verificable.

## Operating Context

- La Web es una SPA privada que consume exclusivamente la API HTTP de AIWS.
- La persona operadora alterna entre la bandeja Necesita atención, listas de Tasks y Projects, la
  consola completa de una Task, configuración de automatización y notificaciones.
- Task, Cycle y Delivery son capas distintas. Run representa un intento técnico, no el estado de la
  Task.
- La interfaz debe soportar estados de carga, vacío, error, conflicto, sesión expirada, pérdida de
  conectividad y polling sin descartar el contenido local.
- Los flujos principales se usan en escritorio, pero deben seguir siendo completos a 360 px y con
  zoom del 200 %.

## Capabilities and Constraints

- Mantener los nombres de dominio `Task`, `Project`, `Cycle`, `Delivery`, `Run`, `Question`,
  `Curator Spec`, `Curation` e `Implementation`; redactar acciones y ayudas en español.
- Una Task solo entra en Ready mediante una decisión explícita y toda mutación del agregado respeta
  `expectedVersion`.
- Web y CLI nunca acceden directamente a SQLite ni al filesystem de datos.
- No introducir dashboard, Kanban, búsqueda global, prioridades, etiquetas, comentarios genéricos,
  WebSockets, previews avanzadas de Attachments ni otras funciones fuera del MVP.
- No modificar OpenAPI, SQL, Core ni tipos públicos como consecuencia de una mejora visual.
- El sistema es funcional antes que decorativo, accesible por teclado y explícito ante errores.

## Brand Commitments

- El producto se llama AIWS y utiliza el logotipo existente en `public/aiws-logo.png`.
- La voz es sobria, directa y operativa: explica estado, consecuencia y siguiente acción sin
  lenguaje promocional.
- Deben preservarse la identidad técnica vigente, las esquinas rectas, la tipografía Oxanium y el
  tema claro existente.

## Evidence on Hand

- `PRD.md` y `docs/01-domain-model.md` contienen la verdad de producto y sus invariantes.
- `docs/06-web.md` define las pantallas, estados y recorridos Web.
- `docs/12-ui-ux-review.md` registra una revisión completa ya implementada y sus criterios de
  aceptación.
- `apps/web/src/styles.css` y `apps/web/src/components/ui/` son la autoridad visual implementada.
- `apps/web/e2e/ui.playwright.ts` contiene fixtures y cobertura desktop/móvil representativa.
- No existen testimonios, claims comerciales ni métricas externas que la interfaz deba inventar.

## Product Principles

1. Estado antes que historial.
2. Una acción primaria por contexto.
3. Dominio estable, instrucciones comprensibles.
4. Historial humano antes que diagnóstico técnico.
5. Densidad controlada sin ocultar información vigente.

## Accessibility & Inclusion

La Web debe ser operable por teclado, conservar nombres y descripciones accesibles, gestionar el
foco en overlays y formularios, no depender solo del color y mantener reflow sin scroll horizontal
global a 360 px y con zoom del 200 %. La cobertura automatizada reduce regresiones, pero no se
presenta como certificación formal de accesibilidad.
