/** Insertable blocks for the custom editor's palette.
 *
 * Ported from the GrapesJS block manager; every entry is plain markup now —
 * the "image" block inserts a placeholder img the user then points at an
 * asset (the old editor used a GrapesJS asset-picker type here).
 */

export interface BlockDef {
  id: string
  label: string
  content: string
}

export const BLOCKS: BlockDef[] = [
  { id: 'text', label: 'Text', content: '<p>Text</p>' },
  { id: 'heading', label: 'Heading', content: '<h2>Heading</h2>' },
  {
    id: 'table',
    label: 'Table',
    content:
      '<table style="width: 100%; border-collapse: collapse;">' +
      '<thead><tr><th>Column</th><th>Column</th></tr></thead>' +
      '<tbody><tr><td>Value</td><td>Value</td></tr></tbody></table>',
  },
  // Columns are borderless one-row tables, not flex divs: a table is what the
  // author wants to grow (add rows, add/remove columns, resize) — the row/
  // column tools then apply exactly as they do to any table.
  {
    id: 'columns-2',
    label: '2 columns',
    content:
      '<table style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
      '<td style="width: 50%; vertical-align: top;">Left</td>' +
      '<td style="width: 50%; vertical-align: top;">Right</td>' +
      '</tr></tbody></table>',
  },
  {
    id: 'columns-3',
    label: '3 columns',
    content:
      '<table style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
      '<td style="width: 33.33%; vertical-align: top;">One</td>' +
      '<td style="width: 33.33%; vertical-align: top;">Two</td>' +
      '<td style="width: 33.33%; vertical-align: top;">Three</td>' +
      '</tr></tbody></table>',
  },
  { id: 'divider', label: 'Divider', content: '<hr>' },
  {
    id: 'page-break',
    label: 'Page break',
    content: '<div style="page-break-after: always;"></div>',
  },
  // Header/footer repeat on every printed page via the running-element pattern
  // (as in ai_test). The @page rule lives in a <style> carried in the body —
  // WeasyPrint honours it there, so nothing touches the read-only author CSS.
  // data-lf-running is a canvas-only badge marker, stripped on export.
  {
    id: 'header',
    label: 'Page header',
    content:
      '<style>@page { margin-top: 22mm; @top-center { content: element(lf-header); } }</style>' +
      '<div data-lf-running="header" style="position: running(lf-header); font-size: 9pt; ' +
      'text-align: center; color: #555;">Header text — edit me</div>',
  },
  {
    id: 'footer',
    label: 'Page footer',
    content:
      '<style>@page { margin-bottom: 22mm; @bottom-center { content: element(lf-footer); } }</style>' +
      '<div data-lf-running="footer" style="position: running(lf-footer); font-size: 9pt; ' +
      'text-align: center; color: #555;">Footer text — edit me</div>',
  },
]
