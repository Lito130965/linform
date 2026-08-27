// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getBoolPref,
  getNumPref,
  getStringPref,
  setBoolPref,
  setNumPref,
  setStringPref,
} from './prefs'

/**
 * Preferences are read on the way INTO a layout, never trusted as stored.
 *
 * What is in storage was written by whichever version of the editor the browser
 * last ran: a width from when the bounds were different, a tab that has since
 * been renamed away. None of those may be able to produce a column nobody can
 * see or a panel opening on nothing.
 */

beforeEach(() => localStorage.clear())

describe('numbers', () => {
  it('gives back what was stored, and the fallback when nothing was', () => {
    expect(getNumPref('w', 288, 240, 460)).toBe(288)
    setNumPref('w', 320)
    expect(getNumPref('w', 288, 240, 460)).toBe(320)
  })

  it('clamps a stored width into the bounds this version can use', () => {
    setNumPref('w', 9999)
    expect(getNumPref('w', 288, 240, 460)).toBe(460)
    setNumPref('w', 10)
    expect(getNumPref('w', 288, 240, 460)).toBe(240)
  })

  it('keeps zero, because zero means collapsed rather than narrow', () => {
    // Outside the clamp on purpose: a panel put away comes back the size it
    // was, and a clamped zero would come back as the minimum width instead.
    setNumPref('w', 0)
    expect(getNumPref('w', 288, 240, 460)).toBe(0)
  })

  it('falls back on anything that is not a number', () => {
    localStorage.setItem('linform.pref.w', 'wide')
    expect(getNumPref('w', 288, 240, 460)).toBe(288)
  })
})

describe('strings from a fixed set', () => {
  const tabs = ['properties', 'structure', 'fields'] as const

  it('takes one of the allowed values', () => {
    setStringPref('tab', 'structure')
    expect(getStringPref('tab', 'properties', tabs)).toBe('structure')
  })

  it('refuses a value that is no longer one of them', () => {
    // A tab renamed between versions would otherwise open the editor on
    // nothing at all.
    setStringPref('tab', 'presets')
    expect(getStringPref('tab', 'properties', tabs)).toBe('properties')
  })
})

describe('when the browser refuses storage', () => {
  it('reads a fallback and writes without throwing', () => {
    // A private window can deny localStorage outright. Not remembering a
    // column width is a small loss; failing to draw the editor is not.
    const denied = () => {
      throw new Error('denied')
    }
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)

    expect(getBoolPref('x', true)).toBe(true)
    expect(getNumPref('w', 288, 240, 460)).toBe(288)
    expect(() => setBoolPref('x', false)).not.toThrow()
    expect(() => setNumPref('w', 300)).not.toThrow()
    vi.restoreAllMocks()
  })
})
