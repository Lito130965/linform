/**
 * What a person typed into a spacing box, and what the document should get.
 *
 * The interesting cases are the three outcomes: a value, a request to clear the
 * property, and something that is not a length at all. Collapsing the last two
 * into "empty" is how an editor silently deletes a margin because somebody
 * typed "12 mm." with a full stop.
 */

import { describe, expect, it } from 'vitest'
import { displayValue, mmHint, provenanceOf, pxToMm, readLengthInput } from './box-model'

describe('reading what was typed', () => {
  it('treats a bare number as millimetres, because this is paper', () => {
    expect(readLengthInput('12')).toEqual({ kind: 'set', value: '12mm' })
    expect(readLengthInput('2.5')).toEqual({ kind: 'set', value: '2.5mm' })
    expect(readLengthInput('-3')).toEqual({ kind: 'set', value: '-3mm' })
  })

  it('keeps any unit that was named', () => {
    expect(readLengthInput('10px')).toEqual({ kind: 'set', value: '10px' })
    expect(readLengthInput('1.5 cm')).toEqual({ kind: 'set', value: '1.5cm' })
    expect(readLengthInput('50%')).toEqual({ kind: 'set', value: '50%' })
    expect(readLengthInput('12PT')).toEqual({ kind: 'set', value: '12pt' })
  })

  it('accepts auto as a value in its own right', () => {
    expect(readLengthInput('auto')).toEqual({ kind: 'set', value: 'auto' })
    expect(readLengthInput('  AUTO ')).toEqual({ kind: 'set', value: 'auto' })
  })

  it('reads an empty box as "clear it", not as zero', () => {
    // Clearing returns the element to whatever the template's stylesheet says,
    // which is a different statement from setting a zero.
    expect(readLengthInput('')).toEqual({ kind: 'clear' })
    expect(readLengthInput('   ')).toEqual({ kind: 'clear' })
  })

  it('refuses anything that is not a length instead of clearing it', () => {
    for (const typed of ['12 mm.', 'twelve', '12mmm', '1,5mm', '10 px 4', 'calc(1mm)']) {
      expect(readLengthInput(typed), `"${typed}" should not have been accepted`).toEqual({
        kind: 'invalid',
      })
    }
  })
})

describe('showing what is there', () => {
  it('converts pixels to millimetres at the ratio the browser uses', () => {
    expect(pxToMm(96)).toBe(25.4)
    expect(pxToMm(0)).toBe(0)
  })

  it('rounds to a tenth of a millimetre', () => {
    // Finer than a printer resolves, and finer than anyone sets by hand.
    expect(pxToMm(37.795)).toBe(10)
    expect(pxToMm(1)).toBe(0.3)
  })

  it('offers no hint for a computed value that is not a length', () => {
    expect(mmHint('auto')).toBe('')
    expect(mmHint('')).toBe('')
    expect(mmHint('37.795px')).toBe('10')
  })

  it('shows a stored length in millimetres and anything else verbatim', () => {
    expect(displayValue('12mm')).toBe('12')
    expect(displayValue('37.795px')).toBe('10')
    // Rewriting somebody's 50% as millimetres would be a silent edit.
    expect(displayValue('50%')).toBe('50%')
    expect(displayValue('auto')).toBe('auto')
    expect(displayValue('')).toBe('')
  })

  it('separates a value set here from one the stylesheet decided', () => {
    expect(provenanceOf('12mm')).toBe('set')
    expect(provenanceOf('')).toBe('inherited')
    expect(provenanceOf('   ')).toBe('inherited')
  })
})
