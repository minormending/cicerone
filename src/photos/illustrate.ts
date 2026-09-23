import type { Photo, Place, Trip } from '../domain/types.ts'
import { search, trackDownload, type Candidate, type UnsplashOptions } from './unsplash.ts'

/**
 * Photographs for a trip, in two passes answering two different questions.
 *
 * **Atmosphere.** A few pictures of the city, spread through each chapter so a
 * long day is not a wall of type. They claim nothing — captioned by city,
 * which is what they are — and they work for every trip, because searching a
 * city always answers.
 *
 * **The stop itself.** A photograph attached to a named stop, and only where
 * the photograph's own words say it is that place.
 *
 * The gate on that second pass wants stating, because the obvious version does
 * not work. Unsplash's search always returns something: "Loreta Prague", "U
 * Fleku Prague" and "Mr. Banh Mi Prague" all come back with the same picture
 * of Charles Bridge at the top, because relevance falls through to the city
 * when nothing matches. Result count and result order carry no information at
 * all. What carries information is whether the photographer's own description
 * or tags name the place, so that is the whole test.
 *
 * It fires on roughly one stop in seven, which is the right shape. Restaurants
 * and cafés essentially never pass it, and that is correct: a stock photograph
 * of somebody else's dining room above a named restaurant is the content-farm
 * failure this design exists to avoid. Wanderlog holds real photographs of
 * those places and they would be better — but its `photo_urls` are Google
 * Places links that answer 403 to everyone but Google, and its own image keys
 * resolve to no public URL, so they are not available to us.
 */

