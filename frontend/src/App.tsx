import { useEffect, useState } from 'react'
import TemplateList from './components/TemplateList'
import Editor from './components/Editor'
import { layoutFor, useViewportWidth } from './layout'

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const width = useViewportWidth()
  const layout = layoutFor(width)
  const [sidebarOpen, setSidebarOpen] = useState(!layout.collapseSidebar)
  const [narrowAck, setNarrowAck] = useState(false)

  // Follow the breakpoint when it is crossed, but never fight a manual toggle
  // in between — the effect only fires on an actual change of the mode.
  useEffect(() => setSidebarOpen(!layout.collapseSidebar), [layout.collapseSidebar])

  if (layout.tooNarrow && !narrowAck) {
    return (
      <div className="too-narrow">
        <h1 className="logo">Linform</h1>
        <p>
          The template editor is built for a wide screen: the visual mode shows a full A4 page
          beside a live PDF preview.
        </p>
        <p className="muted">
          This window is {width}px. The editor is comfortable from 1280px, and best at 1600px or
          more.
        </p>
        <button className="btn" onClick={() => setNarrowAck(true)}>
          Open it anyway
        </button>
      </div>
    )
  }

  const sidebarClass = [
    'sidebar',
    sidebarOpen ? '' : 'collapsed',
    // Once folded, reopening must not shove the editor sideways.
    layout.collapseSidebar && sidebarOpen ? 'overlay' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="app">
      <aside className={sidebarClass}>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Hide the template list' : 'Show the template list'}
          aria-expanded={sidebarOpen}
        >
          ☰
        </button>
        {sidebarOpen && (
          <>
            <h1 className="logo">Linform</h1>
            <TemplateList
              selected={selected}
              onSelect={(code) => {
                setSelected(code)
                if (layout.collapseSidebar) setSidebarOpen(false)
              }}
            />
          </>
        )}
      </aside>
      <main className="main">
        {selected ? (
          <Editor key={selected} code={selected} overlayPanels={layout.overlayPanels} />
        ) : (
          <div className="empty-state">Select or create a template to start editing</div>
        )}
      </main>
    </div>
  )
}
