import { describe, expect, it } from 'vitest'
import { extractHtmlBlock, isTruncated, replyProse } from './extract'

describe('extractHtmlBlock', () => {
  it('pulls a fenced html block', () => {
    const reply = 'I added a title.\n\n```html\n<h1>{{ t }}</h1>\n```\n\nPlaceholders: t'
    expect(extractHtmlBlock(reply)).toBe('<h1>{{ t }}</h1>')
  })

  it('accepts an untagged fence only if it is a document', () => {
    expect(extractHtmlBlock('```\n<style>x</style><p>y</p>\n```')).toBe('<style>x</style><p>y</p>')
    expect(extractHtmlBlock('```\nnpm install\n```')).toBeNull()
  })

  it('returns null for a clarification reply (no block)', () => {
    expect(extractHtmlBlock('1. Which column?\n2. How many mm?')).toBeNull()
  })

  it('prose replaces the block with a marker', () => {
    expect(replyProse('Done.\n```html\n<p>x</p>\n```')).toBe('Done.\n⟨template⟩')
  })
})

describe('isTruncated', () => {
  /**
   * What a cut-off answer looks like from here: the model started the template
   * and the stream ended — an output limit, or a dropped connection. Nothing
   * can be applied from it, because there is no closing fence to match, and
   * until this existed nothing said so: the user got a wall of raw HTML and an
   * unchanged document, which reads as "it ignored me" rather than "it was
   * interrupted".
   */
  it('sees a block that was never closed', () => {
    expect(isTruncated('Here it is.\n```html\n<h1>Title</h1>\n<p>half a doc')).toBe(true)
  })

  it('is quiet about replies that closed what they opened', () => {
    expect(isTruncated('Done.\n```html\n<p>x</p>\n```')).toBe(false)
    expect(isTruncated('Which column did you mean?')).toBe(false)
    // Two blocks, both closed: operations, and markup quoted beside them.
    expect(isTruncated('a\n```linform-ops\n[]\n```\nb\n```html\n<p>x</p>\n```')).toBe(false)
  })
})
