import { describe, expect, it } from 'vitest'
import { extractHtmlBlock, replyProse } from './extract'

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
