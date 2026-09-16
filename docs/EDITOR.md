# The visual editor

The canvas is a purpose-built DOM editor: the document in it *is* the markup
that will be rendered, so the round trip through it is byte-exact (there is a
test that fails the build otherwise). This is what it does beyond typing.

## From the keyboard

The canvas is contenteditable, so the plain
arrows, Enter and Backspace belong to writing the document and cannot be taken
away from it. Selecting *structure* therefore lives behind Alt:

| Keys | What it does |
|---|---|
| `Alt` + `↓` / `↑` | select the next / previous element at this level |
| `Alt` + `→` | select the first element inside this one |
| `Alt` + `←` | select the element around this one |
| `Alt` + `Enter` | edit the selected element — its Jinja expression, or its text |
| `Alt` + `Delete` | remove the selected element |
| `Esc` | step out to the element around this one; clear at the top |

Movement is by tree rather than by document order: `Alt`+`↓` in the last cell of
a row stops there instead of surfacing into the next paragraph. The list is also
in the canvas itself, under "Keyboard", because a shortcut nobody can discover
is a shortcut nobody has.

## The modifier keys mean one thing each

`Shift` keeps the proportion when
resizing and the axis when moving; `Alt` ignores snapping for as long as it is
held; `Ctrl` (or `Cmd`) drags a copy instead of the element itself. People bring
these habits from other tools, and matching them is worth more than any
convention this editor could invent. The one departure is `Alt`, which elsewhere
often means "resize from the centre": in a document made of margins and
alignments, an escape from snapping is needed far more often than centring is.

## A page break says what it will do

The canvas draws the document as one
strip and marks where each printed page ends; where that line crosses something,
the element is outlined and labelled — *moves to the next page whole* for a table
row, an image or anything carrying `break-inside: avoid`, and *splits across the
break* for ordinary text, which is what the renderer does to it and usually what
its author wants. The gap between the strip and the printed pages cannot be
closed without laying the document out twice; this makes it predictable, which
is most of what "it looked right in the editor" is really asking for.

## One gesture, one undo

A drag is a single action however many changes it
makes on the way, so history is held open for its duration and commits once when
the hand lets go — an undo that lands halfway through a resize reads as a broken
program rather than a precise one. And `Esc` **cancels a drag in progress**: the
document goes back to where the gesture found it, without letting go of the
mouse first and without leaving a step behind to undo.

## What a click will take is shown before the click

Hovering outlines the
element a click would select and names its kind, and the selected element's path
— `Table › Row › Cell › Block` — sits in the inspector with every level
clickable. Structural selection takes the nearest meaningful node under the
pointer, which is a fine rule and an invisible one; these make it visible
instead of something you press to find out.

## Dragging is measured, and it snaps

While an edge is being dragged it falls
onto the things a printed form aligns to: the page margins, the page breaks, and
the edges and centres of what is already on the page — with the millimetre grid
as a fallback when nothing else is near. A page line always beats a round
number, because "flush with the margin" is what the author meant and "5 mm" is
only what the ruler happened to say. The line it landed on is drawn while it
holds it, the figure beside the cursor reads in millimetres and names what
stopped it, and **`Alt` turns snapping off** for the length of a gesture.

## Size and spacing

The selected element's box is edited as a box: margins
around it, padding inside it, width and height in the middle, each number on the
side it changes. Values are **millimetres by default** — type `12`, get `12mm` —
and any named unit is kept as written. A value set on the element is shown
solid; an empty box shows what the template's stylesheet decided, greyed, and
clearing a box returns the property to the stylesheet rather than writing a
zero. Changes apply on Enter or when the box loses focus, so the layout does not
jump while a number is being typed. A number can also be **dragged sideways** or
stepped with `↑`/`↓` (`Shift` for tens) — nobody knows a gap wants 6.5 mm, they
know it when they see it. **Grid** in the toolbar lays a millimetre
ruler over the sheet — 5 mm, heavier every 25 mm — and it appears on its own
whenever geometry is being changed: while anything is dragged, and from the
moment one of these boxes takes the focus.

## What is still mouse-only

The drag handles for column widths and row heights, and
free positioning of images. Both make the same change the labelled boxes
in the inspector make, so nothing is only reachable by pointer — but the direct gesture is
not there, and that is a real gap rather than an oversight.

## Theme

Light and dark, following the system preference, with an override in
Settings — a dark editor around a white sheet is uncomfortable for exactly the
work this tool is for.

