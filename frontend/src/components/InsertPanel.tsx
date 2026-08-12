import { BLOCKS } from '../editor/blocks'

/**
 * The blocks, as things you can see.
 *
 * They lived in a dropdown, which is the wrong shape for a palette: a list of
 * words you have to open, read and close again to find out that "2 columns" is
 * a borderless table. Tiles show the shape of what arrives, all of them at
 * once, and a click is one movement instead of three.
 *
 * Where a block lands is the canvas's business (editor/placement.ts): beside
 * the selected block, or INSIDE it when that block is something which holds
 * blocks — a section, a cell, a card.
 */

/** A miniature of what the block puts on the page. Drawn rather than described:
 * the point of a palette is recognising the shape without reading. */
const SHAPES: Record<string, JSX.Element> = {
  text: (
    <>
      <rect x="3" y="6" width="26" height="2.5" rx="1.2" />
      <rect x="3" y="12" width="26" height="2.5" rx="1.2" />
      <rect x="3" y="18" width="16" height="2.5" rx="1.2" />
    </>
  ),
  heading: (
    <>
      <rect x="3" y="6" width="20" height="5" rx="1.5" />
      <rect x="3" y="15" width="26" height="2.5" rx="1.2" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="5" width="26" height="16" rx="1.5" fill="none" strokeWidth="1.5" />
      <line x1="3" y1="11" x2="29" y2="11" strokeWidth="1.5" />
      <line x1="16" y1="5" x2="16" y2="21" strokeWidth="1.5" />
    </>
  ),
  'columns-2': (
    <>
      <rect x="3" y="5" width="11" height="16" rx="1.5" />
      <rect x="18" y="5" width="11" height="16" rx="1.5" />
    </>
  ),
  'columns-3': (
    <>
      <rect x="3" y="5" width="7" height="16" rx="1.5" />
      <rect x="12.5" y="5" width="7" height="16" rx="1.5" />
      <rect x="22" y="5" width="7" height="16" rx="1.5" />
    </>
  ),
  divider: <rect x="3" y="12" width="26" height="2.5" rx="1.2" />,
  'page-break': (
    <>
      <line x1="3" y1="13" x2="9" y2="13" strokeWidth="1.5" strokeDasharray="3 2.5" />
      <line x1="11" y1="13" x2="29" y2="13" strokeWidth="1.5" strokeDasharray="3 2.5" />
      <rect x="3" y="4" width="26" height="4" rx="1.2" opacity="0.45" />
      <rect x="3" y="18" width="26" height="4" rx="1.2" opacity="0.45" />
    </>
  ),
  header: (
    <>
      <rect x="3" y="4" width="26" height="4" rx="1.2" />
      <rect x="3" y="12" width="26" height="2.5" rx="1.2" opacity="0.45" />
      <rect x="3" y="18" width="18" height="2.5" rx="1.2" opacity="0.45" />
    </>
  ),
  footer: (
    <>
      <rect x="3" y="5" width="26" height="2.5" rx="1.2" opacity="0.45" />
      <rect x="3" y="11" width="18" height="2.5" rx="1.2" opacity="0.45" />
      <rect x="3" y="18" width="26" height="4" rx="1.2" />
    </>
  ),
}

/** What each one is for, in the words somebody would use asking for it. */
const NOTES: Record<string, string> = {
  text: 'A paragraph',
  heading: 'A section title',
  table: 'Rows and columns, with a header row',
  'columns-2': 'Two columns side by side',
  'columns-3': 'Three columns side by side',
  divider: 'A rule across the page',
  'page-break': 'Everything after this starts a new page',
  header: 'Repeats at the top of every printed page',
  footer: 'Repeats at the bottom of every printed page',
}

export default function InsertPanel({ onInsert }: { onInsert: (id: string) => void }) {
  return (
    <div className="insert-panel">
      <h2 className="panel-heading">
        Insert
        <span className="muted"> — lands beside what is selected, or inside it</span>
      </h2>
      <div className="insert-grid">
        {BLOCKS.map((block) => (
          <button
            key={block.id}
            className="insert-tile"
            title={NOTES[block.id] ?? block.label}
            onClick={() => onInsert(block.id)}
          >
            <svg viewBox="0 0 32 26" aria-hidden="true" focusable="false">
              {SHAPES[block.id] ?? SHAPES.text}
            </svg>
            <span className="insert-name">{block.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
