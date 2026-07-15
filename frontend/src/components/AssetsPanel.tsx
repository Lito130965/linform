import { useEffect, useRef, useState } from 'react'
import { api, AssetInfo } from '../api'

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Uploaded assets (logos, backgrounds). Click one to insert an <img> with
 * its immutable asset:// reference at the cursor. */
export default function AssetsPanel({ onInsert }: { onInsert: (text: string) => void }) {
  const [assets, setAssets] = useState<AssetInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const reload = () => {
    api.listAssets().then(setAssets).catch((e) => setError(e.message))
  }

  useEffect(reload, [])

  const upload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const asset = await api.uploadAsset(file)
      reload()
      onInsert(`<img src="${asset.url}" alt="${asset.filename}">`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="assets-panel">
      <label>
        Assets — click to insert at cursor
        <button
          className="btn small"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ marginLeft: 8 }}
        >
          {uploading ? 'Uploading…' : '+ Upload'}
        </button>
      </label>
      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
        }}
      />
      <div className="asset-grid">
        {assets.length === 0 && <span className="muted">no assets uploaded</span>}
        {assets.map((a) => (
          <button
            key={a.sha256}
            className="asset-item"
            title={`${a.filename} · ${humanSize(a.size)} — insert <img> at cursor`}
            onClick={() => onInsert(`<img src="${a.url}" alt="${a.filename}">`)}
          >
            {a.mime_type.startsWith('image/') ? (
              <img src={`/api/assets/${a.sha256}`} alt={a.filename} />
            ) : (
              <span className="asset-ext">{a.filename.split('.').pop()}</span>
            )}
            <span className="asset-name">{a.filename}</span>
          </button>
        ))}
      </div>
      {error && <div className="error-box small">{error}</div>}
    </div>
  )
}
