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
  /**
   * `place:<sourceId>` wherever the import has one, which for Wanderlog is
   * every stop. Until 2026-09-25 this was `place:<position>:<name>`, and the
   * position was a running count across the whole trip — so adding one stop
   * on day three renumbered every stop after it, and nineteen passages of a
   * finished book fell off the page on the next import. Graphs saved before
   * then still carry the old form; `reconcile` maps them across.
   */
  id: string
  /**
   * The source's own id for this stop: Wanderlog's block id. It survives
   * reordering, retiming, notes and moves between days — 94 of the 100 blocks
   * in a Prague document were still there with the same id after a heavy
   * week of edits, and the other six were the stops that had been deleted.
   */
  sourceId?: string
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
  /** Google's id for this place, as the import carries it. The key to
   *  everything Wanderlog already knows about the stop. */
  placeId?: string
  /** What the traveller wrote against the stop. Theirs, never edited. */
  note?: string
  /** A photo they attached, which outranks anything we could find. */
  photoUrl?: string
  /** Wanderlog's own image for this stop, as a key on its image host. */
  imageKey?: string
  /** Degrees clockwise from north, for the computed light passage. */
  facadeBearing?: number
  /**
   * How the traveller said they get here, where they said. Wanderlog carries
   * this on every block and leaves it null on almost all of them, so it is a
   * correction to the inferred mode rather than a replacement for it.
   */
  arriveBy?: TransportMode
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
  /** The way there, as the traveller's own planner already worked it out. */
  route?: RouteFact
}

/**
 * A stretch of the journey as the planner that made the itinerary drew it.
 *
 * This is the one thing that lets a route onto the page without breaking the
 * rule `src/corridor/legs.ts` sets out at length. Nothing here is computed:
 * Wanderlog asked Google for these when the trip was planned and ships them
 * inside the document, next to the coordinates and the opening hours, and
 * reading one has exactly the same status as reading a stop's latitude. The
 * app still owns no router, no geocoder and no opinion about which way the
 * street runs.
 *
 * `mode` is not decoration. A route is only true of the mode it was asked
 * for: the tram line between two stops and the walk between the same two
 * stops are different lines on the ground, and drawing one under a heading
 * that says the other is a lie a reader cannot catch. A route whose mode
 * disagrees with the leg's is left unattached rather than drawn.
 */
export interface RouteFact {
  /** Metres along the route, not across the map. */
  metres: number
  /** Seconds, as they stood on the day the trip was imported. */
  seconds: number
  /** The line itself, in order, at the planner's own resolution. */
  path: Coordinates[]
  mode: TransportMode
}

/**
 * One end of a flight, as a boarding pass prints it.
 *
 * The times are local wall clock at that airport and are stored exactly as the
 * airline states them, which is the only form a traveller ever needs. No
 * duration is computed from them: that would need both ends resolved to a real
 * timezone, and the document's own `utc_offset` for Prague says +60 in a month
 * when Prague is on +2. A wrong number about a flight is worse than no number.
 */
export interface FlightEnd {
  /** IATA code — JFK, PRG. */
  iata: string
  name: string
  city?: string
  /** `YYYY-MM-DD`, local to this airport. */
  date: string
  /** `HH:MM`, local to this airport. */
  time: string
}

/**
 * A flight the traveller has booked.
 *
 * Wanderlog keeps these in a `Flights` section separate from the itinerary,
 * and a share link can be set to withhold them — the first key this trip was
 * imported with carried `showReservations: false`, so the section was simply
 * absent and no amount of parsing would have found it.
 *
 * The confirmation number is deliberately not read. It is the one field in the
 * document that is worth stealing, it earns nothing in a guide that the times
 * do not, and a rendered book is a file that gets sent to people.
 */
export interface Flight {
  /** As the airline writes it: "DL 78". */
  number: string
  airline: string
  depart: FlightEnd
  arrive: FlightEnd
}

/**
 * A booked stay, from the lodging section beside the itinerary.
 *
 * Dates only, because that is all a hotel booking is: `checkIn` is the night
 * you first sleep there and `checkOut` is the morning you leave. Unlike a
 * flight's duration, the number of nights between them is safe to compute —
 * it is date arithmetic with no timezone in it at all.
 *
 * Withheld by the same `showReservations` switch as the flights, and its
 * confirmation number is ignored for the same reason.
 */
