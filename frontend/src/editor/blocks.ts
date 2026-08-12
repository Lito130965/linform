/** Insertable blocks for the custom editor's palette.
 *
 * Ported from the GrapesJS block manager; every entry is plain markup now —
 * the "image" block inserts a placeholder img the user then points at an
 * asset (the old editor used a GrapesJS asset-picker type here).
 *
 * Headers and footers are not here. They are a property of the page rather
 * than something to drop into the flow — two halves that have to agree, a
 * margin box and the element it pulls — so they are a switch in the page panel
 * (furniture-setup.ts). Offering them here as well would be two ways to make
 * one thing, one of which writes only half of it.
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
]
