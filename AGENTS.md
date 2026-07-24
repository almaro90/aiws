# AGENTS.md — Instrucciones de implementación de AIWS

Estas instrucciones se aplican a todo el repositorio.

## Misión

Implementar AIWS MVP v0.1 exactamente según este implementation pack.

No ampliar el producto con funcionalidades fuera de alcance aunque parezcan útiles.

## Lectura obligatoria

Antes de modificar código:

1. Leer `PRD.md`.
2. Leer todos los documentos de `docs/`.
3. Revisar `docs/contracts/openapi.yaml`.
4. Revisar `docs/database/0001_initial.sql`.
5. Identificar el hito activo en `docs/09-implementation-plan.md`.

## Orden de precedencia

1. Invariantes de `docs/01-domain-model.md`.
2. Requisitos y aceptación de `PRD.md`.
3. OpenAPI y SQL machine-readable.
4. Especificaciones técnicas.
5. Plan de implementación.

Ante una contradicción no resoluble mediante esta precedencia:

- No inventar.
- No implementar una interpretación silenciosa.
- Registrar la contradicción y pedir decisión.

## Restricciones de arquitectura

- Bun es runtime y package manager.
- Hono expone la API.
- Zod valida los contratos.
- SQLite se accede directamente mediante `bun:sqlite`.
- No añadir ORM.
- Web y CLI nunca acceden directamente a SQLite ni al filesystem de datos.
- Core no importa Hono, SQLite, React, Commander ni APIs de filesystem.
- No crear un paquete genérico `shared`.
- No añadir servicios externos.
- No sustituir OpenAPI por RPC.

## Reglas de implementación

- Implementar por hitos, en el orden documentado.
- Mantener un único hito en progreso.
- No comenzar Web antes de que Core, SQLite, API y CLI del vertical slice estén verificados.
- Toda mutación del agregado Task requiere `expectedVersion`.
- Toda mutación del agregado incrementa la versión exactamente una vez.
- Mutación y TaskEvents se guardan en una transacción.
- `userRequest` es inmutable.
- Ready nunca se asigna automáticamente.
- No usar borrado físico para Projects o Tasks.
- No exponer rutas físicas de Attachments.
- No registrar contraseñas, tokens, cookies, contenido completo de specs ni bytes de adjuntos.

## Contratos

- JSON en camelCase.
- SQL en snake_case.
- Fechas UTC RFC 3339 con milisegundos.
- IDs con prefijo y ULID.
- Errores con el envelope documentado.
- El OpenAPI generado debe compararse en CI con el snapshot.
- Los cambios de contrato requieren actualizar simultáneamente docs y tests.

## Dependencias

No añadir una dependencia si:

- La plataforma o una dependencia ya elegida resuelve el problema.
- Solo evita escribir una función pequeña y estable.
- Introduce un runtime o servicio adicional.

Toda dependencia nueva debe:

- Ser compatible con Bun.
- Estar fijada en lockfile.
- Tener una razón clara dentro del alcance.

## Calidad

Antes de cerrar cada hito:

1. Formatear.
2. Ejecutar lint.
3. Ejecutar typecheck.
4. Ejecutar tests unitarios.
5. Ejecutar tests de integración afectados.
6. Verificar criterios de aceptación del hito.
7. Actualizar documentación si cambió un contrato.

No se considera terminado un comportamiento sin tests de éxito y error.

## Seguridad

- Canonicalizar rutas con `realpath`.
- Verificar que el resultado permanece bajo un root permitido.
- Rechazar symlinks que escapen de roots.
- Usar queries parametrizadas.
- Sanear Markdown antes de renderizar HTML.
- Tratar nombres y MIME de uploads como datos no confiables.
- Hacer comparaciones de secretos en tiempo constante.
- Aplicar comprobación de Origin a autenticación por cookie.

## Entrega

La entrega final debe incluir:

- Resumen por hito.
- Comandos de verificación ejecutados.
- Resultado de tests.
- Cambios de contrato.
- Limitaciones conocidas dentro del alcance.
- Confirmación explícita de que no se añadieron funciones fuera del MVP.

