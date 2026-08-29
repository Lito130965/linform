import Icon, { type IconName } from './Icon'

/**
 * The tools, down the side instead of across the bottom.
 *
 * The bottom panel took 220 px of height and would not fold below 80 — on the
 * axis where an A4 page is already 300 px taller than any laptop screen. Width
 * is the dimension there is enough of: a 52 px rail costs a twentieth of a 1920
 * screen, and what it opens is drawn OVER the page rather than beside it, so
 * choosing a tool never re-lays the document out.
 *
 * Icon plus label, not icon alone: four glyphs a person has to learn is a quiz,
 * and the label is what the accessible name says anyway.
 */

export type ToolTab = 'insert' | 'presets' | 'assets' | 'data' | 'fields'

export const TOOL_TABS: readonly ToolTab[] = ['insert', 'presets', 'assets', 'data', 'fields']

export const TOOL_LABEL: Record<ToolTab, string> = {
  insert: 'Insert',
  presets: 'Presets',
  assets: 'Assets',
  data: 'Test data',
  fields: 'Fields',
}

/** One line under each tool's name, in the panel that opens. Here rather than
 * inside each panel: the panels are shown in more than one place, and a title
 * printed by both the frame and its contents reads as a stutter — which is
 * exactly how it looked. */
export const TOOL_HINT: Record<ToolTab, string | undefined> = {
  insert: 'lands beside what is selected, or inside it',
  presets: 'ready-made Jinja, configured before it lands',
  assets: 'logos, backgrounds and fonts kept by this instance',
  data: 'the preview renders with it',
  fields: undefined,
}

const TOOL_ICON: Record<ToolTab, IconName> = {
  insert: 'plus-square',
  presets: 'layers',
  assets: 'image',
  data: 'braces',
  fields: 'templates',
}

export default function ToolRail({
  tabs,
  open,
  onOpen,
}: {
  /** Which tools this instance offers: assets need storage behind them, and
   * fields have a column of their own in Visual mode. */
  tabs: readonly ToolTab[]
  /** The tool showing, or null when the panel is closed. */
  open: ToolTab | null
  onOpen: (tab: ToolTab | null) => void
}) {
  return (
    <nav className="tool-rail" aria-label="Tools">
      {tabs.map((tab) => (
        <button
          key={tab}
          className={open === tab ? 'tool-button active' : 'tool-button'}
          // Pressed, not selected: the panel is a thing that is open or shut,
          // and pressing the same button again shuts it.
          aria-pressed={open === tab}
          aria-label={TOOL_LABEL[tab]}
          title={TOOL_LABEL[tab]}
          onClick={() => onOpen(open === tab ? null : tab)}
        >
          <Icon name={TOOL_ICON[tab]} size={18} />
          <span>{TOOL_LABEL[tab]}</span>
        </button>
      ))}
    </nav>
  )
}
