# 06 — Web

## 1. Principios

- SPA privada y mobile-friendly.
- Funcional antes que dashboard.
- Misma API que el CLI.
- Sin lógica de dominio duplicada.
- Accesible por teclado.
- Estados de carga, vacío, error y conflicto explícitos.

## 2. Rutas

| Ruta | Pantalla |
| --- | --- |
| `/login` | Login |
| `/projects` | Lista de Projects |
| `/projects/new` | Crear Project |
| `/projects/:projectId` | Detalle/edición de Project y sus Tasks |
| `/tasks` | Lista y filtros de Tasks |
| `/tasks/new` | Crear Task |
| `/tasks/:taskId` | Detalle completo |
| `/notifications` | Configuración global ntfy |

No existe una home/dashboard separada. `/` redirige a `/tasks`.

## 3. Shell

Navegación:

- Tasks.
- Projects.
- Notificaciones.
- Logout.

Debe mostrar:

- Conectividad/API error global.
- Versión de aplicación en un área secundaria.
- Layout responsive.

No muestra selector de workspace, usuario o organización.

## 4. Login

Campos:

- Usuario.
- Contraseña.

Comportamiento:

- Submit deshabilitado durante request.
- Mensaje genérico para credenciales incorrectas.
- No indicar si el usuario existe.
- Redirigir a la URL original tras login.
- No guardar password.
- Tras 401 global, limpiar sesión y volver a login.

## 5. Projects

### Lista

Columnas:

- Nombre.
- Repository path.
- Git provider.
- Account scope.
- Updated at.

Controles:

- Crear.
- Filtro provider.
- Filtro scope.
- Mostrar archivados.
- Paginación “Cargar más”.

### Formulario

Campos:

- Name.
- Description.
- Repository path.
- Git provider.
- Account scope.

Validación cliente equivalente al contrato, pero Server siempre vuelve a validar.

### Detalle

- Datos y edición.
- Estado archivado.
- Archive/unarchive.
- Lista de Tasks del Project.

Si archive falla por Tasks activas, mostrar enlace/filtro a esas Tasks.

## 6. Tasks list

Controles:

- Crear Task.
- Project.
- Uno o varios statuses.
- Account scope.
- Git provider.
- Mostrar archivadas.
- Sort y order.

Cada fila/card:

- ID completo copiable.
- Title.
- Project.
- Status.
- Version.
- PR indicator.
- Updated at.

Defaults iguales a API.

Las URLs deben reflejar filtros en query string para poder compartir/recargar la vista.

## 7. Create Task

Campos:

- Project requerido.
- Title opcional.
- User Request requerido.
- Attachments opcionales con selección múltiple.

Flujo:

1. Crear Task.
2. Navegar al detalle.
3. Subir adjuntos secuencialmente usando la versión devuelta.
4. Mostrar progreso por fichero.
5. Si un upload falla, mantener Task y adjuntos correctos, mostrar fallo recuperable.

User Request puede editarse en el detalle mientras la Task siga Draft.

## 8. Task detail

Orden recomendado:

1. Header.
2. User Request.
3. Questions.
4. Curator Spec.
5. Attachments.
6. PR.
7. Activity.

### Header

- Title editable.
- ID copiable.
- Project con enlace.
- Status.
- Version.
- Acciones de transición válidas.
- Archive/unarchive.

Solo se muestran acciones permitidas para el estado actual, pero los errores server siguen tratándose.

### User Request

- Editable con guardado explícito en Draft.
- Read-only desde Curating.
- Preservar saltos de línea.
- No renderizar como HTML.

### Questions

Open primero, después answered/dismissed por createdAt.

#### text

- Textarea.

#### single_choice

- Radios.
- Campo “Otro” si allowOther.
- Comentario adicional opcional.

#### multiple_choice

- Checkboxes.
- Campo “Otro” si allowOther.
- Comentario adicional opcional.

Acciones curator:

- Crear.
- Editar solo open nunca respondida.
- Dismiss.
- Reopen cuando no Done.

Al responder la última pregunta:

- UI recibe Task en Curating.
- Mostrar mensaje “Respuestas completas; pendiente de revisión del curator”.

### Curator Spec

