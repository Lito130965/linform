/**
 * Inline SVG icons.
 *
 * These replace text glyphs (☰ ▤ ★ ⚙ ✎ 🗑 ✕ 📎). A glyph is at the mercy of
 * whatever font the operating system substitutes: it renders at a different
 * weight on every platform, sometimes as an emoji, sometimes as a blank box —
 * and it carries a character's semantics into the accessibility tree, where a
 * star means nothing useful.
 *
 * Every icon is `aria-hidden` and `focusable="false"`: it is decoration. The
 * accessible name belongs on the button that contains it, which is why every
 * caller here also carries an `aria-label`.
 *
 * Drawn with `currentColor` and no fills, so an icon follows the text colour of
 * whatever it sits in — including the light theme — without a second palette.
 */

export type IconName =
  | 'menu'
  | 'templates'
  | 'examples'
  | 'settings'
  | 'attach'
  | 'close'
  | 'edit'
  | 'trash'
  | 'eye'
  | 'eye-off'
  | 'structure'
  | 'panel-right'
  | 'plus-square'
  | 'layers'
  | 'image'
  | 'braces'

const PATHS: Record<IconName, JSX.Element> = {
  menu: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>
  ),
  templates: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="9" x2="9" y2="20" />
    </>
  ),
  examples: <polygon points="12 3 14.9 8.9 21.4 9.8 16.7 14.4 17.8 20.9 12 17.8 6.2 20.9 7.3 14.4 2.6 9.8 9.1 8.9" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>
  ),
  attach: (
    <path d="M21.4 11.1l-9.2 9.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 1 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 1 1-2.6-2.6l8.5-8.5" />
  ),
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
    </>
  ),
  trash: (
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M10.6 6.1A9.8 9.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4" />
      <path d="M6.4 7.9A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5a10 10 0 0 0 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="3" y1="3" x2="21" y2="21" />
    </>
  ),
  /* The four tools of the rail. Outlines rather than solid shapes, to sit
     beside the icons already here without shouting over them. */
  'plus-square': (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  layers: (
    <>
      <polygon points="12 2 22 8 12 14 2 8" />
      <polyline points="2 14 12 20 22 14" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 18l5-5 4 4 3-3 4 4" />
    </>
  ),
  braces: (
    <>
      <path d="M8 4c-2 0-2 3-2 4s0 4-2 4c2 0 2 3 2 4s0 4 2 4" />
      <path d="M16 4c2 0 2 3 2 4s0 4 2 4c-2 0-2 3-2 4s0 4-2 4" />
    </>
  ),
  /* A pane docked to the right edge: the shape every editor uses for "show or
     hide the panel on that side". */
  'panel-right': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </>
  ),
  structure: (
    <>
      <line x1="9" y1="6" x2="21" y2="6" />
      <line x1="12" y1="12" x2="21" y2="12" />
      <line x1="12" y1="18" x2="21" y2="18" />
      <path d="M4 4v13a1 1 0 0 0 1 1h4" />
      <path d="M4 11h5" />
    </>
  ),
}

export default function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'examples' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
