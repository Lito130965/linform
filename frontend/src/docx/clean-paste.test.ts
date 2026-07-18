// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { cleanPastedHtml } from './clean-paste'
import { suggestCodeFromFilename } from './import'

describe('cleanPastedHtml', () => {
  it('strips Word mso junk but keeps structure', () => {
    const word =
      '<html xmlns:o="urn:x"><head><style>.MsoNormal { mso-style: x; }</style></head><body>' +
      '<!--[if gte mso 9]><xml>junk</xml><![endif]-->' +
      '<p class="MsoNormal" style="mso-fareast-language: RU; margin: 0cm;">Привет <b>жирный</b><o:p></o:p></p>' +
      '</body></html>'
    expect(cleanPastedHtml(word)).toBe('<p>Привет <b>жирный</b></p>')
  })

  it('keeps table structure with colspan/rowspan, drops the rest of the attributes', () => {
    const html =
      '<table border="1" cellpadding="0" style="width: 601px;"><tbody>' +
      '<tr style="height: 12px;"><td colspan="2" width="300" style="border: solid;">A</td><td rowspan="2">B</td></tr>' +
      '</tbody></table>'
    expect(cleanPastedHtml(html)).toBe(
      '<table><tbody><tr><td colspan="2">A</td><td rowspan="2">B</td></tr></tbody></table>',
    )
  })

  it('unwraps unknown wrappers but keeps their content', () => {
    expect(cleanPastedHtml('<article><section><p>text</p></section></article>')).toBe('<p>text</p>')
  })

  it('drops images pointing at local files, keeps data: and http', () => {
    const html =
      '<img src="file:///C:/Users/x/img001.png"><img src="data:image/png;base64,AAA" alt="ok">' +
      '<img src="https://example.com/x.png">'
    const out = cleanPastedHtml(html)
    expect(out).not.toContain('file:')
    expect(out).toContain('data:image/png;base64,AAA')
    expect(out).toContain('https://example.com/x.png')
  })

  it('drops scripts entirely', () => {
    expect(cleanPastedHtml('<p>ok</p><script>alert(1)</script>')).toBe('<p>ok</p>')
  })

  it('keeps lists and headings', () => {
    const html = '<h2 style="mso-x: 1;">Заголовок</h2><ul><li>раз</li><li>два</li></ul>'
    expect(cleanPastedHtml(html)).toBe('<h2>Заголовок</h2><ul><li>раз</li><li>два</li></ul>')
  })
})

describe('suggestCodeFromFilename', () => {
  it('transliterates and slugifies', () => {
    expect(suggestCodeFromFilename('Счёт-фактура (форма 12).docx')).toBe('schet-faktura_forma_12')
    expect(suggestCodeFromFilename('Invoice Final v2.DOCX')).toBe('invoice_final_v2')
    expect(suggestCodeFromFilename('!!!.docx')).toBe('imported')
  })
})