- Textarea monoespaciada.
- Preview Markdown.
- Guardado explícito; no autosave.
- Indicador de cambios sin guardar.
- Confirmación de navegación si hay cambios.
- Sanitizar HTML; Markdown raw HTML deshabilitado.
- No usar Monaco.

Botón Ready solo habilitado visualmente si spec no vacía y no hay Questions open.

### Attachments

Por fichero:

- Nombre.
- MIME.
- Tamaño.
- SHA-256 abreviado con valor completo copiable.
- Descargar.
- Eliminar con confirmación.

Upload:

- Validación preliminar de extensión/tamaño.
- Progreso cuando sea viable.
- Un request por fichero.
- Actualizar version después de cada éxito.

Las imágenes no necesitan preview en v0.1; descargar es suficiente.

### PR URL

- Campo URL.
- Save/clear explícitos.
- Si existe, enlace externo con `rel="noopener noreferrer"`.
- No se consulta el proveedor.

### Activity

- Timeline simple.
- Tipo, actor, timestamp, motivo y metadata segura.
- Paginación “Cargar más”.
- No mostrar JSON crudo por defecto.

## 9. Conflictos

Ante 409 `version_conflict`:

- No sobrescribir.
- Mantener el contenido local del formulario.
- Mostrar versión leída y actual si están disponibles.
- Acciones:
  - Copiar cambios locales.
  - Recargar Task.
- No implementar merge automático.

TanStack Query no reintenta mutaciones.

## 10. Loading/error/empty

Cada pantalla debe cubrir:

- Skeleton/loading.
- Empty state accionable.
- Error de autenticación.
- Error de red con retry manual.
- 404.
- Error de validación junto al campo.
- Error server con request ID visible/copiadle.

## 11. Accesibilidad

- Labels reales.
- Focus visible.
- Errores asociados mediante aria-describedby.
- Dialogs con focus trap.
- Controles de choice navegables por teclado.
- Status no comunicado solo por color.
- Contraste WCAG AA.

## 12. Seguridad frontend

- No almacenar token CLI en browser.
- Cookie no accesible desde JavaScript.
- No usar `dangerouslySetInnerHTML` con contenido no saneado.
- CSP compatible con SPA sin `unsafe-eval`.
- Links externos seguros.
- No incluir secretos/env server en bundle.

## 13. Fuera de alcance visual

- Kanban.
- Drag and drop.
- Gráficas.
- Dashboard.
- Tiempo real/WebSocket.
- Tema personalizable.
- Editor rico.
- Preview avanzado de adjuntos.

## 14. Done criteria Web

- [ ] Todas las rutas protegidas redirigen a login sin sesión.
- [ ] CRUD/archivo de Project funciona.
- [ ] Crear/listar/consultar/editar Task funciona.
- [ ] User Request es editable solo en Draft y se congela al enviar a curator.
- [ ] Preguntas de los tres tipos se responden correctamente.
- [ ] Spec se edita y previsualiza de forma segura.
- [ ] Adjuntos se cargan, descargan y eliminan.
- [ ] Transiciones respetan precondiciones.
- [ ] Conflictos preservan cambios locales.
- [ ] Filtros sobreviven reload.
- [ ] Estados loading/empty/error están cubiertos.
- [ ] Navegación y formularios principales funcionan con teclado.

## 15. Task detail v0.4

El detalle usa una timeline cronológica central y un inspector lateral sticky con estado, Cycle, spec, Attachments y Delivery/PR. En móvil el inspector fluye bajo la timeline sin overflow. El composer aparece solo en Done como “Solicitar cambio” y en Blocked como “Añadir contexto”; conserva texto y selección local hasta un envío aceptado. Questions, respuestas, revisiones, Runs, logs y eventos se muestran dentro de su Cycle. Mientras Curating o Implementing indican un Run potencialmente activo, la vista refresca por polling; no usa WebSockets.

Cada tarjeta Run contiene Logs y, según estado, Cancelar o Retry. Task, timeline y Run activo se refrescan cada 5 segundos hasta terminal; el diálogo de logs refresca cada 3 segundos, diferencia inicio de ausencia terminal y conserva el diagnóstico final junto al snapshot parcial.

## 16. Selector de modelo

