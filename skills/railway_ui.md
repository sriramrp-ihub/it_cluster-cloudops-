---
version: alpha
name: "Harvey AI Legal Platform"
description: "Harvey's design system is built around a bespoke dual-typeface identity. HarveySerifFont for editorial authority and HarveySansFont for functional clarity. set against a warm near-black (#0f0e0d) navigation bar and an off-white ivory (#fafaf9) content surface. The palette is deliberately monochromatic, using a graduated warm gray scale (gray-50 through gray-950) with no accent hues, signaling trust and restraint appropriate for high-stakes legal work. Elevation is conveyed through surface contrast rather than shadows. The hero headline uses a large serif at 72px, creating immediate typographic authority, while body copy and UI elements use the custom sans. Spacing follows an 8px base grid with named scale tokens (xs, sm, md, xl, 2xl)."
colors:
  ivory-surface: "#fafaf9"
  pure-white: "#ffffff"
  mid-warm-gray: "#706d66"
  muted-gray: "#8f8b85"
  near-black-ink: "#0f0e0d"
  dark-warm-gray: "#33312c"
  warm-gray-border: "#cccac6"
typography:
  hero-headline:
    fontFamily: "HarveySerifFont"
    fontSize: "72px"
    fontWeight: "400"
    lineHeight: "75.6px"
    letterSpacing: "-0.9px"
  section-heading-large:
    fontFamily: "HarveySerifFont"
    fontSize: "48px"
    fontWeight: "400"
    lineHeight: "50.4px"
    letterSpacing: "-0.48px"
  section-heading-medium-serif:
    fontFamily: "HarveySerifFont"
    fontSize: "32px"
    fontWeight: "500"
    lineHeight: "33.6px"
    letterSpacing: "-0.32px"
  section-heading-medium-serif-regular:
    fontFamily: "HarveySerifFont"
    fontSize: "32px"
    fontWeight: "400"
    lineHeight: "33.6px"
    letterSpacing: "-0.32px"
  card-heading-serif:
    fontFamily: "HarveySerifFont"
    fontSize: "24px"
    fontWeight: "400"
    lineHeight: "25.2px"
    letterSpacing: "-0.24px"
  sans-heading-large:
    fontFamily: "HarveySansFont"
    fontSize: "32px"
    fontWeight: "500"
    lineHeight: "35.2px"
    letterSpacing: "-0.32px"
  sans-heading-medium:
    fontFamily: "HarveySansFont"
    fontSize: "24px"
    fontWeight: "500"
    lineHeight: "31.2px"
    letterSpacing: "-0.24px"
  body-large:
    fontFamily: "HarveySansFont"
    fontSize: "20px"
    fontWeight: "400"
    lineHeight: "26px"
  body-base:
    fontFamily: "HarveySansFont"
    fontSize: "16px"
    fontWeight: "400"
    lineHeight: "24px"
  label-medium:
    fontFamily: "HarveySansFont"
    fontSize: "14px"
    fontWeight: "500"
    lineHeight: "18.2px"
    letterSpacing: "-0.14px"
  label-small:
    fontFamily: "HarveySansFont"
    fontSize: "14px"
    fontWeight: "400"
    lineHeight: "18.2px"
rounded:
  sm: "0.25rem"
  md: "8px"
  form-input: "4px"
spacing:
  xs: "0.5rem"
  sm: "1rem"
  md: "2rem"
  xl: "8rem"
  2xl: "10rem"
  top-page-spacing: "4.125rem"
  base-4: "4px"
  base-8: "8px"
  base-12: "12px"
  base-20: "20px"
  base-24: "24px"
  base-64: "64px"
---

## Overview

Harvey's design system is built around a bespoke dual-typeface identity. HarveySerifFont for editorial authority and HarveySansFont for functional clarity. set against a warm near-black (#0f0e0d) navigation bar and an off-white ivory (#fafaf9) content surface. The palette is deliberately monochromatic, using a graduated warm gray scale (gray-50 through gray-950) with no accent hues, signaling trust and restraint appropriate for high-stakes legal work. Elevation is conveyed through surface contrast rather than shadows. The hero headline uses a large serif at 72px, creating immediate typographic authority, while body copy and UI elements use the custom sans. Spacing follows an 8px base grid with named scale tokens (xs, sm, md, xl, 2xl).

**Signature traits:**
- Dual typeface system: Pairs HarveySerifFont and HarveySansFont across the type hierarchy.
- Single-accent color discipline: A neutral-led palette reserves #fafaf9 as the lone accent.
- Layered elevation: Depth comes from 1 validated shadow token.

