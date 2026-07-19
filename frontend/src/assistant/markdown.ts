import MarkdownIt from 'markdown-it'

/** Renders the assistant's prose, which arrives as markdown.
 *
 * markdown-it is a bundled npm dependency, so the built app carries it in its
 * own JS — nothing is fetched at runtime and the deployment needs no internet
 * access at all.
 *
 * `html: false` is the security decision: model output is not trusted markup,
 * and with raw HTML disabled markdown-it escapes any tags in the source instead
 * of passing them through. That removes the XSS surface without pulling in a
 * sanitiser. */
const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: true,
})

export function renderMarkdown(text: string): string {
  return md.render(text)
}
