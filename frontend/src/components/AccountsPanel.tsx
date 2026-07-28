import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type ApiKeyCreated, type ApiKeyOut, type Role, type UserOut } from '../api'

/** Superuser-only account management, shown as a modal over the editor. Two
 * things live here: the human editor accounts, and the render API keys that
 * consuming applications authenticate with. A newly minted key is shown once —
 * there is no way to retrieve it later, by design. */
export default function AccountsPanel({ me, onClose }: { me: string; onClose: () => void }) {
  const [tab, setTab] = useState<'users' | 'keys'>('users')
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog accounts" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <strong>Accounts</strong>
          <div className="accounts-tabs">
            <button
              className={`btn small ${tab === 'users' ? 'primary' : ''}`}
              onClick={() => setTab('users')}
            >
              Users
            </button>
            <button
              className={`btn small ${tab === 'keys' ? 'primary' : ''}`}
              onClick={() => setTab('keys')}
            >
              Render keys
            </button>
          </div>
          <button className="btn small" onClick={onClose}>
            ✕
          </button>
        </div>
        {tab === 'users' ? <Users me={me} /> : <Keys />}
      </div>
    </div>
  )
}

function useError(): [string | null, (e: unknown) => void, () => void] {
  const [error, setError] = useState<string | null>(null)
  const report = (e: unknown) => setError(e instanceof ApiError ? e.message : String(e))
  return [error, report, () => setError(null)]
}

function Users({ me }: { me: string }) {
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

  async function toggleActive(u: UserOut) {
    try {
      await api.setUserActive(u.id, !u.is_active)
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

  async function remove(u: UserOut) {
    if (!window.confirm(`Delete user ${u.username}?`)) return
    try {
      await api.deleteUser(u.id)
      await reload()
    } catch (err) {
      report(err)
    }
  }

  return (
    <div className="accounts-body">
      <form className="accounts-new" onSubmit={create}>
        <input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input
          type="password"
          placeholder="password (min 8)"
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
            <th></th>
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
                <button className="btn small" onClick={() => toggleActive(u)} disabled={u.username === me}>
                  {u.is_active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn small danger" onClick={() => remove(u)} disabled={u.username === me}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Keys() {
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
      const created = await api.createKey(name.trim())
      setFresh(created)
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
    <div className="accounts-body">
      <form className="accounts-new" onSubmit={create}>
        <input
          placeholder="key name, e.g. billing-app"
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
            <th></th>
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
    </div>
  )
}
