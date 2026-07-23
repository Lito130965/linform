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
  {
    id: 'columns-2',
    label: '2 columns',
    // Explicit widths (not flex:1) so resizing one column never rebalances
    // the other — each keeps whatever width you give it.
    content:
      '<div style="display: flex;">' +
      '<div style="width: 50%; flex-shrink: 0; min-height: 24px;">Left</div>' +
      '<div style="width: 50%; flex-shrink: 0; min-height: 24px;">Right</div></div>',
  },
  {
    id: 'columns-3',
    label: '3 columns',
    content:
      '<div style="display: flex;">' +
      '<div style="width: 33.33%; flex-shrink: 0; min-height: 24px;">One</div>' +
      '<div style="width: 33.33%; flex-shrink: 0; min-height: 24px;">Two</div>' +
      '<div style="width: 33.33%; flex-shrink: 0; min-height: 24px;">Three</div></div>',
  },
  { id: 'divider', label: 'Divider', content: '<hr>' },
  {
    id: 'page-break',
    label: 'Page break',
    content: '<div style="page-break-after: always;"></div>',
  },
]