El formulario de Agent Profile consulta el catálogo después de completar modo y referencia,
preselecciona el modelo `isDefault` y su `defaultReasoningEffort`, y recalcula los efforts al
cambiar de modelo. Ambos controles son selects cerrados. Loading, error y retry son explícitos; la
creación permanece deshabilitada si el catálogo falla o la selección ya no es válida.
La referencia de variable de entorno solo se edita para `api_key`. Con `chatgpt_session` se oculta
y Web envía la referencia interna estable `CODEX_SESSION`, ya que la credencial procede del volumen
de sesión de Codex.

## 17. Estado operativo

El header global consulta cada 15 segundos `GET /system/runner` y muestra Activo, Sin conexión o
Sin señal, enlazando a Automatización. Esa página presenta la última señal, permite comprobar de
nuevo y explica la recuperación del servicio. El detalle de una Task con `automationPaused=true`
muestra el motivo operativo y “Reanudar automatización” cuando está Curating o Ready. No hay entrada
manual de estado ni control del socket Docker.

## 18. Notificaciones

La pantalla permite activar el canal, editar URL/topic, conservar, reemplazar o eliminar un token
enmascarado, guardar y enviar una prueba. Expone loading, éxito, errores de campo y request ID,
advierte que los topics anónimos pueden ser públicos y mantiene un layout sin overflow en móvil.

## 19. Perfiles de Curation e Implementation

La tarjeta de automatización del Project gestionado muestra dos selects etiquetados. Guardar el
perfil de Curation es posible con Implementation desactivada. Activar Implementation permanece
deshabilitado hasta seleccionar un perfil implementador. Ambos selects admiten el mismo perfil y
presentan por separado los errores de campo. Cron, timezone y concurrencia siguen compartiendo la
tarjeta; el texto aclara que el horario solo afecta a Implementation.

## 20. Selector de rama de referencia

La tarjeta del Project gestionado carga las ramas del provider y permite guardar la predeterminada.
El formulario de nueva Task repite el listado para el Project seleccionado y preselecciona su
default. Loading, error y retry son explícitos y bloquean el submit gestionado si no existe una
selección válida. El inspector de Task muestra el snapshot de Delivery.

## 21. Azure DevOps

Automation presenta botones separados para GitHub y Azure DevOps. Tras el callback Azure muestra
un selector cerrado de organizaciones del snapshot temporal y completa la Connection elegida.
Cada tarjeta usa metadata del provider, comparte importación/repositorios y ofrece Reautorizar
cuando el estado es `reauthorization_required`. Los estados loading/error/expirado son explícitos y
el selector conserva labels y navegación por teclado.

## 22. Project Readiness

Project Detail incluye “Comprobar Project” para Projects gestionados. La acción estándar no exige
confirmación. El probe profundo explica que crea recursos efímeros y exige confirmación. El
resultado muestra profundidad, duración, instante y todos los checks sin depender solo del color;
no se conserva al abandonar la vista.

## 23. Ready Policy

Project Automation permite elegir quién decide Ready. Task Detail muestra una llamada de atención
cuando `readyApprovalPending=true` y ofrece la transición existente “Aprobar y marcar Ready”. La
UI no crea un estado nuevo ni atribuye la acción a una identidad humana verificable.
## Verification Contract

Project Detail permite consultar la revisión vigente, revisar historia, reemplazar el conjunto
completo de comandos y desactivarlo. La UI muestra explícitamente que argv se ejecutará sin shell y
que cada cambio crea una revisión inmutable.
## Evidencia de Delivery

Task Detail muestra Verification por comando y Run provenance. Un fallo required ofrece waiver
explícito con motivo, junto a Full Retry, y explica que el attempt previo permanece fallido e
inmutable.

## Operación y trazabilidad v0.7–v0.8

La navegación incluye “Necesita atención”. Task Detail permite refrescar manualmente la proyección
de Delivery y comunica su staleness sin cambiar el estado de Task.

Antes de cerrar el trabajo, Curator Spec muestra un diff acotado entre las dos últimas revisiones
del Cycle vigente junto a Questions y la acción explícita de Ready. Las métricas permanecen en API
y CLI; no se añade dashboard Web.
