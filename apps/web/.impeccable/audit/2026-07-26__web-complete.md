# Impeccable Audit — AIWS Web completa

> Fecha: 2026-07-26
> Alcance: `apps/web/src`, todas las rutas declaradas por `router.tsx`
> Resultado del detector: 0 findings

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|---|---:|---|
| 1 | Accessibility | 3 | Buena cobertura de teclado/foco, con gaps de headings y un Select de importación sin nombre. |
| 2 | Performance | 3 | Lazy routes y assets locales; el build conserva un chunk superior a 500 kB. |
| 3 | Responsive Design | 3 | Reflow y paridad móvil fuertes; varios controles frecuentes quedan por debajo de 44 px. |
| 4 | Theming | 3 | Tokens coherentes para el tema claro; algunos colores semánticos viven directamente en componentes. |
| 5 | Implementation Integrity | 4 | Detector limpio y modelo de interacción específico de AIWS. |
| **Total** |  | **16/20** | **Good — corregir gaps acotados antes de elevar el nivel visual.** |

## Implementation Integrity Verdict

**Pass.** La implementación expresa un sistema coherente y específico: shell común, tokens
centralizados, componentes reutilizados, Task Detail orientado al agregado y estados de error,
conflicto y recuperación explícitos. El detector determinista terminó limpio. Los problemas
restantes son gaps de semántica, prevención y ergonomía, no drift sistémico.

## Executive Summary

- **P0:** 0.
- **P1:** 2.
- **P2:** 2.
- **P3:** 0 registrados para evitar ruido.
- Prioridad: hacer inequívoca la Spec aprobada por Ready y alinear headings/labels con la jerarquía
  visual.

## Detailed Findings

### P1 — Ready no conoce el dirty state de Curator Spec

- **Location:** `src/pages/task-detail.tsx`, `TaskHeader` y `SpecSection`.
- **Category:** Implementation Integrity / Error Prevention.
- **Impact:** una transición puede aprobar contenido persistido distinto del borrador visible.
- **Recommendation:** coordinar el draft de Spec con el CTA Ready y bloquear/explicar la acción.
- **Suggested command:** `$impeccable harden Task Detail Ready and Curator Spec`.

### P1 — Estructura semántica y nombre accesible incompletos

- **Location:** `src/components/ui/card.tsx`, `src/components/ui/empty.tsx`,
  `src/pages/login.tsx`, `src/pages/projects.tsx`, `src/pages/automation.tsx`.
- **Category:** Accessibility.
- **Impact:** headings visuales no forman un outline navegable; el account scope de importación no
  tiene label.
- **WCAG:** 1.3.1 Info and Relationships; 2.4.6 Headings and Labels; 3.3.2 Labels or Instructions.
- **Recommendation:** API semántica de títulos, un único h1 y label explícito para el Select.
- **Suggested command:** `$impeccable harden semantic hierarchy and managed import form`.

### P2 — Chunk Web superior al umbral de 500 kB

- **Location:** salida de `vite build`.
- **Category:** Performance.
- **Impact:** aumenta parse/transfer inicial en equipos o redes limitadas.
- **Recommendation:** medir el chunk y separar únicamente dependencias/rutas con impacto real; no
  añadir dependencias para resolverlo.
- **Suggested command:** `$impeccable optimize the AIWS Web bundle`.

### P2 — Targets táctiles compactos en acciones frecuentes

- **Location:** `src/components/ui/button.tsx` y usos `size="sm"`, `icon-sm`, `xs`.
- **Category:** Responsive / Accessibility.
- **Impact:** 24–36 px es operable con precisión, pero menos cómodo a una mano en móvil.
- **Recommendation:** mantener densidad desktop y elevar a 44 px el área interactiva de acciones
  móviles frecuentes mediante padding o pseudo-elemento, sin inflar toda la interfaz.
- **Suggested command:** `$impeccable adapt frequent mobile actions`.

## Patterns & Systemic Issues

- La jerarquía visual depende más de cards y bordes que del outline HTML.
- Estados semánticos usan presentation maps en algunas áreas y valores backend directos en otras.
- La matriz responsive es amplia, pero cuatro rutas de navegación carecen de visita E2E directa.

## Positive Findings

- Focus rings, guards, dialogs, Sheet y Combobox tienen cobertura específica.
- Offline, 401, conflictos, polling y uploads parciales conservan contexto y ofrecen recuperación.
- La matriz existente cubre 360, 412, 1280, 1440 y texto al 200 %.
- No hay findings deterministas de AI slop, contraste estático, tipografía o design-system drift.

## Recommended Actions

1. **P1 `$impeccable harden`**: coordinar Spec dirty/Ready y corregir headings/labels.
2. **P1 `$impeccable clarify`**: explicar prerrequisitos disabled y normalizar estados técnicos.
3. **P2 `$impeccable adapt`**: mejorar targets táctiles solo en acciones móviles frecuentes.
4. **P2 `$impeccable optimize`**: medir y reducir el chunk Web si el perfil confirma impacto.
5. **P3 `$impeccable polish`**: pasada final por ruta después de corregir los puntos anteriores.
