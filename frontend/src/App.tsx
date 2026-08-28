import { useEffect, useState } from 'react'
import TemplateJournal from './components/TemplateJournal'
import Editor, { type ScratchDoc } from './components/Editor'
import ExamplesGallery from './components/ExamplesGallery'
import SettingsPanel from './components/SettingsPanel'
import Icon, { type IconName } from './components/Icon'
import Login from './components/Login'
import { api, setAuthLostHandler, type Capabilities, type Me } from './api'
import { layoutFor, useViewportWidth } from './layout'

type Tab = 'templates' | 'examples' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('templates')
  const [selected, setSelected] = useState<string | null>(null)
  const [scratch, setScratch] = useState<ScratchDoc | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [ready, setReady] = useState(false)
  const width = useViewportWidth()
  const layout = layoutFor(width)
  const [sidebarOpen, setSidebarOpen] = useState(!layout.collapseSidebar)
  const [narrowAck, setNarrowAck] = useState(false)

  // Ask the instance what it offers, then who we are — in that order, because
  // the second question only makes sense where there are accounts to answer it.
  // A demo node has none: asking anyway would 404 and be read as an expired
  // session, putting a sign-in card in front of a service nobody can sign in to.
  useEffect(() => {
    setAuthLostHandler(() => setMe((m) => (m ? { ...m, authenticated: false } : m)))
    api
      .capabilities()
      .catch(() => ({
        role: 'all',
        tabs: ['templates', 'examples', 'settings'],
        accounts: true,
        assets: true,
      }))
      .then(async (found) => {
        setCapabilities(found)
        setTab((found.tabs[0] as Tab) ?? 'examples')
        if (!found.accounts) {
          setMe({ authenticated: true, auth_enabled: false, username: '', role: '' })
          return
        }
        try {
          setMe(await api.me())
        } catch {
          setMe({ authenticated: false, auth_enabled: true, username: '', role: '' })
        }
      })
      .finally(() => setReady(true))
    return () => setAuthLostHandler(null)
  }, [])

  // Follow the breakpoint when it is crossed, but never fight a manual toggle
  // in between — the effect only fires on an actual change of the mode.
  useEffect(() => setSidebarOpen(!layout.collapseSidebar), [layout.collapseSidebar])

  // Opening a document folds the navigation to its rail, at any width. The
  // list of templates is how you get to a document; once you are in one it is
  // 240 px of somewhere else, taken from the page being worked on. The manual
  // toggle still wins — this fires on the change of document, not on renders.
  const documentOpen = selected !== null || scratch !== null
  useEffect(() => {
    if (documentOpen) setSidebarOpen(false)
  }, [documentOpen])

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
          The template editor draws a printed page at its real size, and an A4 sheet is 794px
          wide before anything is put beside it.
        </p>
        <p className="muted">
          This window is {width}px. A whole page fits from 900px, where the preview becomes a tab
          and the inspector opens over the page; from 1280px they are columns of their own.
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
  // Everything, until the service says otherwise — the fallback matters only
  // when the capability call itself failed, and a full editor is the safer
  // thing to fall back to than an empty rail.
  const tabs = capabilities?.tabs ?? ['templates', 'examples', 'settings']

  async function logout() {
    await api.logout()
    setMe((m) => (m ? { ...m, authenticated: false } : m))
  }

  const navItem = (t: Tab, icon: IconName, label: string) => (
    <button className={tab === t ? 'nav-item active' : 'nav-item'} onClick={() => go(t)}>
      <Icon name={icon} />
      {label}
    </button>
  )

  return (
    <div className={overlaidSidebar ? 'app rail-held' : 'app'}>
      <aside className={sidebarClass}>
        {/* aria-label, not just title: a tooltip is not an accessible name —
            several screen readers ignore it, and it is invisible from the
            keyboard. The glyph alone reads as nothing. */}
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? 'Hide the navigation' : 'Show the navigation'}
          title={sidebarOpen ? 'Hide the navigation' : 'Show the navigation'}
          aria-expanded={sidebarOpen}
        >
          <Icon name="menu" size={18} />
        </button>
        {sidebarOpen && (
          <>
            <h1 className="logo">Linform</h1>
            {/* Only what this instance actually has. The list comes from the
                service, so a demo shows the gallery and nothing else without
                the browser having to know what a demo is. */}
            <nav className="nav">
              {tabs.includes('templates') && navItem('templates', 'templates', 'Templates')}
              {tabs.includes('examples') && navItem('examples', 'examples', 'Examples')}
              {tabs.includes('settings') && navItem('settings', 'settings', 'Settings')}
            </nav>
            {/* Where this came from. On the demo especially: somebody who
                likes what they are looking at should not have to guess how to
                run it themselves. */}
            <a
              className="repo-link"
              href="https://github.com/Lito130965/linform"
              target="_blank"
              rel="noreferrer"
            >
              Source on GitHub ↗
            </a>
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
          <Editor
            key={selected}
            code={selected}
            overlayPanels={layout.overlayPanels}
            assets={capabilities?.assets ?? true}
          />
        ) : scratch ? (
          <Editor
            key={`scratch:${scratch.id}`}
            code={scratch.id}
            scratch={scratch}
            onExitScratch={() => setScratch(null)}
            overlayPanels={layout.overlayPanels}
            assets={capabilities?.assets ?? true}
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
