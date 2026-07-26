/**
 * Layering an image relative to the text: normal flow, behind the text where it
 * sits, the background of its cell, or a page background that repeats on every
 * printed page.
 *
 * All are inline styles the image carries, so they survive export while the
 * author's <style> stays read-only. "Behind" and "cell" pin the image with a
 * negative z-index so text paints over it; "page" uses position: fixed, which
 * WeasyPrint repeats on every page, pushed out past the @page margins so it
 * bleeds to the sheet edge (the ai_test pattern). A page image is also tagged
 * data-lf-pagebg — a canvas-only marker so the editor can show it filling the
 * iframe even though the exported offsets are negative.
 */

import type { PageBox } from './furniture'

export type Layer = 'normal' | 'behind' | 'cell' | 'page'

const LAYER_PROPS = [
  'position',
  'z-index',
  'top',
  'left',
  'right',
  'bottom',
  'object-fit',
] as const

function clearAnchor(el: HTMLElement | null): void {
  if (el?.dataset.lfAnchor) {
    el.style.removeProperty('position')
    delete el.dataset.lfAnchor
  }
}

function clearLayer(img: HTMLElement): void {
  for (const p of LAYER_PROPS) img.style.removeProperty(p)
  delete img.dataset.lfPagebg
  clearAnchor(img.parentElement as HTMLElement | null)
  clearAnchor(img.closest('td, th') as HTMLElement | null)
}

export function layerOf(img: HTMLElement): Layer {
  const pos = img.style.position
  if (pos === 'fixed') return 'page'
  if (pos === 'absolute' && img.style.zIndex === '-1') {
    return img.style.width === '100%' && img.style.right === '0px' ? 'cell' : 'behind'
  }
  return 'normal'
}

function anchor(el: HTMLElement | null): void {
  const positioned = ['relative', 'absolute', 'fixed', 'sticky']
  if (el && !positioned.includes(getComputedStyle(el).position)) {
    el.style.position = 'relative'
    el.dataset.lfAnchor = '1'
  }
}

export function setLayer(img: HTMLElement, layer: Layer, pageBox?: PageBox | null): void {
  clearLayer(img)
  if (layer === 'normal') return

  if (layer === 'page') {
    img.style.position = 'fixed'
    img.style.zIndex = '-1'
    img.style.objectFit = 'cover'
    img.dataset.lfPagebg = '1'
    if (pageBox) {
      // Bleed past the margins so the image covers the whole physical sheet.
      img.style.top = `-${pageBox.margin.top}`
      img.style.left = `-${pageBox.margin.left}`
      img.style.width = pageBox.width
      img.style.height = pageBox.height
    } else {
      img.style.top = '0'
      img.style.left = '0'
      img.style.width = '100%'
      img.style.height = '100%'
    }
    return
  }

  if (layer === 'cell') {
    const cell = img.closest('td, th') as HTMLElement | null
    anchor(cell)
    img.style.position = 'absolute'
    img.style.top = '0'
    img.style.left = '0'
    img.style.right = '0'
    img.style.bottom = '0'
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'cover'
    img.style.zIndex = '-1'
    return
  }

  // behind: pin where it currently sits, one layer under the text.
  anchor(img.parentElement as HTMLElement | null)
  img.style.position = 'absolute'
  img.style.top = `${img.offsetTop}px`
  img.style.left = `${img.offsetLeft}px`
  img.style.zIndex = '-1'
}
