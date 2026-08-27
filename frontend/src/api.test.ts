// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'

/**
 * The journal asks for "the templates" and gets a page.
 *
 * The endpoint answers a hundred at a time and says how many there are. Asking
 * for it plainly showed the first hundred and nothing at all to say the rest
 * existed — on a busy instance, a template created today was simply not in the
 * list, with no way for its author to tell why. The browser suite found it by
 * crossing a hundred templates in one run.
 */

/** Just enough of a Response for this call: a stub rather than the real class,
 * so the test does not depend on which fetch globals the environment happens to
 * provide. */
const page = (codes: string[], total: number | null) =>
  ({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-total-count' && total !== null ? String(total) : null,
    },
    json: async () => codes.map((code) => ({ code, name: code, directory_id: null })),
  }) as unknown as Response

afterEach(() => vi.unstubAllGlobals())

describe('listing the templates', () => {
  it('follows the pages to the end', async () => {
    const asked: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked.push(url)
        return url.includes('offset=0') ? page(['a', 'b'], 3) : page(['c'], 3)
      }),
    )

    const found = await api.listTemplates()
    expect(found.map((t) => t.code)).toEqual(['a', 'b', 'c'])
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('offset=2')
  })

  it('asks once when the service says nothing about a total', async () => {
    // An older service, or a proxy that strips the header: one page is all
    // there is to go on, and looping on a guess would never end.
    const fetcher = vi.fn(async () => page(['only'], null))
    vi.stubGlobal('fetch', fetcher)
    expect(await api.listTemplates()).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('asks once when one page holds everything', async () => {
    const fetcher = vi.fn(async () => page(['only'], 1))
    vi.stubGlobal('fetch', fetcher)
    expect(await api.listTemplates()).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('stops on an empty page however large the count claims to be', async () => {
    // A wrong header must not become a loop that never finishes.
    const fetcher = vi.fn(async (url: string) =>
      String(url).includes('offset=0') ? page(['a'], 9999) : page([], 9999),
    )
    vi.stubGlobal('fetch', fetcher)
    expect(await api.listTemplates()).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