## Colors

The palette uses 7 validated color tokens across 1 theme profile. Semantic roles stay attached to observed usage so generation agents can choose accents without inventing new color meaning.

**Semantic naming:**
- **surface-background** maps to `ivory-surface`: Role "background" is grounded by usage context "Primary page background, content surfaces, and text-on-dark contexts".
- **action-text** maps to `near-black-ink`: Role "text" is grounded by usage context "Navigation bar background, primary CTA button fill, primary heading text, and key UI surfaces".
- **border-border** maps to `warm-gray-border`: Role "border" is grounded by usage context "Dividers, input borders, and secondary border treatments".
- **content-text** maps to `muted-gray`: Role "text" is grounded by usage context "Muted body text, placeholder text, and secondary labels".

### Text Scale
- **Mid Warm Gray** (#706d66): Footer text and tertiary content labels. Role: text. {authored: rgb(112, 109, 102), space: rgb}
- **Muted Gray** (#8f8b85): Muted body text, placeholder text, and secondary labels. Role: text. {authored: rgb(143, 139, 133), space: rgb}
- **Near Black Ink** (#0f0e0d): Navigation bar background, primary CTA button fill, primary heading text, and key UI surfaces. Role: text. {authored: rgb(15, 14, 13), space: rgb}

### Interactive
- **Dark Warm Gray** (#33312c): Disabled text states, secondary hover backgrounds, and border accents. Role: border. {authored: rgb(51, 49, 44), space: rgb}
- **Warm Gray Border** (#cccac6): Dividers, input borders, and secondary border treatments. Role: border. {authored: rgb(204, 202, 198), space: rgb}

### Surface & Shadows
- **Ivory Surface** (#fafaf9): Primary page background, content surfaces, and text-on-dark contexts. Role: background. {authored: rgb(250, 250, 249), space: rgb}
- **Pure White** (#ffffff): Card surfaces, modal backgrounds, and ring offset color. Role: background. {authored: rgb(255, 255, 255), space: rgb}

## Typography

Typography uses HarveySerifFont, HarveySansFont across extracted hierarchy roles. Keep hierarchy mapped to these token rows before adding decorative type styles.

Mixes HarveySerifFont and HarveySansFont for visual contrast. Weight range spans regular, medium. Sizes range from 14px to 72px.

### Font Roles
- **Headline Font**: HarveySerifFont
- **Body Font**: HarveySerifFont

### Type Scale Evidence
| Role | Font | Size | Weight | Line Height | Letter Spacing | Stack / Features | Notes |
|------|------|------|--------|-------------|----------------|------------------|-------|
| Primary hero headline — large editorial serif establishing brand authority | HarveySerifFont | 72px | 400 | 75.6px | -0.9px | HarveySerifFont, HarveySerifFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif; features: "calt", "liga" | Extracted token |
| Large section headings and feature titles | HarveySerifFont | 48px | 400 | 50.4px | -0.48px | HarveySerifFont, HarveySerifFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif; features: "calt", "liga" | Extracted token |
| Mid-level section headings in serif weight | HarveySerifFont | 32px | 500 | 33.6px | -0.32px | HarveySerifFont, HarveySerifFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif; features: "calt", "liga" | Extracted token |
| Mid-level section headings, regular weight variant | HarveySerifFont | 32px | 400 | 33.6px | -0.32px | HarveySerifFont, HarveySerifFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif; features: "calt", "liga" | Extracted token |
| Card and callout headings in serif | HarveySerifFont | 24px | 400 | 25.2px | -0.24px | HarveySerifFont, HarveySerifFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif; features: "calt", "liga" | Extracted token |
| Large sans-serif section headings | HarveySansFont | 32px | 500 | 35.2px | -0.32px | HarveySansFont, HarveySansFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif | Extracted token |
| Medium sans-serif headings and feature labels | HarveySansFont | 24px | 500 | 31.2px | -0.24px | HarveySansFont, HarveySansFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif | Extracted token |
| Large body copy and hero subtext | HarveySansFont | 20px | 400 | 26px | normal | HarveySansFont, HarveySansFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif | Extracted token |
| Default body text, nav links, and general UI copy | HarveySansFont | 16px | 400 | 24px | normal | HarveySansFont, HarveySansFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif | Extracted token |
| UI labels, button text, and navigation items | HarveySansFont | 14px | 500 | 18.2px | -0.14px | HarveySansFont, HarveySansFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif | Extracted token |
| Secondary labels, captions, and metadata | HarveySansFont | 14px | 400 | 18.2px | normal | HarveySansFont, HarveySansFont Fallback, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Open Sans, Helvetica Neue, sans-serif, sans-serif | Extracted token |

## Layout

Responsive system uses 3 breakpoint tier(s): mobile, tablet, desktop.

This system uses a 8px base grid with scale values 4, 8, 12, 16, 20, 24, 32, 64, 128, 160.

### Responsive Strategy
- **mobile (<= 640px)**: Constrain layout for small viewports and prioritize vertical stacking.
- **tablet (>= 768px)**: Increase spacing and column structure for medium-width viewports.
- **desktop (>= 1106px)**: Expand layout density and horizontal composition for wide viewports.

### Spacing System
| Token | Value | Px | Notes |
|------|-------|----|-------|
| base-4 | 4px | 4 | Extracted spacing token |
| xs | 0.5rem | 8 | Mapped to --spacing-xs |
| base-8 | 8px | 8 | Extracted spacing token |
| base-12 | 12px | 12 | Extracted spacing token |
| sm | 1rem | 16 | Mapped to --spacing-sm |
| base-20 | 20px | 20 | Extracted spacing token |
| base-24 | 24px | 24 | Extracted spacing token |
| md | 2rem | 32 | Mapped to --spacing-md |
| base-64 | 64px | 64 | Extracted spacing token |
| top-page-spacing | 4.125rem | 66 | Mapped to --spacing-top-page-spacing |
| xl | 8rem | 128 | Mapped to --spacing-xl |
| 2xl | 10rem | 160 | Mapped to --spacing-2xl |

## Elevation & Depth

Keep depth flat unless validated shadow or interaction evidence appears in the extraction payload. Do not invent shadows beyond this evidence boundary.

### Shadow Evidence
| Shadow Token | Layers | Details |
|--------------|--------|---------|
| Dropdown Shadow | 6 | 0px 0px 0px 0px rgba(0, 0, 0, 0) |

### Interaction Signals
| Theme | Signal | Evidence |
|-------|--------|----------|
| Light | backdrop-filter | blur(15px) ; blur(6px) ; blur(16px) |
| Light | outline-color | rgb(250, 250, 249) ; rgb(15, 14, 13) ; rgba(0, 0, 0, 0) |
| Light | outline-width | 3px |
| Light | outline-offset | 0px |
| Light | transform | matrix(1, 0, 0, 1, 0, 0) ; matrix(1, 0, 0, 1, -1248, 0) ; matrix(1, 0, 0, 1, -269.697, 0) |

## Shapes

Shape language maps directly to rounded tokens. Keep component corners consistent with the role mapping below before introducing bespoke geometry.

### Radius Roles
| Token | Value | Px | Role Mapping |
|------|-------|----|--------------|
| sm | 0.25rem | 4 | Subtle corner |
| form-input | 4px | 4 | Subtle corner |
| md | 8px | 8 | Control corner |

### Geometry Evidence
| Radius Token | Shape | Units |
|--------------|-------|-------|
| sm | 0.25rem | rem |
| md | 8px | px |
| form-input | 4px | px |

## Components

(none detected)

## Do's and Don'ts

Guardrails protect Dual typeface system, Single-accent color discipline, Layered elevation without adding unsupported visual claims.

| Do | Don't |
|----|---------|
| Do maintain consistent spacing using the base grid | Don't make unsupported claims about absent visual features |
| Do maintain WCAG AA contrast ratios (4.5:1 for normal text) | Don't mix rounded and sharp corners in the same view |
| Do use the primary color only for the single most important action per screen |  |
| Do verify evidence before writing new design-system guidance |  |

## Responsive Evidence

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <= 640px | (max-width: 640px) |
| Tablet | >= 768px | (min-width: 768px) |
| Desktop | >= 1106px | (min-width: 1106px) |
| Breakpoint 4 | Unknown | (prefers-reduced-motion: reduce) |

## Agent Prompt Guide

### Example Component Prompts
- Create button component using validated primary color role and spacing tokens.
- Create card component with mapped radius role and evidence-backed elevation.
- Create form input component using inferred typography hierarchy and border roles.

### Iteration Guide
1. Start with extracted palette and typography roles only.
2. Map spacing and radius directly from token tables before visual polish.
3. Apply component patterns one section at a time and compare against source intent.
4. Keep elevation claims tied to explicit evidence in output.
5. Iterate with smallest diffs and re-check section hierarchy after each change.
