import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type ApiKeyCreated, type ApiKeyOut, type Me, type Role, type UserOut } from '../api'
import { getBoolPref, PREF_SHOW_CODES, setBoolPref } from '../prefs'
import { getTheme, setTheme, type Theme } from '../theme'

/** The Settings page (a nav tab, not a modal). Content adapts to the signed-in
 * principal: a superuser manages users and render keys; everyone gets the UI
 * preferences. In dev mode (auth off) the account sections are replaced by a
 * note on how to enable accounts. */
export default function SettingsPanel({ me }: { me: Me }) {
  const canManage = me.auth_enabled && me.role === 'superuser'
  return (
    <div className="settings">
      <h1>Settings</h1>

      {canManage ? (
        <>
          <UsersSection me={me.username} />
          <KeysSection />
        </>
      ) : me.auth_enabled ? (
        <section className="settings-section">
          <h2>Account</h2>
          <p className="muted">
            Signed in as <strong>{me.username}</strong> ({me.role}). Account and key management is
            available to superusers.
          </p>
        </section>
      ) : (
        <section className="settings-section">
          <h2>Accounts</h2>
          <p className="muted">
            Authentication is disabled (dev mode). Set <code>LINFORM_SUPERUSER</code> and{' '}
            <code>LINFORM_SUPERUSER_PASSWORD</code> to enable login and manage users and render keys
            here.
          </p>
        </section>
      )}

      <PreferencesSection />
    </div>
  )
}

function useError(): [string | null, (e: unknown) => void, () => void] {
  const [error, setError] = useState<string | null>(null)
  const report = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e))
  return [error, report, () => setError(null)]
}

function UsersSection({ me }: { me: string }) {
  const [users, setUsers] = useState<UserOut[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('editor')
  const [error, report, clear] = useError()

  const reload = () => api.listUsers().then(setUsers).catch(report)
  useEffect(() => {
    reload()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    clear()
    try {
      await api.createUser(username.trim(), password, role)
      setUsername('')
      setPassword('')
      await reload()
    } catch (err) {
      report(err)
    }
  }

  const withReload = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn()
      await reload()
    } catch (err) {
      report(err)
    }
  }

  async function resetPassword(u: UserOut) {
    const pw = window.prompt(`New password for ${u.username} (min 8 chars):`)
    if (!pw) return
    try {
      await api.setUserPassword(u.id, pw)
    } catch (err) {
      report(err)
    }
  }

  return (
    <section className="settings-section">
      <h2>Users</h2>
      <form className="accounts-new" onSubmit={create}>
        <input
          placeholder="username"
          aria-label="New user name"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="password (min 8)"
          aria-label="New user password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="editor">editor</option>
          <option value="superuser">superuser</option>
        </select>
        <button className="btn primary" type="submit" disabled={!username.trim() || password.length < 8}>
          Add user
        </button>
      </form>
      {error && <div className="login-error">{error}</div>}
      <table className="accounts-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Role</th>
            <th>Status</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.is_active ? '' : 'inactive'}>
              <td>
                {u.username}
                {u.username === me && <span className="muted"> (you)</span>}
              </td>
              <td>{u.role}</td>
              <td>{u.is_active ? 'active' : 'disabled'}</td>
              <td className="row-actions">
                <button className="btn small" onClick={() => resetPassword(u)}>
                  Password
                </button>
                <button
                  className="btn small"
                  onClick={withReload(() => api.setUserActive(u.id, !u.is_active))}
                  disabled={u.username === me}
                >
                  {u.is_active ? 'Disable' : 'Enable'}
                </button>
                <button
                  className="btn small danger"
                  onClick={withReload(async () => {
                    if (window.confirm(`Delete user ${u.username}?`)) await api.deleteUser(u.id)
                  })}
                  disabled={u.username === me}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function KeysSection() {
  const [keys, setKeys] = useState<ApiKeyOut[]>([])
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<ApiKeyCreated | null>(null)
  const [error, report, clear] = useError()

  const reload = () => api.listKeys().then(setKeys).catch(report)
  useEffect(() => {
    reload()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    clear()
    try {
      setFresh(await api.createKey(name.trim()))
      setName('')
      await reload()
    } catch (err) {
      report(err)
    }
  }

  async function remove(k: ApiKeyOut) {
    if (!window.confirm(`Revoke key "${k.name}"? Applications using it will stop rendering.`)) return
    try {
      await api.deleteKey(k.id)
      if (fresh?.id === k.id) setFresh(null)
      await reload()
    } catch (err) {
      report(err)
    }
  }

  return (
    <section className="settings-section">
      <h2>Render API keys</h2>
      <form className="accounts-new" onSubmit={create}>
        <input
          placeholder="key name, e.g. billing-app"
          aria-label="Render key name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!name.trim()}>
          Mint render key
        </button>
      </form>
      {fresh && (
        <div className="key-reveal">
          <strong>Copy this key now — it is shown only once:</strong>
          <code>{fresh.key}</code>
          <button className="btn small" onClick={() => navigator.clipboard?.writeText(fresh.key)}>
            Copy
          </button>
        </div>
      )}
      {error && <div className="login-error">{error}</div>}
      <table className="accounts-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Last used</th>
            <th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id}>
              <td>{k.name}</td>
              <td>
                <code>{k.prefix}…</code>
              </td>
              <td>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'never'}</td>
              <td className="row-actions">
                <button className="btn small danger" onClick={() => remove(k)}>
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function PreferencesSection() {
  const [showCodes, setShowCodes] = useState(() => getBoolPref(PREF_SHOW_CODES, true))
  const [theme, setThemeState] = useState<Theme>(() => getTheme())
  return (
    <section className="settings-section">
      <h2>Preferences</h2>
      <label className="pref-row" htmlFor="pref-theme">
        Theme
        <select
          id="pref-theme"
          value={theme}
          onChange={(e) => {
            const next = e.target.value as Theme
            setThemeState(next)
            setTheme(next)
          }}
        >
          <option value="system">Match the system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label className="pref-row" htmlFor="pref-show-codes">
        <input
          id="pref-show-codes"
          type="checkbox"
          checked={showCodes}
          onChange={(e) => {
            setShowCodes(e.target.checked)
            setBoolPref(PREF_SHOW_CODES, e.target.checked)
          }}
        />
        Show template codes in the journal
      </label>
      <p className="muted">These preferences are stored in this browser only.</p>
    </section>
  )
}
