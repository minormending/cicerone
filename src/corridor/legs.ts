import type { Coordinates, Leg, Place, TransportMode, Trip } from '../domain/types.ts'

/**
 * Legs between consecutive stops, because the document does not carry them.
 *
 * This wants stating plainly, because it sits close to a line the spec draws.
 * The Wanderlog view-key document is a list of places with times on them: no
 * transport modes, no routes, no durations. Searching the whole 153 kB of a
 * real Prague trip finds the words "walk" and "flight" only inside the
 * traveller's own notes.
 *
 * So the rule "logistics are read, never derived" needs a finer edge:
 *
 *   - We do not derive **durations or routes**. That is what the previous app
 *     did, with two routing providers and a geocoder, and it is the half
 *     Wanderlog already answers. Nothing here computes how long a walk takes
 *     or which way it goes, and no passage may claim one.
 *   - We do infer **mode**, because it is an editorial input rather than a
 *     logistics claim. It decides whether a stretch of the journey can be
 *     written about at all — whether the traveller can see out — and that
 *     question has to be answered before anything is written. Being wrong
 *     costs a `passing` passage about a metro tunnel, not a missed train.
 *
 * The inference is deliberately crude and never surfaces to the reader.
 */

const EARTH_METRES = 6_371_000

export function metresBetween(a: Coordinates, b: Coordinates): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * EARTH_METRES * Math.asin(Math.sqrt(h)))
}

/** Minutes since local midnight, or undefined for anything unparseable. */
export function minutesOfDay(time: string | undefined): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time ?? '')
  if (!match) return undefined
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return undefined
  return h * 60 + m
}

/**
 * Which way they are most likely travelling.
 *
 * Distance decides, with speed as a tiebreak where both ends carry a time.
 * The thresholds are chosen so the common cases land right on a city
 * itinerary rather than to be defensible in general: under two and a half
 * kilometres between two stops on one day is a walk in every European city
 * centre, and three hundred kilometres between two stops on one day is a
 * flight unless the clock says otherwise.
 */
export function inferMode(metres: number, minutes?: number): TransportMode {
  const km = metres / 1000
  if (km < 2.5) return 'walk'

  if (minutes && minutes > 0) {
    const kmh = km / (minutes / 60)
    // Nothing on the ground sustains this over a whole leg.
    if (kmh > 300) return 'flight'
    if (km > 120) return 'rail'
    return 'transit'
  }

  if (km > 300) return 'flight'
  if (km > 120) return 'rail'
  return 'transit'
}

/** Minutes between two local wall clocks, treating a wrap as crossing midnight. */
function gapMinutes(from: number | undefined, to: number | undefined): number | undefined {
  if (from === undefined || to === undefined) return undefined
  const raw = to - from
  return raw >= 0 ? raw : raw + 1440
}

/**
 * One leg per consecutive pair of scheduled stops within a day, plus one
 * joining each day to the next.
 *
 * Crossing midnight is what the day join is for: the last stop of day two and
 * the first of day three are consecutive in the traveller's experience even
 * though nothing in the document says so, and that join is exactly where an
 * overnight flight lives.
 */
export function inferLegs(places: Place[]): Leg[] {
  const scheduled = places
    .filter((p) => p.dayIndex !== undefined)
    .sort((a, b) => (a.dayIndex ?? 0) - (b.dayIndex ?? 0))

  const legs: Leg[] = []
  for (let i = 0; i + 1 < scheduled.length; i++) {
    const from = scheduled[i] as Place
    const to = scheduled[i + 1] as Place

    // The same hotel on consecutive days is a night, not a journey.
    if (from.name === to.name && from.coords.lat === to.coords.lat && from.coords.lon === to.coords.lon) {
      continue
    }

    const metres = metresBetween(from.coords, to.coords)
    const departAt = from.depart ?? from.arrive
    const arriveAt = to.arrive
    const minutes = gapMinutes(minutesOfDay(departAt), minutesOfDay(arriveAt))

    const leg: Leg = {
      id: `leg:${from.id}:${to.id}`,
      fromPlaceId: from.id,
      toPlaceId: to.id,
      mode: inferMode(metres, minutes),
    }
    // Distance is straight-line and is kept for the mode decision and for
    // ordering. It is never rendered: a crow-flies number presented as a
    // journey is exactly the kind of wrong the previous app shipped.
    leg.distanceMetres = metres
    if (departAt) leg.departAt = departAt
    if (arriveAt) leg.arriveAt = arriveAt
    legs.push(leg)
  }
  return legs
}

/** The trip with its legs filled in. */
export function withLegs(trip: Trip): Trip {
  return { ...trip, legs: inferLegs(trip.places) }
}
