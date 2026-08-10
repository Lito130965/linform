/** Page formats and canvas chrome shared by the custom editor.
 *
 * Extracted from VisualEditor.tsx (the GrapesJS host) so the new editor does
 * not import anything GrapesJS-shaped; the old file keeps its own copy for the
 * duration of the migration flag and dies with it in Stage 3.
 */

/** Paper formats at 96dpi. The canvas width is a hint — the PDF preview
 * remains the truth about pages — but matching the width makes wrapping
 * realistic and the height lets the canvas show a full sheet to its bottom
 * edge and split into page-tall sheets. `width: null` means "fill the
 * container" (free width, no page height). */
export const PAGE_FORMATS: { id: string; name: string; width: number | null; height: number | null }[] = [
  { id: 'A4', name: 'A4', width: 794, height: 1123 },
  { id: 'A4 landscape', name: 'A4 landscape', width: 1123, height: 794 },
  { id: 'A5', name: 'A5', width: 559, height: 794 },
  { id: 'A5 landscape', name: 'A5 landscape', width: 794, height: 559 },
  { id: 'A3', name: 'A3', width: 1123, height: 1587 },
  { id: 'Letter', name: 'Letter', width: 816, height: 1056 },
  { id: 'Free', name: 'Free width', width: null, height: null },
]

/** Pick the initial canvas format from the template's own @page rule. */
export function formatFromStyles(styles: string): string {
  const m = /size\s*:\s*(a3|a4|a5|letter)\s*(landscape)?/i.exec(styles)
  if (!m) return 'A4'
  const base = m[1].length === 2 ? m[1].toUpperCase() : 'Letter'
  const candidate = m[2] ? `${base} landscape` : base
  return PAGE_FORMATS.some((f) => f.id === candidate) ? candidate : 'A4'
}

/** Breathing room around the page inside the scroll area, in px. */
export const CANVAS_GUTTER_PX = 24

/** Canvas-only affordances: visible in the editor, pure CSS, and injected into
 * the iframe head — nothing here can leak into the exported HTML. */
export const CANVAS_AFFORDANCE_CSS = `
  body { background: #fff; margin: 8px; }
  body:focus { outline: none; }
  [data-jinja-expr] {
    background: rgba(79, 140, 255, 0.14);
    border: 1px solid rgba(79, 140, 255, 0.45);
    border-radius: 3px;
    padding: 0 2px;
    white-space: nowrap;
    cursor: default;
  }
  [data-jinja-for] { outline: 1px dashed rgba(79, 140, 255, 0.65); outline-offset: 1px; }
  [data-jinja-if] { outline: 1px dashed rgba(63, 178, 111, 0.7); outline-offset: 1px; }
  [data-jinja-raw] {
    background: rgba(138, 109, 26, 0.12);
    border: 1px solid rgba(138, 109, 26, 0.5);
    border-radius: 3px;
    padding: 0 4px;
    font: 11px/1.5 ui-monospace, monospace;
    color: #8a6d1a;
    white-space: nowrap;
    cursor: default;
    user-select: none;
  }
  [data-lf-selected] {
    outline: 2px solid #4f8cff !important;
    outline-offset: 1px;
  }
  /* Taken out of sight from the structure panel. visibility, not display: the
     box keeps its size, so hiding a background image to work under it does not
     move everything below it and does not change where the pages break. The
     attribute is canvas-only and stripped on export. */
  [data-lf-hidden] { visibility: hidden !important; }
  /* A page-background image is exported with negative margin offsets so it
     bleeds to the sheet edge in print; in the margin-less canvas iframe that
     would shift it off-corner, so show it filling the iframe instead. */
  img[data-lf-pagebg] {
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
  }
  /* A running header/footer sits in flow in the canvas (the browser ignores
     position: running); badge it so its true role reads clearly. */
  [data-lf-running] {
    outline: 1px dashed rgba(181, 138, 42, 0.8);
    outline-offset: 2px;
    position: relative;
  }
  [data-lf-running]::before {
    content: "repeats at the " attr(data-lf-running) " of every page";
    display: block;
    font: 9px/1.6 system-ui, sans-serif;
    color: #8a6d1a;
  }
  /* A page break is invisible in print; show it as a labelled bar so it can be
     clicked, moved and deleted like any block. Canvas-only — the exported
     element keeps just its page-break style. */
  [data-lf-pagebreak] {
    display: block !important;
    height: 20px !important;
    min-height: 20px !important;
    margin: 6px 0 !important;
    border-top: 2px dashed #c94f4f;
    background: repeating-linear-gradient(
      -45deg, rgba(201, 79, 79, 0.10), rgba(201, 79, 79, 0.10) 6px,
      transparent 6px, transparent 12px);
    position: relative;
    cursor: pointer;
  }
  [data-lf-pagebreak]::after {
    content: "✂ page break";
    position: absolute;
    top: 2px;
    left: 8px;
    font: 10px/1.4 system-ui, sans-serif;
    color: #c94f4f;
  }
`
