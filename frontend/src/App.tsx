import { useEffect, useState } from 'react'
import TemplateJournal from './components/TemplateJournal'
import Editor, { type ScratchDoc } from './components/Editor'
import ExamplesGallery from './components/ExamplesGallery'
import SettingsPanel from './components/SettingsPanel'
import Login from './components/Login'
import { api, setAuthLostHandler, type Me } from './api'
import { layoutFor, useViewportWidth } from './layout'

type Tab = 'templates' | 'examples' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('templates')
  const [selected, setSelected] = useState<string | null>(null)
  const [scratch, setScratch] = useState<ScratchDoc | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const width = useViewportWidth()
  const layout = layoutFor(width)
  const [sidebarOpen, setSidebarOpen] = useState(!layout.collapseSidebar)
  const [narrowAck, setNarrowAck] = useState(false)

  // Ask who we are once on load; a token that later stops working drops us
  // back to the login screen instead of leaving a half-authed UI.
  useEffect(() => {
    setAuthLostHandler(() => setMe((m) => (m ? { ...m, authenticated: false } : m)))
    api
      .me()
      .then(setMe)
      .catch(() => setMe({ authenticated: false, auth_enabled: true, username: '', role: '' }))
      .finally(() => setReady(true))
    return () => setAuthLostHandler(null)
  }, [])

  // Follow the breakpoint when it is crossed, but never fight a manual toggle
  // in between — the effect only fires on an actual change of the mode.
  useEffect(() => setSidebarOpen(!layout.collapseSidebar), [layout.collapseSidebar])

  if (!ready) return <div className="app-boot" />

  // Auth enabled and no valid session — nothing but the sign-in card.
  if (me && me.auth_enabled && !me.authenticated) {
    return <Login onLoggedIn={setMe} />
  }

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

  const overlaidSidebar = layout.collapseSidebar && sidebarOpen
  const sidebarClass = ['sidebar', sidebarOpen ? '' : 'collapsed', overlaidSidebar ? 'overlay' : '']
    .filter(Boolean)
    .join(' ')

  // Switching tab always drops any open document, so the tab's landing shows.
  const go = (t: Tab) => {
    setTab(t)
    setSelected(null)
    setScratch(null)
    if (layout.collapseSidebar) setSidebarOpen(false)
  }

  const showAccount = me?.auth_enabled && me?.authenticated

  async function logout() {
    await api.logout()
    setMe((m) => (m ? { ...m, authenticated: false } : m))
  }

  const navItem = (t: Tab, label: string) => (
    <button className={tab === t ? 'nav-item active' : 'nav-item'} onClick={() => go(t)}>
      {label}
    </button>
  )

  return (
    <div className={overlaidSidebar ? 'app rail-held' : 'app'}>
      <aside className={sidebarClass}>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Hide the navigation' : 'Show the navigation'}
          aria-expanded={sidebarOpen}
        >
          ☰
        </button>
        {sidebarOpen && (
          <>
            <h1 className="logo">Linform</h1>
            <nav className="nav">
              {navItem('templates', '▤ Templates')}
              {navItem('examples', '★ Examples')}
              {navItem('settings', '⚙ Settings')}
            </nav>
            {showAccount && (
              <div className="account-bar">
                <div className="account-who">
                  <span className="account-name">{me!.username}</span>
                  <span className="account-role">{me!.role}</span>
                </div>
                <button className="btn small" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </>
        )}
      </aside>
      <main className="main">
        {selected ? (
          <Editor key={selected} code={selected} overlayPanels={layout.overlayPanels} />
        ) : scratch ? (
          <Editor
            key={`scratch:${scratch.id}`}
            code={scratch.id}
            scratch={scratch}
            onExitScratch={() => setScratch(null)}
            overlayPanels={layout.overlayPanels}
          />
        ) : tab === 'templates' ? (
          <TemplateJournal onOpen={(code) => setSelected(code)} />
        ) : tab === 'examples' ? (
          <ExamplesGallery onOpen={(doc) => setScratch(doc)} />
        ) : (
          me && <SettingsPanel me={me} />
        )}
      </main>
    </div>
  )
}
