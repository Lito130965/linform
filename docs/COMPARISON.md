# How it compares

The fastest way to decide whether this is the wrong tool for you.

## Against other HTML-to-PDF services

| | Linform | Carbone | PDFMonkey | Gotenberg | wkhtmltopdf |
|---|---|---|---|---|---|
| Hosting | self-hosted | self-hosted or cloud | cloud only | self-hosted | library |
| Template format | HTML + Jinja2 | DOCX/XLSX/ODT | HTML | anything you send it | HTML |
| Template editing | built-in web editor, code **and** visual | your word processor | web editor | none — you bring the file | none |
| Versioning | immutable versions, publish, rollback, pinning | via your VCS | built-in | none | none |
| Engine | WeasyPrint (CSS Paged Media) | LibreOffice | Chromium | Chromium / LibreOffice | old WebKit |
| JavaScript in templates | no | no | yes | yes | limited |
| Async / batch API | no, by design | yes | yes | no | n/a |
| Your data leaves your network | never | only in cloud mode | yes | never | never |
| Maintained | yes | yes | yes | yes | **no — archived in 2023** |

**Where Linform is the better answer.** You need the printed page to be exact
and to stay exact for years — page furniture, running headers, counters, comb
fields — and you need whoever owns the form to be able to change it without a
deploy, while the application keeps calling one stable code. Nothing leaves
your network.

**Where it is the worse answer, plainly:**

- **Your templates are Word documents and their authors will not give that
  up.** Carbone's model is built for that; Linform imports `.docx` once, as a
  starting point, not as a living format.
- **You need JavaScript in templates**, or a layout that leans on CSS grid.
  Gotenberg or PDFMonkey render with a real browser; WeasyPrint does not.
- **You want a queue, retries and stored results out of the box.** Linform is
  deliberately synchronous — that machinery stays in your application (see
  [DECISIONS.md](DECISIONS.md#5-rendering-is-synchronous-with-a-ceiling-and-a-429)).
- **You want zero operations.** PDFMonkey is a hosted product; this is a
  container, a database and your own backups.
- **You need per-team isolation inside one instance.** There is no
  per-template permission model — run separate instances instead.
- **Raw throughput on huge volumes.** A browser-based renderer parallelises
  across more cores more readily; Linform's answer is more workers and more
  replicas.

## Against the DOCX branch

Carbone, docxtemplater and docxtpl fill placeholders in a Word file, which is a
genuinely good answer when the form's author lives in Word and the output is
meant to be editable.

Their common weakness is the last step: to reach PDF the document goes through
LibreOffice, and LibreOffice's rendering of a Word layout is *close*, not
identical — fonts substitute, a table stretches a millimetre, a page breaks one
row earlier. For a document that is read on screen this is invisible. For a form
that has to line up with a printed box, or match a filing from four years ago, it
is the whole problem.

Linform has no conversion step: what the editor shows and what the renderer
prints come from the same HTML and the same engine, pinned by version.

## Against report designers (Jasper, FastReport, Stimulsoft, SSRS)

This is the comparison most likely to be misread, because the tools look
adjacent and are not.

| | Linform | Jasper / FastReport / Stimulsoft / SSRS |
|---|---|---|
| **Where the data comes from** | **your application sends JSON; the service never connects to your database** | the report connects to the data source itself — the analyst writes SQL in the designer |
| Who writes the form | whoever owns the form, in a browser | a report developer, in a desktop designer |
| Output fidelity | one engine, versions pinned | engine per product, generally good |
| Licence | MIT | commercial, per-developer or per-server (JasperReports Library is LGPL) |

That first row is a difference in profession, not in feature list. If your
current workflow is "the analyst opens the designer and writes a query",
Linform does not replace that half at all: your application has to fetch the
data and pass it in. In exchange, business data never lives in the reporting
service — which is the promise the rest of this project is built on.
