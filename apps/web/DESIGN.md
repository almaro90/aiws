---
name: AIWS Web
description: Consola operativa para convertir peticiones en trabajo implementable y verificable.
colors:
  signal-blue: "#15a9fe"
  signal-blue-soft: "#ddf2ff"
  cool-canvas: "#f7fafc"
  clear-surface: "#ffffff"
  navigation-surface: "#f0f7fb"
  quiet-surface: "#eff4f7"
  secondary-surface: "#eaf3f9"
  ink-navy: "#0f1c2e"
  secondary-ink: "#18324b"
  quiet-ink: "#536577"
  signal-ink: "#0f4568"
  structural-border: "#d4e0e8"
  field-border: "#c8d7e1"
  destructive: "oklch(0.56 0.2 27)"
typography:
  display:
    fontFamily: "Oxanium Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Oxanium Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "Oxanium Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Oxanium Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.25rem
  control:
    fontFamily: "Oxanium Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 500
    lineHeight: 1rem
  label:
    fontFamily: "Oxanium Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1rem
  mono:
    fontFamily: "SFMono-Regular, Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
rounded:
  square: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.square}"
    padding: "0 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.secondary-surface}"
    textColor: "{colors.secondary-ink}"
    rounded: "{rounded.square}"
    padding: "0 12px"
    height: "36px"
  input:
    backgroundColor: "transparent"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.square}"
    padding: "6px 12px"
    height: "36px"
  card:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink-navy}"
    rounded: "{rounded.square}"
    padding: "16px"
---

# Design System: AIWS Web

## Overview

**Creative North Star: "La mesa de control precisa"**

AIWS se comporta como una mesa de control técnica: compacta, estable y explícita. La interfaz no
compite con el trabajo; ordena estado, bloqueo, evidencia y acción para que una persona pueda
orientarse con rapidez incluso cuando una Task contiene mucha historia.

La identidad aparece en detalles disciplinados —Oxanium, azul señal, geometría recta y metadatos
monoespaciados—, no en efectos decorativos. Las superficies claras y frías separan regiones sin
convertir cada dato en una tarjeta.

**Key Characteristics:**

- Densidad operativa con jerarquía visible.
- Geometría recta y bordes estructurales.
- Azul reservado para foco, navegación y acción.
- Estado comunicado mediante texto, icono y contraste.
- Movimiento breve y funcional.

## Colors

La paleta combina un lienzo azul muy pálido con tinta navy y un único azul luminoso de señal.

### Primary

- **Azul señal** (`#15a9fe`): acción primaria, foco y acentos que requieren atención inmediata.
- **Azul señal suave** (`#ddf2ff`): selección y énfasis de baja intensidad.

### Neutral

- **Lienzo frío** (`#f7fafc`): fondo global.
- **Superficie clara** (`#ffffff`): formularios, tablas, cards y overlays.
- **Superficie de navegación** (`#f0f7fb`): sidebar y navegación móvil.
- **Superficie silenciosa** (`#eff4f7`): agrupación secundaria, skeletons y estados discretos.
- **Tinta navy** (`#0f1c2e`): texto principal.
- **Tinta silenciosa** (`#536577`): metadata y ayuda secundaria.
- **Borde estructural** (`#d4e0e8`): separación y contención.
- **Borde de campo** (`#c8d7e1`): inputs y controles.

### Named Rules

**The Signal Rule.** El azul primario identifica foco, selección o acción; no se usa como relleno
decorativo de grandes superficies.

**The State Rule.** Éxito, warning, error y estados de dominio siempre combinan color con texto o
icono; el color nunca transporta el significado por sí solo.

## Typography

**Display Font:** Oxanium Variable (con fallback `ui-sans-serif, system-ui, sans-serif`)  
**Body Font:** Oxanium Variable (con el mismo fallback)  
**Label/Mono Font:** SFMono-Regular, Consolas, monospace

**Character:** Oxanium aporta una identidad técnica reconocible sin separar titulares y cuerpo en
dos mundos. Mono queda reservado para IDs, rutas, ramas, hashes, logs y otros valores literales.

### Hierarchy

- **Display** (600, 24–30 px, line-height 1.2): títulos de página.
- **Headline** (600, 20 px, line-height 1.4): secciones operativas.
- **Title** (500, 16 px, line-height 1.375): títulos de cards y grupos.
- **Body** (400, 14 px, line-height 20 px): contenido y controles.
- **Control** (500, 12.8 px, line-height 16 px): botones pequeños y acciones compactas.
- **Label** (500, 12 px, line-height 16 px): metadata, badges y ayudas compactas.
- **Mono** (400, 12 px, line-height 16 px): identificadores y evidencia técnica.

