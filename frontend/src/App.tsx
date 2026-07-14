import { useState } from 'react'
import TemplateList from './components/TemplateList'
import Editor from './components/Editor'

export default function App() {
  const [selected, setSelected] = useState<string | null>(null)

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="logo">Linform</h1>
        <TemplateList selected={selected} onSelect={setSelected} />
      </aside>
      <main className="main">
        {selected ? (
          <Editor key={selected} code={selected} />
        ) : (
          <div className="empty-state">Select or create a template to start editing</div>
        )}
      </main>
    </div>
  )
}
