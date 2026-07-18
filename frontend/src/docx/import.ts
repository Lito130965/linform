import mammoth from 'mammoth'

/** Print scaffolding for imported documents: mammoth outputs semantic HTML
 * (that is its whole point), so a document arrives unstyled; this baseline
 * makes it look like a document again and gives @page for the paged preview.
 * Everything here is ordinary template CSS the author can edit in Code mode. */
const BASE_PRINT_STYLE = `<style>
  @page { size: A4; margin: 20mm 15mm; }
  body { font-family: sans-serif; font-size: 11pt; line-height: 1.4; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 4px 6px; vertical-align: top; }
  th { background: #f2f2f2; }
  img { max-width: 100%; }
</style>`

export interface DocxImportResult {
  html: string
  warnings: string[]
}

/** One-way conversion: .docx → template HTML. Images arrive inlined as
 * data: URIs (renderable as-is; they can be re-uploaded as assets later). */
export async function importDocxFile(file: File): Promise<DocxImportResult> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const warnings = result.messages
    .filter((m) => m.type === 'warning' || m.type === 'error')
    .map((m) => m.message)
  return { html: `${BASE_PRINT_STYLE}\n${result.value}`, warnings }
}

/** Suggested template code from a file name: "Счёт (форма 12).docx" → a
 * safe latin slug the code field accepts. */
export function suggestCodeFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '').toLowerCase()
  const translit: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
  }
  const slug = [...base]
    .map((ch) => translit[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
  return slug || 'imported'
}
