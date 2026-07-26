/**
 * Hints for the preset dialog, mined from the editor's test JSON.
 *
 * The point (from the plan): stop making the author type array and field names
 * from memory. If the test data has `items: [{name, price}, …]`, offer `items`
 * as the loop candidate and `name`/`price` as its columns — cheap to compute,
 * a large accuracy win over guessing.
 *
 * Free entry always remains available upstream: JSON is dynamic and the sample
 * may not match production, so these are suggestions, not a schema.
 */

export interface DataHints {
  /** Top-level keys that are not arrays — scalar/value placeholder candidates. */
  fields: string[]
  /** Arrays, with the union of object keys seen in their first few items. */
  arrays: { name: string; itemFields: string[] }[]
}

const EMPTY: DataHints = { fields: [], arrays: [] }

export function parseHints(testDataJson: string): DataHints {
  let data: unknown
  try {
    data = JSON.parse(testDataJson)
  } catch {
    return EMPTY
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY

  const fields: string[] = []
  const arrays: DataHints['arrays'] = []
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      arrays.push({ name: key, itemFields: unionOfKeys(value) })
    } else {
      fields.push(key)
    }
  }
  return { fields, arrays }
}

/** Keys present across the array's object items (first 20 sampled), in first
 * appearance order. Scalar arrays yield no fields — they iterate by value. */
function unionOfKeys(items: unknown[]): string[] {
  const seen = new Set<string>()
  for (const item of items.slice(0, 20)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const k of Object.keys(item as Record<string, unknown>)) seen.add(k)
    }
  }
  return [...seen]
}
