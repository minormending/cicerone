import type { Corridor, Place, TransportMode } from '../domain/types.ts'

/**
 * A corridor, handed to Google Maps so the reader can see the actual route.
 *
 * The book draws the day as a shape — straight legs between stops, fading
 * from first to last — and that is all it will ever draw, because this app
 * does not derive routes. `src/corridor/legs.ts` says why at length: routing
 * is the half Wanderlog and Google already answer, and the previous app drowned
 * in two routing providers and a geocoder trying to answer it again.
 *
 * A link is the honest way out of that. It does not claim to know the way; it
 * hands the question to the service that does, with enough precision that the
 * answer is about these two stops and no others. The reader gets the real
 * pavement-level route, turn by turn, in the app already on their phone, with
 * live transit times the book cannot have.
 *
 * Deliberately a link rather than an embedded map. An embed needs a Maps
 * Embed API key, which makes a rendered book depend on a billing account; it
 * fires a request to Google for every corridor the moment the file opens,
 * from a document that is emailed around and contains somebody's hotel; and
 * it shows nothing at all offline, which is the state a phone is in on the
 * street in another country. The link costs nothing until it is clicked.
 */

/**
 * Google's travel modes, which are not this app's.
 *
 * Google offers five. The itinerary distinguishes ten, because the difference
 * between a tram and a metro decides whether a corridor can be written about
 * at all. Collapsing them here is lossless in the direction that matters: the
 * reader wants a route, and every rail-shaped thing routes the same way.
 *
 * A flight has no entry, and that absence is the point. Google will happily
 * answer "directions from JFK to Prague" with a route that is not the flight,
 * and offering that under a passage about a flight would be a small lie in
 * the one place a reader has no way to check it.
 */
const TRAVEL_MODE: Partial<Record<TransportMode, string>> = {
  walk: 'walking',
  cycle: 'bicycling',
  drive: 'driving',
  taxi: 'driving',
  transit: 'transit',
  bus: 'transit',
  metro: 'transit',
  rail: 'transit',
  ferry: 'transit',
}

/**
 * How an end of the corridor is named to Google.
 *
 * With a place id, the name is only the human-readable half — Google resolves
 * the id, so "Lokál" cannot land at a different Lokál. Without one, the name
 * alone would be a text search, and a text search for a Czech café run from a
 * phone in another country lands wherever Google feels like: coordinates are
 * the one form that cannot be misread. Every stop on the trip this was built
 * for carries an id, so the fallback is for trips that do not.
 */
function endpoint(place: Place): string {
  if (place.placeId) return place.name
  return `${place.coords.lat.toFixed(6)},${place.coords.lon.toFixed(6)}`
}

/**
 * Google's documented Maps URLs scheme — the one with `api=1`, which is
 * supported for exactly this and needs no key. On a phone it opens the app.
 *
 * Returns nothing for a mode Google cannot route, rather than a URL that
 * answers a different question.
 */
