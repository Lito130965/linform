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

/** Chat text with the html block replaced by a short marker, so the raw
 * template does not flood the conversation. */
export function replyProse(reply: string): string {
  return reply.replace(/```html\s*\n[\s\S]*?```/i, '⟨template⟩').replace(/```\s*\n[\s\S]*?```/, '⟨template⟩').trim()
}
