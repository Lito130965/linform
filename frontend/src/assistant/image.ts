/** Attachments are downscaled in the browser before they reach the model.
 *
 * A screenshot straight off a 4K display is ~5 MB of base64, and the round trip
 * measured 34s against ~7.5s for the same page at 2200px — the extra pixels buy
 * nothing when the model is reading page layout, and the wait reads as a frozen
 * UI. Sending fewer pixels is the whole fix. */

/** Longest side of an attachment, in pixels. ~2200 keeps an A4 page near 190dpi,
 * comfortably enough to read form labels. */
export const MAX_DIMENSION = 2200
const JPEG_QUALITY = 0.85

/** Scale w×h to fit a square of `max`, preserving aspect ratio. Images already
 * inside the box are left alone — upscaling would only add bytes. */
export function fitWithin(
  width: number,
  height: number,
  max: number = MAX_DIMENSION,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= max) return { width, height }
  const scale = max / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** Read a file as a data URL, downscaled to MAX_DIMENSION and re-encoded as
 * JPEG. Falls back to the untouched file if the browser cannot decode it, so an
 * exotic format still reaches the model rather than silently vanishing. */
export async function toDownscaledDataUrl(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  } catch {
    return await readAsDataUrl(file)
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
