import type { Photo, Place, Trip } from '../domain/types.ts'
import { choose, search, trackDownload, type UnsplashOptions } from './unsplash.ts'

/**
 * A photograph for each day of the trip, and for the few places that carry one.
 *
 * Sparse on purpose. A guide with a stock photograph against each of
 * thirty-three stops looks like a content farm, and the reference this design
 * takes from — the Polarsteps book — works because the pictures are somebody's
 * own. Stock decorates a guide; it cannot carry one. So the rule is chapter
 * openers, not illustrations.
 */

export interface IllustrateOptions extends UnsplashOptions {
  onProgress?: (done: number, total: number) => void
}

/** One representative stop per day: the first with a name worth searching. */
function openersFor(trip: Trip): Place[] {
  const byDay = new Map<number, Place>()
  for (const place of trip.places) {
    if (place.dayIndex === undefined) continue
    if (!byDay.has(place.dayIndex)) byDay.set(place.dayIndex, place)
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, place]) => place)
}

/**
 * What to search for.
 *
 * The place's own name first, because that is the only query that can return
 * something with the right coordinates on it. A bare name in a city nobody
 * tagged carefully returns nothing useful, so the city is appended — which is
 * also what makes the fallback honest, since an unverified result from
 * "Grébovka Prague" is at least a photograph of Prague.
 */
export function queryFor(place: Place, city: string | undefined): string {
  return city && !place.name.toLowerCase().includes(city.toLowerCase())
    ? `${place.name} ${city}`
    : place.name
}

/**
 * Whichever city name the trip's own title offers.
 *
 * Wanderlog titles are written by the traveller and are usually "Prague
 * itinerary" or "5 days in Prague", so the longest capitalised word in the
 * title is a decent guess and costs nothing. A wrong guess only widens a
 * search that was already going to be captioned as atmosphere.
 */
export function cityFrom(trip: Trip): string | undefined {
  const skip = new Set(['itinerary', 'trip', 'days', 'day', 'in', 'to', 'the', 'and'])
  const words = trip.title
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 3 && !skip.has(w.toLowerCase()))
  return words.sort((a, b) => b.length - a.length)[0]
}

export async function illustrate(trip: Trip, opts: IllustrateOptions): Promise<Photo[]> {
  const city = cityFrom(trip)
  const openers = openersFor(trip)
  const out: Photo[] = []

  let done = 0
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

    const candidates = await search(queryFor(place, city), opts)
    const chosen = choose({ kind: 'place', id: place.id }, candidates, place.coords)
    if (chosen) {
      // Only on use, and only for the one actually kept.
      await trackDownload(chosen.candidate, opts)
      out.push(chosen.photo)
    }
    opts.onProgress?.(++done, openers.length)
  }

  return out
}
