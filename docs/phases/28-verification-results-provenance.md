# Hito 28 — Verification Results y provenance

## Resultado

AIWS verifica por sí mismo un commit local concreto y conserva evidencia inmutable de su producción.

## Workflow

`Agent → commit local → verifying → publishing → succeeded`

- Runner-manager ejecuta el contrato capturado sobre `headSha`.
- Cada comando registra argv exacto, inicio/fin, duración, exit code, obligatoriedad, estado, motivo
  seguro de omisión, identidad de toolchain/imagen y fragmentos limitados/redactados.
- Un fallo obligatorio termina `verification_failed`, devuelve Task a Ready, pausa automatización y
  conserva workspace, commit y resultados.
- El waiver exige versión esperada y motivo; crea attempt enlazado y no reescribe el Run fallido.
- Fallos opcionales son warnings y permiten publicar.

## Provenance

Un registro por Run captura versión de esquema, AIWS/Codex, modelo/effort, digest de imagen,
recursos/red, base/head SHA, rama, versión/hash del prompt builder, revisión de spec, Attachments con
hashes, revisión del Verification Contract y resultado de publicación.

## Aceptación

- Required/optional pass, fail, timeout, spawn error, cancelación, truncado y redacción.
- Workspace ausente, sucio o divergente rechaza waiver.
- Full retry, publish-only y waiver producen attempts enlazados inequívocos.
- Sin secretos ni rutas físicas de Attachments.