export interface Stay {
  name: string
  /** Google's id, which is how a stay is matched to the stops it covers. */
  placeId?: string
  /** `YYYY-MM-DD`. */
  checkIn: string
  checkOut: string
}

export interface Trip {
  id: string
  title: string
  /** `YYYY-MM-DD`. */
  departsOn?: string
  places: Place[]
  legs: Leg[]
  /** Booked flights, if the share link is set to show reservations. */
  flights?: Flight[]
  /** Booked lodging, from the same section and the same switch. */
  stays?: Stay[]
  /**
   * Routes the document already carries, keyed `fromPlaceId>toPlaceId` on
   * *Google's* ids and holding the document's own mode.
   *
   * Keyed that way, and kept on the trip rather than on the legs, because the
   * legs are re-derived from the places on every read — `withLegs` builds
   * them fresh — so anything stored on a leg is thrown away before it is ever
   * seen. This is the document's index copied across intact; `withLegs`
   * resolves it back onto the legs it just built, using the same two places
   * it built each one from. Nothing has to agree about pairing for that to be
   * right, which is the point.
   */
  routes?: Record<string, RouteFact>
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
  /**
   * `day` carries the chapter itself: its id is the day index as a string.
   *
   * A chapter had no subject until now, so its heading was computed — the
   * first stop's name, "to", the last stop's name. On a day that starts at a
   * bakery and ends at a restaurant that reads "Antonínovo pekařství to
   * Vinohradský Parlament", which is a true sentence about a day spent in a
   * castle, two galleries and an opera house, and tells a reader nothing.
   * Naming a day is a judgement about what the day is for, so it belongs
   * where every other judgement in this book lives: written, and checked.
   */
  kind: 'place' | 'corridor' | 'day'
  id: string
}

export const PASSAGE_KINDS = [
  'origin',
  'event',
  'table',
  'craft',
  'nearby',
  'look_for',
  'passing',
  'prepare',
  'chapter',
] as const

export type PassageKind = (typeof PASSAGE_KINDS)[number]

/** Which subjects a kind may attach to. Enforced by `check`, not by types. */
export const KIND_SUBJECTS: Record<PassageKind, ReadonlyArray<Subject['kind']>> = {
  origin: ['place'],
  event: ['place', 'corridor'],
  table: ['place'],
  craft: ['place'],
  // What is around a stop that the itinerary does not include. A hotel has
  // nothing to say about itself and a great deal to say about its street,
  // and there was no kind for that until a hotel needed one.
  nearby: ['place'],
  look_for: ['place', 'corridor'],
  // The only kind that attaches to a day. Its title is the chapter heading
  // and its body is the paragraph under it, which was previously a count of
  // stops.
  chapter: ['day'],
  passing: ['corridor'],
  // A corridor you cannot see out of, and also a place you are about to leave
  // from. An airport on the morning of a flight is exactly the subject this
  // kind was written for; it was corridor-only because corridors needed it
  // first, not because places did not.
  prepare: ['corridor', 'place'],
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
  /**
 * Where the picture came from, which is what decides whether it may carry the
 * place's name.
 *
 * `search` is a guess from a text query and never earns a name. `import` is
 * the image attached to this place's own record in the itinerary it came from
 * — not a result matched to a string, but a photograph filed against this
 * Google place id — and that is evidence of a different kind. `person` is
 * somebody who looked at it.
 */
  chosenBy: 'auto' | 'person' | 'import'
}

/**
 * The practical spine a place hangs on: what the import already knows.
 *
 * Read, never derived. These are Google's facts arriving through Wanderlog,
 * and the app's job is to show them next to the writing rather than to
 * recompute or verify them — which is the distinction the whole design turns
 * on and the one the previous app got wrong.
 */
export interface PlaceFacts {
  placeId: string
  /** One line per day, as Google phrases it. */
  hours?: string[]
  rating?: number
  ratingCount?: number
  website?: string
  /** What the kitchen is known for. Names only. */
  dishes?: Array<{ name: string; imageKey?: string }>
}

export interface Guide {
  tripId: string
  passages: Passage[]
  photos: Photo[]
  facts?: Record<string, PlaceFacts>
  /** `YYYY-MM-DD`. */
  builtAt: string
}