### Named Rules

**The Literal Data Rule.** Solo los valores que una persona puede copiar, comparar o ejecutar usan
mono; las explicaciones permanecen en Oxanium.

## Layout

El shell usa una sidebar fija de 240 px, colapsable a 64 px, y un área principal de hasta 1280 px.
El contenido sigue una retícula vertical de 20 px, con padding lateral de 16 px en móvil, 24 px
desde `sm` y 32 px en escritorio.

Las listas densas usan tabla en escritorio y cards equivalentes en móvil. Task Detail utiliza una
columna principal y un inspector de 352 px desde `lg`; en móvil, el resumen y los bloqueos deben
preceder al historial. Los layouts se construyen con `minmax(0, 1fr)`, wrap y truncado localizado
para impedir overflow global.

## Elevation & Depth

El sistema es plano por defecto. La profundidad se comunica mediante color de superficie, borde o
ring de un píxel. Las sombras se reservan para overlays y para la card de Login, donde ayudan a
separar un único punto de entrada del lienzo.

### Named Rules

**The Flat-by-Default Rule.** Una región de contenido no gana sombra por ser importante; la
jerarquía se resuelve con posición, espacio, contraste y tipografía.

## Shapes

Las esquinas son rectas: `--radius` y toda la escala Tailwind de radios resuelven a `0`. Los nombres
de utilidades `rounded-*` presentes en componentes heredados no autorizan redondeo visual mientras
los tokens sigan siendo cero. Bordes finos y líneas completas expresan contención; no se emplean
formas decorativas ni pestañas laterales.

## Components

### Buttons

- **Shape:** rectangular, radio 0 y altura base de 36 px.
- **Primary:** azul señal con tinta navy; se reserva para una acción principal por contexto.
- **Hover / Focus:** variación tonal discreta y ring azul de dos píxeles con offset.
- **Secondary / Outline / Ghost:** reducen peso sin ocultar la acción; destructive utiliza rojo
  tonal con texto explícito.

### Badges and Filter Chips

- **Style:** compactos, texto de 12 px y color semántico acompañado de icono o label.
- **State:** los filtros activos pueden retirarse individualmente y nunca dependen solo del color.

### Cards / Containers

- **Corner Style:** radio 0.
- **Background:** superficie clara sobre lienzo frío.
- **Shadow Strategy:** sin sombra en contenido operativo.
- **Border:** ring o borde de un píxel.
- **Internal Padding:** 12 px en densidad pequeña, 16 px por defecto.

### Inputs / Fields

- **Style:** altura 36 px, fondo transparente y borde de campo.
- **Focus:** borde azul, ring de dos píxeles y offset sobre el fondo.
- **Error / Disabled:** color destructivo más mensaje asociado; disabled reduce opacidad y conserva
  legibilidad.

### Navigation

La sidebar usa superficie propia, iconos de 16 px y labels de 14 px. El item activo combina fondo
azul suave y tinta de acento. En móvil, la misma navegación aparece en un Sheet y devuelve el foco
al trigger al cerrarse.

### Operational Summary

El resumen de Task reúne estado, Project, Cycle, versión, pausa o Run activo y una única acción
primaria antes del historial. La información diagnóstica queda bajo revelado progresivo.

## Do's and Don'ts

### Do:

- **Do** priorizar estado vigente, bloqueo y siguiente acción.
- **Do** reutilizar tokens y componentes de `src/components/ui`.
- **Do** mantener contenido completo en móvil y a zoom del 200 %.
- **Do** mostrar loading, vacío, error, conflicto, offline y resultados parciales de forma explícita.
- **Do** usar español en acciones y conservar los términos de dominio establecidos.

### Don't:

- **Don't** convertir AIWS en un dashboard de métricas o un chat genérico.
- **Don't** anidar cards cuando una separación, heading o borde resuelve la jerarquía.
- **Don't** añadir gradientes, glassmorphism, glow, esquinas redondeadas o movimiento ornamental.
- **Don't** inventar claims, estados, acciones, datos o capacidades no presentes en el contrato.
- **Don't** ocultar información vigente para conseguir una composición más limpia.