export function directionsUrl(from: Place, to: Place, mode: TransportMode): string | undefined {
  const travelmode = TRAVEL_MODE[mode]
  if (!travelmode) return undefined

  const params = new URLSearchParams()
  params.set('api', '1')
  params.set('origin', endpoint(from))
  if (from.placeId) params.set('origin_place_id', from.placeId)
  params.set('destination', endpoint(to))
  if (to.placeId) params.set('destination_place_id', to.placeId)
  params.set('travelmode', travelmode)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/** How Google's mode reads in a sentence. */
const HOW: Record<string, string> = {
  walking: 'Walking',
  bicycling: 'Cycling',
  transit: 'Transit',
  driving: 'Driving',
}

/**
 * What the link says it will do, for a screen reader and a hover.
 *
 * Phrased from Google's mode rather than ours, so it can never describe a
 * metro ride as driving: whatever word appears here is the mode the link
 * actually asks for.
 */
export function directionsLabel(from: Place, to: Place, mode: TransportMode): string | undefined {
  const travelmode = TRAVEL_MODE[mode]
  if (!travelmode) return undefined
  return `${HOW[travelmode] ?? 'Directions'} directions from ${from.name} to ${to.name}, in Google Maps`
}

/**
 * Google's cap on intermediate stops in a directions URL.
 *
 * Eleven points in total: an origin, nine waypoints, a destination. A day
 * over that is not truncated to fit — a route that quietly drops five of the
 * places you are going to is worse than no route, because it looks right.
 */
export const MAX_WAYPOINTS = 9

/**
 * The fewest stops worth a whole-day link.
 *
 * Two stops joined by one corridor already have a link, in that corridor's
 * own head. A second button pointing at the same route is noise.
 */
const MIN_DAY_STOPS = 3

/**
 * Modes Google will not route through waypoints.
 *
 * Transit, and only transit — verified rather than assumed. Asked for a
 * three-stop transit route it answers "Sorry, we could not calculate transit
 * directions", having quietly kept the mode switch on transit and shown
 * nothing. A button that lands a reader on that is worse than no button.
 */
const NO_WAYPOINTS: ReadonlySet<string> = new Set(['transit'])

export interface DayRoute {
  url: string
  /** As the mode reads in a heading: "The day's walk". */
  label: string
  /** The longer form, for a screen reader. */
  description: string
}

const DAY_NOUN: Record<string, string> = {
  walking: "The day's walk",
  bicycling: "The day's ride",
  driving: "The day's drive",
}

/**
 * The whole day as one route, where the day is honestly one route.
 *
 * Four conditions, and each of them exists because breaking it would put
 * something false in front of a reader.
 *
 * Every gap between consecutive stops has to be a corridor, or the link
 * claims a continuous journey across a jump the itinerary never made. Every
 * one of those corridors has to want the same travel mode, because a Google
 * URL carries exactly one: a day that takes a tram up to the castle and walks
 * the rest would be drawn as a forty-five minute climb nobody is planning to
 * make. The mode has to be one Google will route through waypoints, which
 * rules out the transit days outright. And the day has to fit inside the cap.
 *
 * On a trip spent walking one city this lights up most days. On this one it
 * lights up a single day out of five, and the four it skips are skipped for
 * four different reasons — which is the rule working, not the rule failing.
 */
export function dayDirectionsUrl(stops: Place[], corridors: Corridor[]): DayRoute | undefined {
  if (stops.length < MIN_DAY_STOPS) return undefined
  if (stops.length > MAX_WAYPOINTS + 2) return undefined

  // Walked in order, with nothing missing. Matched by the ids rather than
  // counted, so a day whose corridors happen to number one fewer than its
  // stops without joining them up cannot pass.
  const modes: TransportMode[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]
    const to = stops[i + 1]
    const joining = corridors.find((c) => c.fromPlaceId === from?.id && c.toPlaceId === to?.id)
    if (!joining) return undefined
    modes.push(joining.mode)
  }

  const travelmode = TRAVEL_MODE[modes[0] as TransportMode]
  if (!travelmode || NO_WAYPOINTS.has(travelmode)) return undefined
  if (!modes.every((m) => TRAVEL_MODE[m] === travelmode)) return undefined

  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first || !last) return undefined
  const between = stops.slice(1, -1)

  const params = new URLSearchParams()
  params.set('api', '1')
  params.set('origin', endpoint(first))
  if (first.placeId) params.set('origin_place_id', first.placeId)
  params.set('destination', endpoint(last))
  if (last.placeId) params.set('destination_place_id', last.placeId)
  params.set('waypoints', between.map(endpoint).join('|'))
  // All or nothing. The two lists are matched by position, so a day with an
  // id for four of its five middle stops cannot send four ids — the fifth
  // would take somebody else's. Without the ids each waypoint is already
  // coordinates, courtesy of `endpoint`, which is exact if less readable.
  if (between.every((p) => p.placeId)) {
    params.set('waypoint_place_ids', between.map((p) => p.placeId).join('|'))
  }
  params.set('travelmode', travelmode)

  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    label: DAY_NOUN[travelmode] ?? "The day's route",
    description: `${HOW[travelmode] ?? 'Directions'} directions through all ${stops.length} stops of the day, in Google Maps`,
  }
}
