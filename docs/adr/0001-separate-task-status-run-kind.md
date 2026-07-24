# Separar Task Status, Run Kind y aplicación del resultado

AIWS representa la fase de negocio en `Task Status` y el propósito de cada intento gestionado en `Run Kind`, en vez de añadir estados técnicos de ejecución a la Task. El agente de curation devuelve una salida estructurada sin autoridad para mutar AIWS; el manager valida y aplica título, spec, Questions, estado, eventos y versión en una sola transacción. Esta separación permite que una Task permanezca Curating durante reintentos o fallos técnicos, evita exponer credenciales al agente y descarta resultados obsoletos sin cambios parciales.

## Consequences

- Los intentos se numeran por Task y Run Kind y comparten el límite de concurrencia del Project.
- Curation no necesita rama ni publicación; Implementation conserva rama y pull request.
- Un cambio concurrente invalida la versión capturada por el Run antes de aplicar su resultado.
