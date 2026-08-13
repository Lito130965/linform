/**
 * Editor operations the assistant can ask for, instead of a template.
 *
 * The assistant's only way to change anything used to be a complete document in
 * an ```html block. For "make the page A5" or "put a page number in the footer"
 * that is a bad answer twice over: the user reads a diff of the whole file to
 * find three lines, and whatever the model wrote by hand is what the document
 * now has — a footer built as `position: fixed`, a page number as a string in a
 * margin box — none of which the visual editor can select, style or move.
 *
 * The editor already has these as operations. An assistant that asks for THEM
 * gets the markup the panels produce, by construction: the same footer the
 * header switch writes, the same counter spans the preset inserts, the same
 * `@page` rule the page panel maintains. The change is small, reviewable, and
 * afterwards the document is still editable by hand.
 *
 * The contract is a fenced ```linform-ops block holding a JSON array. This
 * module parses it and refuses anything it does not recognise, by name — a
 * model that invents `{"op": "set-font"}` must be told, not quietly obeyed.
 *
 * Pure. What each operation DOES lives with the feature it belongs to; here we
 * only decide what was asked for.
 */

import { BLOCKS } from '../editor/blocks'
import { PAGE_SIZES } from '../editor/page-css'
import { PRESETS } from '../presets/registry'

export type Op =
  | {
      op: 'page'
      size?: string
      landscape?: boolean
      margin?: { top?: string; right?: string; bottom?: string; left?: string }
      background?: string | null
    }
  | { op: 'furniture'; edge: 'top' | 'bottom'; on: boolean }
  | { op: 'block'; id: string }
  | { op: 'preset'; id: string; params?: Record<string, string> }
  | { op: 'field'; expression: string }

export interface OpsParse {
  ops: Op[]
  /** Everything refused, with the reason — shown, never swallowed: an
   * operation that vanishes silently reads as an editor that ignored the
   * assistant. */
  rejected: { what: string; why: string }[]
}

/** A length as CSS accepts it here: a number with a print unit. Deliberately
 * narrow — `margin: 2rem` on a sheet of paper is not a margin anybody meant. */
const LENGTH = /^-?\d+(?:\.\d+)?(?:mm|cm|in|pt|px)$/

const EDGES = new Set(['top', 'bottom'])
const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'] as const

function parseOne(raw: unknown): { ok: Op } | { why: string; what: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { what: String(raw), why: 'not an object' }
  }
  const value = raw as Record<string, unknown>
  const name = typeof value.op === 'string' ? value.op : ''
  const text = (key: string): string => (typeof value[key] === 'string' ? (value[key] as string) : '')

  switch (name) {
    case 'page': {
      const out: Op = { op: 'page' }
      if (value.size !== undefined) {
        const size = text('size')
        if (!(PAGE_SIZES as readonly string[]).includes(size)) {
          return { what: `page size ${size || '?'}`, why: `not one of ${PAGE_SIZES.join(', ')}` }
        }
        out.size = size
      }
      if (value.landscape !== undefined) {
        if (typeof value.landscape !== 'boolean') {
          return { what: 'page landscape', why: 'must be true or false' }
        }
        out.landscape = value.landscape
      }
      if (value.margin !== undefined) {
        if (!value.margin || typeof value.margin !== 'object' || Array.isArray(value.margin)) {
          return { what: 'page margin', why: 'must be an object of sides' }
        }
        const given = value.margin as Record<string, unknown>
        const margin: Record<string, string> = {}
        for (const side of MARGIN_SIDES) {
          if (given[side] === undefined) continue
          const length = typeof given[side] === 'string' ? (given[side] as string) : ''
          if (!LENGTH.test(length)) {
            return { what: `margin ${side}: ${length || '?'}`, why: 'expected a length like 20mm' }
          }
          margin[side] = length
        }
        if (Object.keys(margin).length === 0) {
          return { what: 'page margin', why: 'no side given' }
        }
        out.margin = margin
      }
      if (value.background !== undefined) {
        out.background = value.background === null ? null : text('background')
      }
      if (Object.keys(out).length === 1) return { what: 'page', why: 'nothing to change' }
      return { ok: out }
    }

    case 'furniture': {
      const edge = text('edge')
      if (!EDGES.has(edge)) return { what: `furniture ${edge || '?'}`, why: 'edge is top or bottom' }
      if (typeof value.on !== 'boolean') {
        return { what: `furniture ${edge}`, why: 'on must be true or false' }
      }
      return { ok: { op: 'furniture', edge: edge as 'top' | 'bottom', on: value.on } }
    }

    case 'block': {
      const id = text('id')
      if (!BLOCKS.some((block) => block.id === id)) {
        return { what: `block ${id || '?'}`, why: `no such block (${BLOCKS.map((b) => b.id).join(', ')})` }
      }
      return { ok: { op: 'block', id } }
    }

    case 'preset': {
      const id = text('id')
      const preset = PRESETS.find((p) => p.id === id)
      if (!preset) {
        return { what: `preset ${id || '?'}`, why: `no such preset (${PRESETS.map((p) => p.id).join(', ')})` }
      }
      const params: Record<string, string> = {}
      if (value.params !== undefined) {
        if (!value.params || typeof value.params !== 'object' || Array.isArray(value.params)) {
          return { what: `preset ${id}`, why: 'params must be an object' }
        }
        for (const [key, given] of Object.entries(value.params as Record<string, unknown>)) {
          if (!preset.params.some((p) => p.name === key)) {
            return {
              what: `preset ${id} parameter ${key}`,
              why: `not a parameter of this preset (${preset.params.map((p) => p.name).join(', ') || 'none'})`,
            }
          }
          params[key] = String(given)
        }
      }
      return { ok: { op: 'preset', id, params } }
    }

    case 'field': {
      const expression = text('expression').trim()
      // A path, optionally with filters after it — the same shape the field
      // chips carry. Anything else is a Jinja statement, which is not a field.
      if (!/^[A-Za-z_][\w.]*(?:\s*\|[^{}]*)?$/.test(expression)) {
        return { what: `field ${expression || '?'}`, why: 'expected a value path like customer.name' }
      }
      return { ok: { op: 'field', expression } }
    }

    default:
      return { what: name || 'an operation', why: 'not an operation this editor has' }
  }
}