export interface IllustrateOptions extends UnsplashOptions {
  onProgress?: (done: number, total: number) => void
  /** Atmosphere pictures per chapter. */
  perDay?: number
  /** Targeted searches this trip may spend. See SEARCH_BUDGET. */
  searchBudget?: number
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

function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function words(value: string): Set<string> {
  return new Set(normalise(value).split(/[^a-z0-9]+/).filter(Boolean))
}

/**
 * Words that name a city rather than a place inside it, plus the institutional
 * boilerplate Wanderlog inherits from Google listings. A photograph tagged
 * "prague" says nothing about which stop it is.
 */
const NOT_DISTINCTIVE = new Set([
  'prague', 'praha', 'czech', 'czechia', 'republic',
  'national', 'gallery', 'museum', 'restaurant', 'cafe', 'bistro', 'hotel',
  'the', 'and', 'of',
])

/** The words that would have to appear for a photograph to be of this place. */
export function distinctiveWords(placeName: string): string[] {
  return [...words(placeName)].filter((w) => w.length > 3 && !NOT_DISTINCTIVE.has(w))
}

/**
 * Does the photograph's own text say it is this place?
 *
 * Every distinctive word has to be there — not the search's opinion and not
 * the result's rank, but the photographer's description and tags, which are
 * the only things in the response about the picture rather than the query.
 */
export function photoNames(candidate: Candidate, placeName: string): boolean {
  const wanted = distinctiveWords(placeName)
  if (wanted.length === 0) return false
  const said = words([candidate.description, ...(candidate.tags ?? [])].filter(Boolean).join(' '))
  return wanted.every((w) => said.has(w))
}

function byDay(trip: Trip): Map<number, Place[]> {
  const days = new Map<number, Place[]>()
  for (const place of trip.places) {
    if (place.dayIndex === undefined) continue
    const list = days.get(place.dayIndex) ?? []
    list.push(place)
    days.set(place.dayIndex, list)
  }
  return days
}

/**
 * Which stops in a day carry the atmosphere pictures: the first, then spread
 * through the rest. A fourteen-stop chapter with one picture at the top is a
 * wall of type; the same chapter with one every few stops reads like a book.
 */
export function spreadOver(stops: Place[], count: number): Place[] {
  if (stops.length === 0 || count < 1) return []
  if (stops.length <= count) return stops
  const step = stops.length / count
  return Array.from({ length: count }, (_, i) => stops[Math.floor(i * step)] as Place)
}

/**
 * How many targeted searches one trip may spend.
 *
 * The first version searched per stop: thirty-three searches plus the city
 * plus a download ping each, about forty-eight requests, against a Demo-tier
 * budget of fifty an hour. One trip consumed the whole hour and left nothing
 * for the swap dialog, and the run after it returned no photographs at all.
 *
 * Almost all of that was waste. One search of the city at depth thirty already
 * contains the pictures of its famous places — Charles Bridge dominates any
 * search for Prague — so the stops are matched against those results first,
 * and a targeted search is spent only on what is left, up to this many.
 */
export const SEARCH_BUDGET = 6

export async function illustrate(trip: Trip, opts: IllustrateOptions): Promise<Photo[]> {
  const city = cityFrom(trip)
  const days = byDay(trip)
  const perDay = opts.perDay ?? 3
  const found = new Map<string, Photo>()
  const used = new Set<string>()
  const budget = opts.searchBudget ?? SEARCH_BUDGET

  const stops = [...days.values()].flat()
  let done = 0
  const step = (): void => {
    opts.onProgress?.(++done, stops.length)
  }

  const take = async (place: Place, c: Candidate): Promise<void> => {
    await trackDownload(c, opts)
    used.add(c.id)
    found.set(place.id, {
      subject: { kind: 'place', id: place.id },
      unsplashId: c.id,
      url: c.url,
      credit: c.credit,
      // Still atmosphere. A description is the photographer's word for what a
      // picture shows: good evidence, not proof, and only a person gets to put
      // a place's name under a photograph.
      claim: 'atmosphere',
      chosenBy: 'auto',
    })
  }

  // The traveller's own photographs need no search and no verification.
  for (const place of stops) {
    if (place.photoUrl) {
      found.set(place.id, {
        subject: { kind: 'place', id: place.id },
        url: place.photoUrl,
        claim: 'named',
        chosenBy: 'person',
      })
    }
  }

  // One search, deep, for everything.
  const pool = city ? await search(city, opts, 30) : []

  // Stops whose picture is already in that pool. Named matches pick first,
  // because they are the scarce ones: run the other way round, the atmosphere
  // pass consumed every good photograph of Charles Bridge before the Charles
  // Bridge stop got to ask for one.
  for (const place of stops) {
    if (opts.signal?.aborted) return inOrder(stops, found)
    if (!found.has(place.id) && distinctiveWords(place.name).length > 0) {
      const named = pool.find((c) => photoNames(c, place.name) && !used.has(c.id))
      if (named) await take(place, named)
    }
    step()
  }

  // Then a few targeted searches, for the stops most likely to repay one:
  // the ones with the most distinctive names.
  const worthAsking = stops
    .filter((p) => !found.has(p.id) && distinctiveWords(p.name).length > 0)
    .sort((a, b) => distinctiveWords(b.name).join('').length - distinctiveWords(a.name).join('').length)
    .slice(0, budget)

  for (const place of worthAsking) {
    if (opts.signal?.aborted) return inOrder(stops, found)
    const query = normalise(place.name).includes(normalise(city ?? '\u0000'))
      ? place.name
      : `${place.name} ${city ?? ''}`.trim()
    const named = (await search(query, opts, 20)).find((c) => photoNames(c, place.name) && !used.has(c.id))
    if (named) await take(place, named)
  }

  // Finally fill each chapter out with city pictures, skipping stops that
  // already have one of their own.
  let next = 0
  for (const [, inDay] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    const bare = inDay.filter((p) => !found.has(p.id))
    const already = inDay.length - bare.length

    for (const place of spreadOver(bare, Math.max(0, perDay - already))) {
      if (opts.signal?.aborted) return inOrder(stops, found)
      const candidate = pool.slice(next).find((c) => !used.has(c.id))
      if (!candidate) break
      next = pool.indexOf(candidate) + 1
      await take(place, candidate)
    }
  }

  return inOrder(stops, found)
}

/** Back into trip order, so the reader lays them out down the page. */
function inOrder(stops: Place[], found: Map<string, Photo>): Photo[] {
  return stops.map((p) => found.get(p.id)).filter((p): p is Photo => p !== undefined)
}
