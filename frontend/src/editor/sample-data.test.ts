import { describe, expect, it } from 'vitest'
import { checkData, fillMissing, generateSample, sampleFor } from './sample-data'

const parse = (json: string) => JSON.parse(json) as Record<string, unknown>

const INVOICE =
  '<h1>Invoice {{ number }} of {{ issued_date }}</h1>\n' +
  '<p>{{ customer.name }}, {{ customer.tax_id }}</p>\n' +
  '<table>{% for row in items %}<tr><td>{{ row.title }}</td>' +
  '<td>{{ row.price }}</td></tr>{% endfor %}</table>\n'

describe('building a payload from the template', () => {
  it('names every value the template reads', () => {
    const data = parse(generateSample(INVOICE).json)
    expect(Object.keys(data).sort()).toEqual(['customer', 'issued_date', 'items', 'number'])
  })

  it('turns a loop into an array of objects carrying the fields its body uses', () => {
    const items = parse(generateSample(INVOICE).json).items as Record<string, unknown>[]
    expect(Array.isArray(items)).toBe(true)
    // Two, because one row never shows that a repeat repeats.
    expect(items).toHaveLength(2)
    expect(Object.keys(items[0]).sort()).toEqual(['price', 'title'])
  })

  it('nests a dotted path into an object', () => {
    const data = parse(generateSample(INVOICE).json)
    expect(Object.keys(data.customer as object).sort()).toEqual(['name', 'tax_id'])
  })

  it('reads the canvas markers too, so it works while visual mode is open', () => {
    const canvasForm =
      '<table><tr data-jinja-for="row in metrics">' +
      '<td><span data-jinja-expr="row.label">x</span></td></tr></table>'
    const metrics = parse(generateSample(canvasForm).json).metrics as Record<string, unknown>[]
    expect(Object.keys(metrics[0])).toEqual(['label'])
  })

  it('gives an array of plain values when the loop variable is printed whole', () => {
    const data = parse(generateSample('{% for tag in tags %}{{ tag }}{% endfor %}').json)
    expect(data.tags).toEqual(['Sample', 'Sample'])
  })

  it('ignores what Jinja provides itself', () => {
    const data = parse(generateSample('{% for r in rows %}{{ loop.index }}{{ r.a }}{% endfor %}').json)
    expect('loop' in data).toBe(false)
  })

  it('is valid JSON even for a template that names nothing', () => {
    expect(parse(generateSample('<p>static text</p>').json)).toEqual({})
  })
})

describe('guessing a value worth previewing', () => {
  it('gives a date for a date and a number for an amount', () => {
    expect(sampleFor('issued_date')).toBe('2026-08-10')
    expect(sampleFor('total_price')).toBe('12 500.00')
    expect(sampleFor('quantity')).toBe(3)
  })

  it('falls back to something short rather than something clever', () => {
    expect(sampleFor('wibble')).toBe('Sample')
  })
})

describe('filling in what is missing', () => {
  it('keeps every value already there', () => {
    const edited = JSON.stringify({ number: 'REAL-42', customer: { name: 'Real Co' } })
    const data = parse(fillMissing(INVOICE, edited).json)
    expect(data.number).toBe('REAL-42')
    expect((data.customer as Record<string, unknown>).name).toBe('Real Co')
  })

  it('adds the keys the template has grown since', () => {
    const result = fillMissing(INVOICE, JSON.stringify({ number: 'REAL-42' }))
    const data = parse(result.json)
    expect(data).toHaveProperty('issued_date')
    expect((data.customer as Record<string, unknown>).tax_id).toBeDefined()
    expect(result.added).toContain('issued_date')
  })

  it('gives existing rows the field a new column reads, without replacing them', () => {
    const edited = JSON.stringify({ items: [{ title: 'Real widget' }] })
    const items = parse(fillMissing(INVOICE, edited).json).items as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Real widget')
    expect(items[0].price).toBeDefined()
  })

  it('starts over when what is there is not a JSON object at all', () => {
    expect(parse(fillMissing(INVOICE, 'not json').json)).toHaveProperty('number')
    expect(parse(fillMissing(INVOICE, '[1,2]').json)).toHaveProperty('number')
  })

  it('reports nothing added when the payload already covers the template', () => {
    const full = generateSample(INVOICE).json
    expect(fillMissing(INVOICE, full).added).toEqual([])
  })
})

describe('what the template and the data disagree about', () => {
  it('names what the template asks for and the data does not carry', () => {
    const check = checkData('<p>{{ title }} for {{ customer.name }}</p>', '{"title": "Report"}')
    expect(check?.missing).toEqual(['customer.name'])
  })

  it('looks inside a loop, one row being enough to count as carried', () => {
    const template = '{% for row in items %}<p>{{ row.name }} {{ row.price }}</p>{% endfor %}'
    const check = checkData(template, '{"items": [{"name": "A"}, {"name": "B", "price": 1}]}')
    expect(check?.missing).toEqual([])

    const short = checkData(template, '{"items": [{"name": "A"}]}')
    expect(short?.missing).toEqual(['items[].price'])
  })

  it('names what the data carries and the template never reads', () => {
    const check = checkData('<p>{{ title }}</p>', '{"title": "Report", "legacy_code": "X"}')
    expect(check?.unused).toEqual(['legacy_code'])
  })

  it('counts a value used only in a condition as read', () => {
    // The shape reader sees `{{ … }}` and loops; a value can also be named in a
    // test, a filter argument or an if. Calling one of those unused would be
    // telling somebody to delete data the template needs.
    const check = checkData('{% if paid %}<p>{{ title }}</p>{% endif %}', '{"title": "R", "paid": true}')
    expect(check?.unused).toEqual([])
  })

  it('says nothing at all when the JSON cannot be read', () => {
    // The panel already reports the parse error; saying it twice is noise.
    expect(checkData('<p>{{ title }}</p>', '{ not json')).toBeNull()
    expect(checkData('<p>{{ title }}</p>', '[1, 2]')).toBeNull()
  })
})
