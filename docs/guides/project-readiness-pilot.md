# Playbook protegido de Project Readiness

Este playbook valida un Project gestionado real en GitHub o Azure DevOps antes del primer piloto.
Es una operación manual protegida: requiere una Connection autorizada, un runner online y acceso
del operador al Project. No forma parte de CI y no debe ejecutarse con credenciales de producción
en un entorno no controlado.

## Preparación común

1. Confirma que AIWS Server y runner-manager están saludables.
2. Importa el repositorio mediante una Connection activa.
3. Selecciona Base Branch, Curation Agent Profile e Implementation Agent Profile.
4. Conserva únicamente el `projectId`; no copies tokens, URLs con credenciales ni logs completos.
5. Ejecuta primero el diagnóstico estándar, que puede usar el entorno aislado del catálogo para
   validar la autenticación de modelo pero no realiza el probe dedicado de infraestructura:

   ```bash
   aiws --json project doctor PROJECT_ID
   ```

6. Revisa los checks en el orden devuelto. Corrige Connections revocadas, ramas inexistentes,
   perfiles desactivados o runner offline antes de continuar.
7. Ejecuta el diagnóstico profundo desde un terminal controlado:

   ```bash
   aiws --json project doctor PROJECT_ID --deep
   ```

El probe profundo crea y elimina contenedores efímeros. Un resultado no preparado termina con
código `6`; un error de transporte o autenticación conserva los códigos generales del CLI.

## GitHub

- Usa una GitHub App instalada para el repositorio seleccionado.
- Verifica que el repositorio y la Base Branch aparecen por la misma Connection usada al importar.
- Ejecuta ambos comandos y registra solo: fecha, Project, profundidad, resultado global, IDs y
  estados de checks. No archives detalles del provider que puedan contener datos sensibles.

## Azure DevOps

- Completa la autorización Entra y selecciona organización antes de importar el repositorio.
- Verifica que la identidad conserva acceso al proyecto Azure y a la Base Branch.
- Ejecuta los mismos comandos y conserva la misma evidencia segura que para GitHub.

## Evidencia de aceptación

Para cada provider, el piloto queda aceptado cuando:

- el informe estándar y el profundo devuelven el mismo conjunto provider-neutral de checks;
- todos los checks obligatorios terminan en `pass`;
- no se crea ninguna Task, Run o fila de diagnóstico;
- el runner no conserva el contenedor ni el workspace efímero;
- revocar temporalmente la Connection produce un fallo seguro sin exponer credenciales.

Si un fallo deja recursos efímeros, detén el piloto y registra el incidente sin incluir secretos.
