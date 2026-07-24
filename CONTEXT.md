# AIWS

AIWS registra peticiones de trabajo y coordina su preparación, curation e implementación sin mezclar la intención original con la especificación resultante.

## Language

**Task**:
Agregado que conserva una petición y su progreso desde la preparación hasta la finalización.
_Avoid_: Ticket, issue

**User Request**:
Petición original editable durante Draft y congelada al comenzar Curation.
_Avoid_: Description, spec

**Curation**:
Trabajo de inspeccionar petición, contexto y respuestas para producir una Curator Spec suficiente o formular Questions.
_Avoid_: Planning, implementation

**Curator Spec**:
Especificación implementable producida durante Curation y separada de la User Request.
_Avoid_: User Request, description

**Question**:
Solicitud estructurada de información cuya apertura mantiene la Task Blocked.
_Avoid_: Comment

**Task Status**:
Fase de negocio actual de una Task: Draft, Curating, Blocked, Ready, Implementing o Done.
_Avoid_: Run status

**Run**:
Intento observable de un agente gestionado para realizar Curation o Implementation.
_Avoid_: Task, job status

**Run Kind**:
Propósito inmutable de un Run: Curation o Implementation.
_Avoid_: Task Status

**Managed Project**:
Project cuyo repositorio y Runs son operados por AIWS.
_Avoid_: Local Project

**Local Project**:
Project atendido por curators e implementadores externos mediante el workflow público.
_Avoid_: Managed Project

**Task Cycle**:
Petición incremental y recorrido de curation e implementation que termina en Done. Task Status describe siempre el Cycle activo.
_Avoid_: Run, Delivery

**Task Message**:
Mensaje inmutable `initial_request`, `change` o `context`; no sustituye una respuesta estructurada a una Question.
_Avoid_: Comment, Question Answer

**Spec Revision**:
Snapshot append-only de una Curator Spec producido dentro de un Cycle.
_Avoid_: Curator Spec projection

**Delivery**:
Rama y pull request reutilizables por varios Runs y Cycles cuando el estado remoto lo permite.
_Avoid_: Run, Cycle

**Base Branch**:
Rama remota contra la que nace una Delivery y se publica su pull request. El Project aporta el
valor por defecto para nuevas Tasks; cada Delivery conserva su propio snapshot inmutable.
_Avoid_: Delivery Branch, GitHub Default Branch
