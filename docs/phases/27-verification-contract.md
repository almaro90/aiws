# Hito 27 — Verification Contract

## Resultado

Cada Project puede definir los comandos exactos que usarán futuros Runs de Implementation.

## Dominio

- Contrato opcional, versionado, append-only y propiedad del Project.
- Cada Run captura la revisión activa al claim.
- Comandos ordenados con `name`, `executable`, `args`, `required` y `timeoutSeconds`.
- Nombres únicos, máximo 20 y timeout entre 1 y 3600 segundos.
- Ejecución desde root del repositorio mediante argv, sin shell, entorno personalizado ni working
  directory alternativo.
- Actualizar crea revisión; desactivar retira la activa sin borrar historia.
- Sin overrides por Task o Delivery.
- Ausencia produce evidencia `not_configured` y permite publicación.

## Superficies

- Consultar contrato vigente e historial.
- Reemplazar o desactivar con revisión esperada.
- Configuración Web de Project y comandos CLI JSON equivalentes.

## Aceptación

- Crear, reemplazar, desactivar, conflicto, argv inválido, nombres duplicados, límites y timeout.
- Un Run queued conserva su revisión tras cambiar Project.
- Revisiones históricas inmutables y sin valores secretos configurables.
