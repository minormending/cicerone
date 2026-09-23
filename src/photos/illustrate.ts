import type { Photo, Place, Trip } from '../domain/types.ts'
import { choose, search, trackDownload, type UnsplashOptions } from './unsplash.ts'

/**
 * One photograph per day chapter, of the city rather than the stop.
 *
 * The first attempt searched for the day's first stop, which is how a design
 * survives until it meets an itinerary. On a real trip the first stop of a day
 * is a bakery, an airport or a supermarket: four of five days returned no
 * results at all, because Unsplash has nothing for "Antonínovo pekařství".
 *
 * So the opener is what it always honestly was — a picture of the place you
 * are in, not of the stop you are at. Searching the city always returns
 * something, the caption says the city, and the claim is atmosphere, which is
 * exactly true. Each day takes a different result so the book does not repeat
 * one photograph five times.
 *
 * Sparse on purpose, too. A guide with a stock photograph against each of
 * thirty-three stops looks like a content farm, and the book this design
 * borrows from works because the pictures are somebody's own. Stock decorates
 * a guide; it cannot carry one.
 */

export interface IllustrateOptions extends UnsplashOptions {
  onProgress?: (done: number, total: number) => void
}

/**
 * Whichever city name the trip's own title offers.
 *
 * Wanderlog titles are written by the traveller and are usually "Trip to
 * Prague" or "5 days in Prague", so the longest substantial word is a decent
 * guess and costs nothing.
 */
export function cityFrom(trip: Trip): string | undefined {
  const skip = new Set(['itinerary', 'trip', 'days', 'day', 'in', 'to', 'the', 'and'])
  const words = trip.title
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 3 && !skip.has(w.toLowerCase()))
  return words.sort((a, b) => b.length - a.length)[0]
}

/** The stop a day is filed under: its first, for the subject id. */
function openersFor(trip: Trip): Place[] {
  const byDay = new Map<number, Place>()
  for (const place of trip.places) {
    if (place.dayIndex === undefined) continue
    if (!byDay.has(place.dayIndex)) byDay.set(place.dayIndex, place)
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, place]) => place)
}

export async function illustrate(trip: Trip, opts: IllustrateOptions): Promise<Photo[]> {
  const city = cityFrom(trip)
  const openers = openersFor(trip)
  const out: Photo[] = []

  // One search for the whole trip. The city is the only query guaranteed to
  // return anything, and it is also the only honest caption.
  const candidates = city ? await search(city, opts, Math.max(8, openers.length)) : []

  let done = 0
  let taken = 0
  for (const place of openers) {
    if (opts.signal?.aborted) break

    // The traveller's own photograph outranks anything we could find, and
    // needs no verification: they were there.
    if (place.photoUrl) {
      out.push({
        subject: { kind: 'place', id: place.id },
        url: place.photoUrl,
        claim: 'named',
        chosenBy: 'person',
      })
      opts.onProgress?.(++done, openers.length)
      continue
    }

    const chosen = choose({ kind: 'place', id: place.id }, candidates.slice(taken))
    if (chosen) {
      taken++
      // Required by the API guidelines, and only for the one actually kept.
      await trackDownload(chosen.candidate, opts)
      out.push(chosen.photo)
    }
    opts.onProgress?.(++done, openers.length)
  }

  return out
}
