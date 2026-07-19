"""QR codes and barcodes as Jinja filters.

The consuming application sends the payload — an invoice id, a fiscal sign, a
tracking number — and the symbol is drawn here, so no one has to generate
images upstream or embed them in the JSON.

Two decisions worth keeping:

* **SVG, not PNG.** A barcode is line art. Vector stays exact at any print
  resolution, which matters because these are meant to be scanned off paper;
  a raster symbol rendered at the wrong DPI is the classic reason a scanner
  refuses to read it. It is also a fraction of the bytes.
* **A data: URI, not a URL.** The symbol travels inside the document, so it
  costs no fetch and touches none of the url_fetcher's SSRF policy.

Size belongs to the template, not here: give the <img> a physical width in mm
and the vector scales to it.
"""

import base64
from io import BytesIO

#: Refuse absurd payloads outright rather than melting a worker over a symbol
#: nobody could scan. Well beyond any real invoice id or fiscal sign.
MAX_PAYLOAD_CHARS = 1024

#: Symbologies python-barcode can draw. Named explicitly so a typo fails with a
#: list of what works instead of an obscure library error.
BARCODE_SYMBOLOGIES = (
    "code128",
    "code39",
    "ean13",
    "ean8",
    "upca",
    "isbn13",
    "issn",
    "itf",
    "pzn",
    "gs1_128",
)


class BarcodeError(Exception):
    """Bad input for a symbol; the message is safe to show the template author."""


def _svg_data_uri(svg: bytes) -> str:
    return "data:image/svg+xml;base64," + base64.b64encode(svg).decode("ascii")


def _check(value: object, what: str) -> str:
    text = "" if value is None else str(value)
    if not text:
        raise BarcodeError(f"{what} needs a value, got an empty one")
    if len(text) > MAX_PAYLOAD_CHARS:
        raise BarcodeError(
            f"{what} payload is {len(text)} characters, over the {MAX_PAYLOAD_CHARS} limit"
        )
    return text


def qr(value: object, error: str = "m", border: int = 2, dark: str = "#000") -> str:
    """``{{ order_id | qr }}`` -> an SVG data URI for <img src="...">.

    ``error`` is the correction level l/m/q/h: higher survives a worse print or
    a partly covered symbol, at the cost of a denser grid. ``border`` is the
    quiet zone in modules — the spec asks for 4, but 2 is usually enough on
    clean paper and saves room on a crowded form.
    """
    import segno

    text = _check(value, "qr")
    level = str(error).lower()
    if level not in ("l", "m", "q", "h"):
        raise BarcodeError(f"qr error level must be one of l, m, q, h — got {error!r}")
    try:
        # make_qr, never make: segno.make picks the smallest symbol that fits
        # and silently produces a Micro QR for short payloads. Micro QR has one
        # finder pattern instead of three, and most phone cameras and handheld
        # scanners refuse it — the symbol looks plausible on paper and then
        # cannot be read, which is the worst possible failure for a print form.
        symbol = segno.make_qr(text, error=level)
    except Exception as exc:  # data too large for any version
        raise BarcodeError(f"qr cannot encode this value: {exc}") from exc
    buf = BytesIO()
    # omitsize keeps width/height off the root element, so the template's CSS
    # decides the printed size instead of a hardcoded pixel count.
    symbol.save(buf, kind="svg", xmldecl=False, omitsize=True, border=int(border), dark=dark)
    return _svg_data_uri(buf.getvalue())


def barcode(
    value: object,
    symbology: str = "code128",
    text: bool = False,
    module_height: float = 12.0,
    quiet_zone: float = 2.0,
) -> str:
    """``{{ tracking | barcode('code128') }}`` -> an SVG data URI.

    ``text`` prints the human-readable digits under the bars; forms usually
    carry the number in their own layout already, so it defaults off.
    ``module_height`` and ``quiet_zone`` are millimetres.
    """
    import barcode as pybarcode
    from barcode.writer import SVGWriter

    payload = _check(value, "barcode")
    kind = str(symbology).lower()
    if kind not in BARCODE_SYMBOLOGIES:
        raise BarcodeError(
            f"unknown barcode symbology {symbology!r}; available: {', '.join(BARCODE_SYMBOLOGIES)}"
        )
    try:
        drawer = pybarcode.get(kind, payload, writer=SVGWriter())
    except Exception as exc:
        # Fixed-length symbologies reject bad input here (EAN-13 wants 12-13
        # digits and a valid checksum, and so on).
        raise BarcodeError(f"{kind} cannot encode {payload!r}: {exc}") from exc
    buf = BytesIO()
    try:
        drawer.write(
            buf,
            options={
                "write_text": bool(text),
                "module_height": float(module_height),
                "quiet_zone": float(quiet_zone),
            },
        )
    except Exception as exc:
        raise BarcodeError(f"{kind} could not be drawn: {exc}") from exc
    return _svg_data_uri(buf.getvalue())


#: Registered on the sandbox environment; the assistant discovers them by
#: introspection, so they need no separate announcement to the model.
FILTERS = {"qr": qr, "barcode": barcode}
