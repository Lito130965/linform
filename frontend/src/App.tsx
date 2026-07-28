import { useEffect, useState } from 'react'
import TemplateList from './components/TemplateList'
import Editor, { type ScratchDoc } from './components/Editor'
import ExamplesGallery from './components/ExamplesGallery'
import Login from './components/Login'
import AccountsPanel from './components/AccountsPanel'
import { api, setAuthLostHandler, type Me } from './api'
import { layoutFor, useViewportWidth } from './layout'

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)
  const [showGallery, setShowGallery] = useState(false)
  const [scratch, setScratch] = useState<ScratchDoc | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
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

  // While the list floats it is out of flow, so the rail's 44px has to be held
  // open by the shell — otherwise the editor jumps sideways as it opens.
  const overlaidSidebar = layout.collapseSidebar && sidebarOpen
  const sidebarClass = [
    'sidebar',
    sidebarOpen ? '' : 'collapsed',
    // Once folded, reopening must not shove the editor sideways.
    overlaidSidebar ? 'overlay' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showAccount = me?.auth_enabled && me?.authenticated

  async function logout() {
    await api.logout()
    setMe((m) => (m ? { ...m, authenticated: false } : m))
  }

  return (
    <div className={overlaidSidebar ? 'app rail-held' : 'app'}>
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
            <button
              className={showGallery ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setShowGallery(true)
                setScratch(null)
                setSelected(null)
                if (layout.collapseSidebar) setSidebarOpen(false)
              }}
            >
              ★ Examples
            </button>
            <TemplateList
              selected={selected}
              onSelect={(code) => {
                setSelected(code)
                setShowGallery(false)
                setScratch(null)
                if (layout.collapseSidebar) setSidebarOpen(false)
              }}
            />
            {showAccount && (
              <div className="account-bar">
                <div className="account-who">
                  <span className="account-name">{me!.username}</span>
                  <span className="account-role">{me!.role}</span>
                </div>
                {me!.role === 'superuser' && (
                  <button className="btn small" onClick={() => setAccountsOpen(true)}>
                    Accounts
                  </button>
                )}
                <button className="btn small" onClick={logout}>
                  Sign out
                </button>
              </div>
            )}
          </>
        )}
      </aside>
      <main className="main">
        {scratch ? (
          <Editor
            key={`scratch:${scratch.id}`}
            code={scratch.id}
            scratch={scratch}
            onExitScratch={() => setScratch(null)}
            overlayPanels={layout.overlayPanels}
          />
        ) : showGallery ? (
          <ExamplesGallery onOpen={(doc) => setScratch(doc)} />
        ) : selected ? (
          <Editor key={selected} code={selected} overlayPanels={layout.overlayPanels} />
        ) : (
          <div className="empty-state">Select or create a template to start editing</div>
        )}
      </main>
      {accountsOpen && me && (
        <AccountsPanel me={me.username} onClose={() => setAccountsOpen(false)} />
      )}
    </div>
  )
}
