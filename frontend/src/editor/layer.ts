/**
 * Layering an image relative to the text: normal flow, behind the text where it
 * sits, or a page background that repeats on every printed page.
 *
 * All three are inline styles the image carries, so they survive export while
 * the author's <style> stays read-only. "Behind text" pins the image at its
 * current position (captured before it leaves the flow) with a negative
 * z-index, so it stays exactly where it was but the text paints over it. "Page
 * background" uses position: fixed, which WeasyPrint repeats on every page.
 */

export type Layer = 'normal' | 'behind' | 'page'

const LAYER_PROPS = ['position', 'z-index', 'top', 'left', 'right', 'bottom', 'object-fit'] as const

function clearLayer(img: HTMLElement): void {
  for (const p of LAYER_PROPS) img.style.removeProperty(p)
  const parent = img.parentElement as HTMLElement | null
  if (parent?.dataset.lfAnchor) {
    parent.style.removeProperty('position')
    delete parent.dataset.lfAnchor
  }
}

/** Which layer the image is currently in, read back from its inline styles. */
export function layerOf(img: HTMLElement): Layer {
  const pos = img.style.position
  if (pos === 'fixed') return 'page'
  if (pos === 'absolute' && img.style.zIndex === '-1') return 'behind'
  return 'normal'
}

export function setLayer(img: HTMLElement, layer: Layer): void {
  clearLayer(img)
  if (layer === 'normal') return

  if (layer === 'page') {
    // Fixed elements repeat on every page in WeasyPrint; cover the sheet.
    img.style.position = 'fixed'
    img.style.top = '0'
    img.style.left = '0'
    img.style.zIndex = '-1'
    img.style.objectFit = 'cover'
    if (!img.style.width) img.style.width = '100%'
    if (!img.style.height) img.style.height = '100%'
    return
  }

  // behind: pin where it currently sits, one layer under the text.
  const parent = img.parentElement as HTMLElement | null
  const positioned = ['relative', 'absolute', 'fixed', 'sticky']
  if (parent && !positioned.includes(getComputedStyle(parent).position)) {
    parent.style.position = 'relative'
    parent.dataset.lfAnchor = '1'
  }
  const top = img.offsetTop
  const left = img.offsetLeft
  img.style.position = 'absolute'
  img.style.top = `${top}px`
  img.style.left = `${left}px`
  img.style.zIndex = '-1'
}
