/** Page formats and canvas chrome shared by the custom editor.
 *
 * Extracted from VisualEditor.tsx (the GrapesJS host) so the new editor does
 * not import anything GrapesJS-shaped; the old file keeps its own copy for the
 * duration of the migration flag and dies with it in Stage 3.
 */

/** Paper formats at 96dpi (portrait widths). The canvas width is a hint —
 * the PDF preview remains the truth about pages — but matching widths make
 * wrapping in the canvas realistic. `width: null` means "fill the container"
 * (free width). */
export const PAGE_FORMATS: { id: string; name: string; width: number | null }[] = [
  { id: 'A4', name: 'A4', width: 794 },
  { id: 'A4 landscape', name: 'A4 landscape', width: 1123 },
  { id: 'A5', name: 'A5', width: 559 },
  { id: 'A5 landscape', name: 'A5 landscape', width: 794 },
  { id: 'A3', name: 'A3', width: 1123 },
  { id: 'Letter', name: 'Letter', width: 816 },
  { id: 'Free', name: 'Free width', width: null },
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
  [data-lf-selected] {
    outline: 2px solid #4f8cff !important;
    outline-offset: 1px;
  }
`
