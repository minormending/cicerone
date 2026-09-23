/**
 * The trip graph, and the guide written against it.
 *
 * Two halves that meet at an id. The graph comes from an import and is never
 * authored here — places, times and legs are Wanderlog's account of the trip
 * and we do not second-guess them. The guide is everything written about that
 * graph, and it hangs off places and corridors alike.
 */

export interface Coordinates {
  lat: number
  lon: number
}

export interface Place {
  id: string
  name: string
  coords: Coordinates
  /** 1-based, in trip order. Absent for a place on no day: a standing list. */
  dayIndex?: number
  /** Local wall clock, `HH:MM`. */
  arrive?: string
  depart?: string
  /** IANA zone. Without it, times are estimated from longitude and said to be. */
  timezone?: string
  countryCode?: string
  /** What the traveller wrote against the stop. Theirs, never edited. */
  note?: string
  /** A photo they attached, which outranks anything we could find. */
  photoUrl?: string
  /** Degrees clockwise from north, for the computed light passage. */
  facadeBearing?: number
}

export const TRANSPORT_MODES = [
  'walk',
  'cycle',
  'drive',
  'taxi',
  'transit',
  'bus',
  'metro',
  'rail',
  'ferry',
  'flight',
] as const

export type TransportMode = (typeof TRANSPORT_MODES)[number]

export interface Leg {
  id: string
  fromPlaceId: string
  toPlaceId: string
  mode: TransportMode
  durationMinutes?: number
  distanceMetres?: number
  /** Local wall clock at the departing end, `HH:MM`. */
  departAt?: string
  arriveAt?: string
}

export interface Trip {
  id: string
  title: string
  /** `YYYY-MM-DD`. */
  departsOn?: string
  places: Place[]
  legs: Leg[]
}

/**
 * A stretch of the journey worth writing about.
 *
 * Derived from a leg rather than stored: what makes a corridor is whether the
 * traveller is awake for it, which is a function of the itinerary's own clock
 * and changes if the itinerary does. See `src/corridor/waking.ts`.
 */
export interface Corridor {
  id: string
  legId: string
  fromPlaceId: string
  toPlaceId: string
  mode: TransportMode
  dayIndex?: number
  /** Can they see out? Decides whether `passing` is even possible. */
  view: 'open' | 'enclosed'
}

/** What a passage is about. A corridor id is the corridor's, not the leg's. */
export interface Subject {
  kind: 'place' | 'corridor'
  id: string
}

export const PASSAGE_KINDS = [
  'origin',
  'event',
  'table',
  'craft',
  'look_for',
  'passing',
  'prepare',
] as const

export type PassageKind = (typeof PASSAGE_KINDS)[number]

/** Which subjects a kind may attach to. Enforced by `check`, not by types. */
export const KIND_SUBJECTS: Record<PassageKind, ReadonlyArray<Subject['kind']>> = {
  origin: ['place'],
  event: ['place', 'corridor'],
  table: ['place'],
  craft: ['place'],
  look_for: ['place', 'corridor'],
  passing: ['corridor'],
  prepare: ['corridor'],
}

export interface Source {
  url: string
  title: string
  /** `YYYY-MM-DD`. */
  retrieved: string
}

/**
 * One specific assertion, and what holds it up.
 *
 * The unit of attribution is deliberately smaller than the passage. Three
 * links under four paragraphs says something was consulted; it does not say
 * which sentence is true, and a reader who checks one and finds it does not
 * support the sentence stops trusting all of them.
 */
export interface Claim {
  /** The assertion as the passage makes it, quoted from the body. */
  text: string
  /** Index into the passage's `sources`. */
  source: number
  /** The words in the source that carry it, where they can be quoted. */
  support?: string
}

export interface Passage {
  id: string
  subject: Subject
  kind: PassageKind
  title: string
  /** Markdown. Several paragraphs; this is prose, not a field. */
  body: string
  claims: Claim[]
  sources: Source[]
  /** `YYYY-MM-DD`. Against the trip document, for staleness. */
  writtenAt: string
  /** Computed passages have no research behind them and need none. */
  computed?: boolean
}

/** How much a caption is allowed to claim. */
export type PhotoClaim = 'named' | 'atmosphere'

export interface Photo {
  subject: Subject
  /** Unsplash photo id, or absent for one the traveller brought. */
  unsplashId?: string
  url: string
  /** Required by Unsplash's API guidelines whatever the licence says. */
  credit?: { name: string; link: string }
  claim: PhotoClaim
  /** A person who picks a photo has vouched for it; a search has not. */
  chosenBy: 'auto' | 'person'
}

export interface Guide {
  tripId: string
  passages: Passage[]
  photos: Photo[]
  /** `YYYY-MM-DD`. */
  builtAt: string
}
