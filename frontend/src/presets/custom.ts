/**
 * User-defined presets, saved in the browser.
 *
 * A custom preset is the simplest useful shape: a name, an optional
 * description, and a Jinja snippet. It carries no parameter schema — the
 * author edits the inserted markup in place, the same way they would any
 * template code — so there is no hidden contract, matching Способ A. Snippets
 * are validated with detect() before they can be saved, so a custom preset can
 * never be one the visual editor cannot represent.
 *
 * Storage is localStorage: these belong to whoever authors on this machine,
 * there is no backend for them, and they are deliberately not shared — a
 * teammate's half-finished snippet is not something to push at everyone.
 */

import type { Preset } from './registry'

const KEY = 'linform-custom-presets'

export interface CustomPreset {
  id: string
  label: string
  description: string
  source: string
}

export function loadCustom(): CustomPreset[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValid) : []
  } catch {
    return []
  }
}

function isValid(p: unknown): p is CustomPreset {
  return (
    !!p &&
    typeof p === 'object' &&
    typeof (p as CustomPreset).id === 'string' &&
    typeof (p as CustomPreset).label === 'string' &&
    typeof (p as CustomPreset).source === 'string'
  )
}

function save(list: CustomPreset[]): void {
  localStorage.setItem(KEY, JSON.stringify(list))
}

export function addCustom(label: string, description: string, source: string): CustomPreset {
  const preset: CustomPreset = {
    id: `custom-${Date.now().toString(36)}`,
    label: label.trim(),
    description: description.trim(),
    source,
  }
  save([...loadCustom(), preset])
  return preset
}

export function removeCustom(id: string): void {
  save(loadCustom().filter((p) => p.id !== id))
}

/** Adapt a stored snippet to the Preset shape the palette and insert path use.
 * No params: generate() ignores its argument and returns the fixed source. */
export function toPreset(custom: CustomPreset): Preset {
  return {
    id: custom.id,
    group: 'Custom',
    label: custom.label,
    description: custom.description || 'Custom preset',
    convertsFrom: [],
    params: [],
    generate: () => custom.source,
  }
}
