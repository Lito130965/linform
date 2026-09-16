/** The assistant contract: a reply either carries exactly one ```html block
 * (a template to apply) or none (a clarification / question). Extract the
 * block so the UI can offer "Apply"; the prose stays as the chat message. */
export function extractHtmlBlock(reply: string): string | null {
  const fence = /```html\s*\n([\s\S]*?)```/i.exec(reply)
  if (fence) return fence[1].trimEnd()
  // Some models drop the language tag; accept a plain fence only if it looks
  // like a full document, never a stray snippet.
  const plain = /```\s*\n([\s\S]*?)```/.exec(reply)
  if (plain && /<!doctype|<html|<style|<body/i.test(plain[1])) return plain[1].trimEnd()
  return null
}

/**
 * True when the reply opened a fenced block and never closed it.
 *
 * This is what a cut-off answer looks like: the model hit its output limit, or
 * the stream died halfway — a dropped connection does it too. Every function
 * above then finds nothing to apply, because there is no closing fence to match,
 * and the reply lands in the chat as a wall of raw HTML with the document
 * untouched. Reported by a user as "it wrote the whole template and nothing
 * changed", which is exactly what it looks like from the outside and gives no
 * hint that the answer was incomplete rather than ignored.
 *
 * Counting fences rather than parsing: a reply is one to three blocks of
 * markdown, and an odd number of ``` markers means the last one is still open.
 */
export function isTruncated(reply: string): boolean {
  return (reply.match(/```/g) ?? []).length % 2 === 1
}

/** Chat text with the html block replaced by a short marker, so the raw
 * template does not flood the conversation. */
export function replyProse(reply: string): string {
  return reply.replace(/```html\s*\n[\s\S]*?```/i, '⟨template⟩').replace(/```\s*\n[\s\S]*?```/, '⟨template⟩').trim()
}