/** Pull the operations out of a reply. Null when the reply carries none, so a
 * plain answer is not mistaken for an empty edit. */
export function extractOps(reply: string): OpsParse | null {
  const fence = /```linform-ops\s*\n([\s\S]*?)```/i.exec(reply)
  if (!fence) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fence[1])
  } catch (e) {
    return { ops: [], rejected: [{ what: 'the operations block', why: (e as Error).message }] }
  }
  // Either a bare array or `{ "ops": [...] }`; models write both and the
  // difference means nothing.
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { ops?: unknown }).ops)
      ? ((parsed as { ops: unknown[] }).ops)
      : null
  if (!list) return { ops: [], rejected: [{ what: 'the operations block', why: 'expected a JSON array' }] }

  const ops: Op[] = []
  const rejected: { what: string; why: string }[] = []
  for (const raw of list) {
    const result = parseOne(raw)
    if ('ok' in result) ops.push(result.ok)
    else rejected.push({ what: result.what, why: result.why })
  }
  return { ops, rejected }
}

/** Chat text with the operations block replaced by a marker, the same way a
 * template block is: the JSON is shown as a list of what will happen, and
 * twice is once too many. */
export function withoutOpsBlock(reply: string): string {
  return reply.replace(/```linform-ops\s*\n[\s\S]*?```/i, '').trim()
}

/** One line a person can read, for each operation. The panel lists these
 * before anything is applied — "Apply" on an opaque blob is not a choice. */
export function describeOp(op: Op): string {
  switch (op.op) {
    case 'page': {
      const parts: string[] = []
      if (op.size) parts.push(op.landscape ? `${op.size} landscape` : op.size)
      else if (op.landscape !== undefined) parts.push(op.landscape ? 'landscape' : 'portrait')
      if (op.margin) {
        parts.push(
          'margins ' +
            MARGIN_SIDES.filter((side) => op.margin?.[side])
              .map((side) => `${side} ${op.margin?.[side]}`)
              .join(', '),
        )
      }
      if (op.background !== undefined) {
        parts.push(op.background ? `background ${op.background}` : 'no background')
      }
      return `Page: ${parts.join('; ')}`
    }
    case 'furniture':
      return `${op.on ? 'Add' : 'Remove'} the ${op.edge === 'top' ? 'header' : 'footer'}`
    case 'block':
      return `Insert ${BLOCKS.find((b) => b.id === op.id)?.label ?? op.id}`
    case 'preset': {
      const preset = PRESETS.find((p) => p.id === op.id)
      const given = Object.entries(op.params ?? {})
      const detail = given.length > 0 ? ` (${given.map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''
      return `Insert ${preset?.label ?? op.id}${detail}`
    }
    case 'field':
      return `Insert the field {{ ${op.expression} }}`
  }
}
