"""PDF/A and PDF/UA: the document says which standard it claims.

WeasyPrint has written these variants for several releases; the service simply
never offered the choice. So what is worth testing is not that the engine can do
it — that is the engine's own suite — but that the setting reaches the engine,
that the name is checked against what the engine actually knows rather than
against a list copied into this repository, and that the default output is
exactly what it was before any of this existed.

The claim is read back out of the PDF rather than trusted: a variant that is
accepted and then silently not applied is the failure this is here to catch.
Conformance itself is a different question — `pdfaid:part` in the metadata says
what the document claims, not that it is valid — and is checked against veraPDF,
which is M-08 in MANUAL-CHECKS.md and the optional test at the bottom of this
file.

These render for real, so they need WeasyPrint's native libraries, like the
golden tests beside them.
"""

from __future__ import annotations

import io
import shutil
import subprocess
import xml.etree.ElementTree as ET

import pypdf
import pytest

from app.services.renderer import _render_worker

PDFAID = "http://www.aiim.org/pdfa/ns/id/"
PDFUAID = "http://www.aiim.org/pdfua/ns/id/"

# Deliberately plain: this is about the container format, not the layout, and a
# document with no images or fonts of its own leaves fewer reasons for a
# conformance checker to complain about something that is not our doing.
DOC = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Archival copy</title>
<style>@page { size: A4; margin: 20mm }</style></head>
<body><h1>Archival copy</h1><p>Filed under section 4.</p></body></html>
"""


def render(variant: str = "") -> bytes:
    """The worker the process pool runs, called directly.

    A pool buys nothing here and turns a readable assertion error into a
    pickled traceback from another process.
    """
    return _render_worker(DOC, False, [], variant)


def claimed(pdf: bytes, namespace: str) -> dict[str, str]:
    """The conformance attributes the document's XMP metadata carries.

    They are attributes on an `rdf:Description`, not elements, and the stream
    they live in is compressed for most variants — so this goes through pypdf
    to get the bytes and then reads the XML, instead of looking for a string in
    the file.
    """
    reader = pypdf.PdfReader(io.BytesIO(pdf))
    metadata = reader.xmp_metadata
    if metadata is None:
        return {}
    root = ET.fromstring(metadata.stream.get_data())
    found = {}
    for element in root.iter():
        for key, value in element.attrib.items():
            if key.startswith(f"{{{namespace}}}"):
                found[key.split("}", 1)[1]] = value
    return found


def test_pdf_a_3b_says_so_in_its_metadata() -> None:
    assert claimed(render("pdf/a-3b"), PDFAID) == {"part": "3", "conformance": "B"}


def test_pdf_ua_1_says_so_in_its_metadata() -> None:
    assert claimed(render("pdf/ua-1"), PDFUAID).get("part") == "1"


def test_a_variant_also_sets_the_pdf_version_it_requires() -> None:
    """The metadata is half of it; PDF/A-1 is a 1.4 file and PDF/A-3 a 1.7 one.

    Checked because these come from the variant's own properties in WeasyPrint
    rather than from anything this service passes, and an upgrade that changed
    them would change what a deployment is producing without a word.
    """
    assert render("pdf/a-1b").startswith(b"%PDF-1.4")
    assert render("pdf/a-3b").startswith(b"%PDF-1.7")


def test_without_a_variant_nothing_is_claimed() -> None:
    """The default is what every deployment has had until now.

    A file that quietly started claiming PDF/A would be worse than one that
    never offered it: the claim is what an archive checks.
    """
    pdf = render()
    assert claimed(pdf, PDFAID) == {}
    assert claimed(pdf, PDFUAID) == {}


def test_an_unknown_variant_is_refused_and_names_the_real_ones() -> None:
    with pytest.raises(ValueError) as failure:
        render("pdf/a-9z")
    message = str(failure.value)
    assert "pdf/a-9z" in message
    assert "pdf/a-3b" in message and "pdf/ua-1" in message
    # `debug` is one of WeasyPrint's variants and is not an output standard;
    # offering it to a deployment would be offering a foot-gun.
    assert "debug" not in message


@pytest.mark.skipif(shutil.which("verapdf") is None, reason="veraPDF is not installed")
def test_pdf_a_3b_passes_verapdf() -> None:
    """The real conformance check, when the tool happens to be present.

    Not a CI gate: veraPDF is a Java application and a several-hundred-megabyte
    download, and making every pull request wait for it to validate two pages
    would buy a check that changes about once a year. It runs by hand before a
    release (M-08), and here automatically for anyone who has it.
    """
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "archival.pdf"
        target.write_bytes(render("pdf/a-3b"))
        result = subprocess.run(
            ["verapdf", "-f", "3b", "--format", "text", str(target)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    assert result.returncode == 0, result.stdout + result.stderr
