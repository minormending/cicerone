import { timezoneForCountry } from '../geo/timezones.ts'
import type { Coordinates, Flight, FlightEnd, Place, RouteFact, Stay, TransportMode, Trip } from '../domain/types.ts'
import { decodePolyline } from '../geo/polyline.ts'

/**
 * Maps a Wanderlog trip document into a trip graph.
 *
 * The document shape is not public and the CLI passes it through untyped, so
 * this walks the structure rather than indexing fixed paths: it finds sections
 * by their heading and places by the Google Places object hanging off them. A
 * nesting change upstream costs a field, not the whole import.
 *
 * The important consequence is that Wanderlog places already carry Google
 * geometry, so an import needs no geocoding at all — which also means none of
 * the ambiguity that made "Meiji Jingu" resolve to the stadium. The traveller
 * already picked the exact place.
 *
 * Every field name here was read off a real document from
 * /api/tripPlans/<key>?clientSchemaVersion=2, not off the CLI's types. The
 * first version of this file was written from the types and matched nothing:
 * the heading field is `heading`, not `displayHeading`, and the envelope is
 * `tripPlan`, not `data`. Both mistakes were invisible because the test fixture
 * had been invented from the same types. test/wanderlog.test.ts now runs
 * against a verbatim excerpt of a real trip so that cannot recur.
 */

export interface WanderlogReport {
  sections: number
  places: number
  /** Entries that carried a name but no usable coordinates. */
  skipped: string[]
  /** Places held in standing buckets rather than on a day. */
  unscheduled: number
  /** Places whose country component was contradicted by their own address. */
  regionCorrections: Array<{ name: string; stated: string; corrected: string }>
  /**
   * Places whose country component disagrees with the rest of the trip.
   *
   * Reported, never corrected. Some are genuine — the outbound airport is in
   * another country by definition — and some are upstream data errors: the
   * Prague document used for the fixture tags four Czech places `US`. Guessing
   * which is which is exactly the kind of invention the content tiers forbid.
   */
  regionConflicts: Array<{ name: string; region: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Quill delta: {"ops":[{"insert":"…"}]}. A bare string is stored verbatim too. */
export function noteText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (!isRecord(value) || !Array.isArray(value['ops'])) return undefined
  const text = (value['ops'] as unknown[])
    .map((op) => (isRecord(op) && typeof op['insert'] === 'string' ? op['insert'] : ''))
    .join('')
    .trim()
  return text || undefined
}

export function coordsFrom(place: Record<string, unknown>): Coordinates | undefined {
  const geometry = place['geometry']
  if (isRecord(geometry)) {
    const location = geometry['location']
    if (isRecord(location)) {
      const lat = location['lat']
      const lng = location['lng']
      if (typeof lat === 'number' && typeof lng === 'number') return { lat, lon: lng }
    }
  }
  // Some payloads carry flattened coordinates instead of a Google geometry.
  const lat = place['latitude'] ?? place['lat']
  const lon = place['longitude'] ?? place['lng'] ?? place['lon']
  if (typeof lat === 'number' && typeof lon === 'number') return { lat, lon }
  return undefined
}

/**
 * Country names to ISO codes, from two sources that each cover the other's gap.
 *
 * Google writes the same country several ways: the edit-key document pairs both
 * "Czech Republic" and "Czechia" with CZ, and both "United States" and "United
 * States of America" with US. So the components are read as the glossary they
 * already are — a pairing stated anywhere in the document is known everywhere
 * in it.
 *
 * That alone was not enough, which only showed up against the live route. The
 * *view-key* document — the one the scheduled sync actually reads — never
 * writes "Czechia" at all, so the addresses ending in it resolved to nothing
 * and no contradiction was visible. ICU supplies the canonical English name for
 * a code, which fills exactly that gap.
 *
 * Candidates are limited to codes the document itself uses, so this can never
 * resolve an address to a country nobody on the trip is anywhere near.
 */
export function countryNamesToCodes(document: unknown): Map<string, string> {
  const out = new Map<string, string>()
  const codes = new Set<string>()
  const seen = new Set<unknown>()

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node) || seen.has(node)) return
    seen.add(node)

    const types = node['types']
    const long = node['long_name']
    const short = node['short_name']
    if (
      Array.isArray(types) &&
      types.includes('country') &&
      typeof short === 'string' &&
      short.length === 2
    ) {
      const code = short.toLowerCase()
      codes.add(code)
      if (typeof long === 'string' && long.trim()) out.set(long.trim().toLowerCase(), code)
    }

    for (const value of Object.values(node)) walk(value)
  }

  walk(document)

  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' })
    for (const code of codes) {
      const name = display.of(code.toUpperCase())
      // `of` echoes the input back when it knows nothing, which is not a name.
      if (name && name.toLowerCase() !== code) out.set(name.trim().toLowerCase(), code)
    }
  } catch {
    /* no ICU region names here; the document's own pairings still stand */
  }

  return out
}

/** The country a place's own address ends with, if the document names it. */
function countryFromAddress(
  place: Record<string, unknown>,
  names: Map<string, string>,
): string | undefined {
  const formatted = place['formatted_address']
  if (typeof formatted !== 'string') return undefined
  const tail = formatted.split(',').pop()?.trim().toLowerCase()
  if (!tail) return undefined
  if (tail.length === 2) return tail
  return names.get(tail)
}

interface Country {
  code: string
  /** The component said one country and the address said another. */
  contradicted?: string
}

/**
 * Which country a place is in — and whether the record agrees with itself.
 *
 * Four places in the Prague trip carry a US country component while their own
 * formatted_address ends in Czechia: a garden inside Prague Castle, a street in
 * Vinohrady, a column in Kutná Hora, a viewpoint in Prague 2. The tag is
 * upstream and wrong, and it cost each of them a timezone, which is why their
 * photo cards fell back to a longitude estimate.
 *
 * The address wins, because it is corroborated: the locality components, the
 * postcode and the coordinates all agree with it and only the country field
 * does not. This is not a guess about where the place is — it is two fields in
 * one record disagreeing, and the one with support behind it being believed.
 *
 * It stays silent where there is nothing to compare. JFK's address ends in a
 * postcode with no country after it, so nothing contradicts its US tag and it
 * keeps it.
 */
function countryFrom(place: Record<string, unknown>, names: Map<string, string>): Country | undefined {
  let stated: string | undefined
  const components = place['address_components']
  if (Array.isArray(components)) {
    for (const part of components) {
      if (!isRecord(part)) continue
      const types = part['types']
      if (Array.isArray(types) && types.includes('country') && typeof part['short_name'] === 'string') {
        stated = part['short_name'].toLowerCase()
        break
      }
    }
  }

  const fromAddress = countryFromAddress(place, names)
  if (stated && fromAddress && stated !== fromAddress) {
    return { code: fromAddress, contradicted: stated }
  }
  if (stated) return { code: stated }
  if (fromAddress) return { code: fromAddress }
  return undefined
}

interface Extracted {
  name: string
  coords: Coordinates
  note?: string
  region?: string
  /** The country the record stated, where its own address disagreed. */
  correctedFrom?: string
  time?: string
  /** The mode Wanderlog states for arriving here. Almost always absent. */
  travelMode?: TransportMode
  placeId?: string
  imageKey?: string
}

/** A section is an object carrying a heading; days and buckets both.
 *
 *  Real documents use `heading`, which is often the empty string on a day —
 *  the day is labelled by its `date` instead. `displayHeading` is accepted
 *  because the CLI's types name it and an older payload may still use it. */
function isSection(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    (typeof value['heading'] === 'string' || typeof value['displayHeading'] === 'string')
  )
}

/** Days say so: `mode: "dayPlan"`, and they carry the date. Everything else is
 *  a standing bucket, whatever its `type` says. In the Prague document eleven
 *  of fourteen sections are `type: "normal"` and only five of those are days;
 *  "Places to visit", "Views" and "Food" are the rest, and several of their
 *  entries are notes explaining why they were *dropped* from the itinerary.
 *  Filtering on `type` alone put thirty rejected candidates ahead of the trip. */
function isDay(section: Record<string, unknown>): boolean {
  return section['mode'] === 'dayPlan'
}

/**
 * The mode the document states, where it states one.
 *
 * Every block carries a `travelMode` field and it is `null` on 97 of the 99
 * blocks in a real, fully planned trip — the traveller never set it. So this
 * is not a replacement for inferring a mode, only a correction to it: a
 * stated mode always wins, and the rest are worked out from the distance and
 * the clock.
 *
 * `itinerary.options.defaultTravelMode` is the trip-wide fallback and is a
 * preference rather than a statement about any particular leg, so it is
 * deliberately not used: "transit" set once in the settings does not make the
 * four-minute walk between two palaces a tram ride.
 */
const WANDERLOG_MODES: Record<string, TransportMode> = {
  walking: 'walk',
  walk: 'walk',
  bicycling: 'cycle',
  cycling: 'cycle',
  driving: 'drive',
  drive: 'drive',
  transit: 'transit',
  flying: 'flight',
  flight: 'flight',
}

export function travelModeFrom(entry: Record<string, unknown>): TransportMode | undefined {
  const raw = entry['travelMode']
  return typeof raw === 'string' ? WANDERLOG_MODES[raw.toLowerCase()] : undefined
}

function timeFrom(entry: Record<string, unknown>): string | undefined {
  for (const key of ['startTime', 'start_time', 'time']) {
    const raw = entry[key]
    if (typeof raw === 'string') {
      const match = /^(\d{1,2}):(\d{2})/.exec(raw.trim())
      if (match) return `${match[1]!.padStart(2, '0')}:${match[2]}`
    }
  }
  return undefined
}

/**
 * The flights, out of the section Wanderlog keeps them in.
 *
 * These are not places and do not belong in the graph: a flight block has no
 * `place`, so the place walk never sees one, and the two airports are already
 * stops in their own right. What a flight adds is the pair of times nothing
 * else in the document has — when the aircraft actually leaves and lands, as
 * against when the traveller planned to be at the airport.
 *
 * Absent entirely unless the share key says `showReservations: true`.
 */
export function flightsFrom(document: unknown): Flight[] {
  const out: Flight[] = []
  const seen = new Set<unknown>()

  const end = (value: unknown): FlightEnd | undefined => {
    if (!isRecord(value)) return undefined
    const airport = isRecord(value['airport']) ? value['airport'] : undefined
    const iata = airport?.['iata']
    const name = airport?.['name']
    const date = value['date']
    const time = value['time']
    if (typeof iata !== 'string' || typeof date !== 'string' || typeof time !== 'string') return undefined
    const city = airport?.['cityName']
    return {
      iata,
      name: typeof name === 'string' ? name : iata,
      date,
      time,
      ...(typeof city === 'string' && city ? { city } : {}),
    }
  }

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node) || seen.has(node)) return
    seen.add(node)

    if (node['type'] === 'flight') {
      const info = isRecord(node['flightInfo']) ? node['flightInfo'] : undefined
      const airline = isRecord(info?.['airline']) ? info['airline'] : undefined
      const code = airline?.['iata']
      const number = info?.['number']
      const depart = end(node['depart'])
      const arrive = end(node['arrive'])
      if (depart && arrive && (typeof number === 'number' || typeof number === 'string')) {
        out.push({
          number: typeof code === 'string' ? `${code}${number}` : String(number),
          airline: typeof airline?.['name'] === 'string' ? (airline['name'] as string) : '',
          depart,
          arrive,
        })
      }
      return
    }

    for (const value of Object.values(node)) walk(value)
  }

  walk(document)
  // In the order they are flown, not the order they were typed.
  return out.sort((a, b) => `${a.depart.date}${a.depart.time}`.localeCompare(`${b.depart.date}${b.depart.time}`))
}

/**
 * The booked stays, out of the lodging section.
 *
 * A hotel block is an ordinary place block with a `hotel` record hung off it,
 * and it lives in a standing bucket rather than on a day — the same hotel is
 * separately a stop on four different days, and none of those stops carries
 * the booking. Matching the two up is what the Google place id is for.
 */
export function staysFrom(document: unknown): Stay[] {
  const out: Stay[] = []
  const seen = new Set<unknown>()

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (!isRecord(node) || seen.has(node)) return
    seen.add(node)

    const booking = node['hotel']
    const place = node['place']
    if (isRecord(booking) && isRecord(place)) {
      const checkIn = booking['checkIn']
      const checkOut = booking['checkOut']
      const name = place['name']
      if (typeof checkIn === 'string' && typeof checkOut === 'string' && typeof name === 'string') {
        const placeId = place['place_id']
        out.push({
          name: name.trim(),
          checkIn,
          checkOut,
          ...(typeof placeId === 'string' && placeId ? { placeId } : {}),
        })
        return
      }
    }

    for (const value of Object.values(node)) walk(value)
  }

  walk(document)
  return out.sort((a, b) => a.checkIn.localeCompare(b.checkIn))
}

/** Depth-first walk collecting every place-bearing entry under a node. */
function collectPlaces(
  node: unknown,
  out: Extracted[],
  seen: Set<unknown>,
  skipped: string[],
  names: Map<string, string>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPlaces(item, out, seen, skipped, names)
    return
  }
  if (!isRecord(node) || seen.has(node)) return
  seen.add(node)

  const candidate = isRecord(node['place']) ? (node['place'] as Record<string, unknown>) : undefined
  if (candidate) {
    const coords = coordsFrom(candidate)
    const name = candidate['name']
    if (typeof name === 'string' && name.trim()) {
      if (coords) {
        const extracted: Extracted = { name: name.trim(), coords }
        const note = noteText(node['text'] ?? node['note'])
        if (note) extracted.note = note
        const country = countryFrom(candidate, names)
        if (country) {
          extracted.region = country.code
          if (country.contradicted) extracted.correctedFrom = country.contradicted
        }
        const time = timeFrom(node)
        if (time) extracted.time = time
        const stated = travelModeFrom(node)
        if (stated) extracted.travelMode = stated
        const placeId = candidate['place_id']
        if (typeof placeId === 'string' && placeId) extracted.placeId = placeId
        // The traveller's chosen picture first, then whatever the block holds.
        const selected = node['selectedImageKey']
        const keys = node['imageKeys']
        const image =
          typeof selected === 'string' && selected
            ? selected
            : Array.isArray(keys) && typeof keys[0] === 'string'
              ? (keys[0] as string)
              : undefined
        if (image) extracted.imageKey = image
        out.push(extracted)
      } else {
        // Named but unplaceable. Recorded rather than dropped in silence,
        // because a missing stop is the kind of thing a traveller notices at
        // the wrong moment.
        skipped.push(name.trim())
      }
      return
    }
  }

  for (const value of Object.values(node)) collectPlaces(value, out, seen, skipped, names)
}

function findSections(node: unknown, out: Array<Record<string, unknown>>, seen: Set<unknown>): void {
  if (Array.isArray(node)) {
    for (const item of node) findSections(item, out, seen)
    return
  }
  if (!isRecord(node) || seen.has(node)) return
  seen.add(node)
  if (isSection(node)) {
    out.push(node)
    return
  }
  for (const value of Object.values(node)) findSections(value, out, seen)
}

function slugId(name: string, index: number): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `place:${index}:${slug || 'place'}`
}

/** The payload sits under `tripPlan` on /api/tripPlans/<key>, and under `data`
 *  on most other routes. Either, or the bare document. */
function unwrap(document: unknown): Record<string, unknown> {
  if (!isRecord(document)) return {}
  for (const key of ['tripPlan', 'data']) {
    const inner = document[key]
    if (isRecord(inner)) return inner
  }
  return document
}


/**
 * Google's travel modes as the document writes them, in ours.
 *
 * A mode outside this list means a route we have no name for, and a route we
 * have no name for cannot be matched against a leg's mode — which is the only
 * thing standing between a tram line and a paragraph about a walk. So it is
 * dropped rather than guessed at.
 */
const DOCUMENT_MODE: Record<string, TransportMode> = {
  walking: 'walk',
  transit: 'transit',
  driving: 'drive',
  bicycling: 'cycle',
}

/**
 * The routes the document already carries.
 *
 * `resources.distancesBetweenPlaces` is keyed by a JSON array written as a
 * string — `["ChIJ...","ChIJ...","walking"]` — and holds, for each pair the
 * planner has looked at, the distance, the duration and Google's encoded
 * polyline for the actual route. Every corridor of a fully planned trip is in
 * there, which means the real line down the real street is in the file we
 * already download and nothing needs to be fetched or derived to draw it.
 *
 * Two traps, both of them found by reading the data rather than the field
 * names. The field actually called `stopPolylines` is an empty object, the
 * same way `flightUpdates` was empty on the first share key — the name is not
 * where the data is. And the `text` on a distance is rendered for the account
 * that owns the trip, so a European itinerary comes back with `0.33 mi` next
 * to `15.1 km` in the same document. Only `value` is read, which is metres
 * and seconds regardless.
 */
export function routesFrom(document: unknown): Record<string, RouteFact> {
  // `resources` is a sibling of `tripPlan`, not a child of it, so this reads
  // the raw document first and the unwrapped one only as a fallback. Going
  // through `unwrap` alone found nothing at all and reported a clean zero,
  // which is the quietest possible way for an importer to be broken.
  const table = [document, unwrap(document)]
    .map((level) => (isRecord(level) && isRecord(level['resources']) ? level['resources'] : undefined))
    .map((resources) =>
      resources && isRecord(resources['distancesBetweenPlaces'])
        ? resources['distancesBetweenPlaces']
        : undefined,
    )
    .find(Boolean)
  if (!table) return {}

  const out: Record<string, RouteFact> = {}
  for (const [key, entry] of Object.entries(table)) {
    let parsed: unknown
    try {
      parsed = JSON.parse(key)
    } catch {
      continue
    }
    if (!Array.isArray(parsed) || parsed.length < 3) continue
    const [from, to, stated] = parsed as unknown[]
    if (typeof from !== 'string' || typeof to !== 'string' || typeof stated !== 'string') continue
    const mode = DOCUMENT_MODE[stated]
    if (!mode) continue

    if (!isRecord(entry)) continue
    const route = entry['route']
    if (!isRecord(route)) continue
    const encoded = route['polyline']
    if (typeof encoded !== 'string' || !encoded) continue

    const path = decodePolyline(encoded)
    // Two points is the least that is a line. One is a rounding artefact and
    // none is a polyline that did not decode.
    if (path.length < 2) continue

    const metres = numberIn(route['distance'])
    const seconds = numberIn(route['duration'])
    if (metres === undefined || seconds === undefined) continue

    out[`${from}>${to}`] = { metres, seconds, path, mode }
  }
  return out
}

/** `{value, text}` as Google writes a measurement. Only the value is trusted. */
function numberIn(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const n = value['value']
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

export function tripFromWanderlog(
  document: unknown,
  opts: { id?: string; title?: string; departsOn?: string } = {},
): { trip: Trip; report: WanderlogReport } {
  const doc = unwrap(document)
  // Read from the whole document, not just the itinerary: a name/code pairing
  // stated anywhere in it is a fact about the world, wherever it was written.
  const countryNames = countryNamesToCodes(document)

  const sections: Array<Record<string, unknown>> = []
  // Only the itinerary, so the walk cannot wander into `resources`, which
  // carries hundreds of recommended places the traveller never chose.
  findSections(isRecord(doc['itinerary']) ? doc['itinerary'] : doc, sections, new Set())

  const report: WanderlogReport = {
    sections: sections.length,
    places: 0,
    skipped: [],
    unscheduled: 0,
    regionCorrections: [],
    regionConflicts: [],
  }
  const places: Place[] = []
  let index = 0
  let dayIndex = 0

  const days = sections.filter(isDay)
  // Days first, in order, then the buckets — which keep their places (the
  // traveller curated them, notes and all) but get no dayIndex, because they
  // are not on any day.
  const ordered = days.length > 0 ? [...days, ...sections.filter((s) => !isDay(s))] : sections

  for (const section of ordered) {
    const found: Extracted[] = []
    collectPlaces(section, found, new Set(), report.skipped, countryNames)
    if (found.length === 0) continue
    const scheduled = days.length === 0 || isDay(section)
    if (scheduled) dayIndex++

    for (const entry of found) {
      const place: Place = {
        id: slugId(entry.name, index++),
        name: entry.name,
        coords: entry.coords,
      }
      if (scheduled) place.dayIndex = dayIndex
      else report.unscheduled++
      if (entry.time) place.arrive = entry.time
      /*
       * Why the stop is on the day, in the traveller's own words.
       *
       * `noteText` has read these since the beginning and `brief()` has
       * serialised them since the beginning, and the line joining the two was
       * never written — so every note anybody wrote was collected, carried
       * halfway, and dropped on the floor. On one Prague trip that is a
       * sentence against nearly every scheduled stop saying exactly what it is
       * for: "6 min from the hotel; fast, which suits an arrival day",
       * "groceries, open to 21:00, on the way to the metro".
       *
       * That is the single most valuable field in the document. Everything
       * else here describes what a place *is*; this is the only thing that
       * says why it was chosen, and no amount of research reconstructs it.
       */
      if (entry.note) place.note = entry.note
      // Carried on the place because a leg is derived from the pair, and the
      // mode the document states belongs to arriving *here*.
      if (entry.travelMode) place.arriveBy = entry.travelMode
      if (entry.placeId) place.placeId = entry.placeId
      if (entry.imageKey) place.imageKey = entry.imageKey
      if (entry.region) {
        place.countryCode = entry.region
        if (entry.correctedFrom) {
          report.regionCorrections.push({
            name: entry.name,
            stated: entry.correctedFrom,
            corrected: entry.region,
          })
        }
        const tz = timezoneForCountry(entry.region)
        if (tz) place.timezone = tz
      }
      places.push(place)
      report.places++
    }
  }

  // Whichever country most of the trip is in. Anything else is worth a look.
  const counts = new Map<string, number>()
  for (const p of places) if (p.countryCode) counts.set(p.countryCode, (counts.get(p.countryCode) ?? 0) + 1)
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (dominant) {
    for (const p of places) {
      if (p.countryCode && p.countryCode !== dominant) {
        report.regionConflicts.push({ name: p.name, region: p.countryCode })
      }
    }
  }

  const title =
    opts.title ??
    (typeof doc['title'] === 'string' && doc['title'].trim() ? doc['title'].trim() : 'Wanderlog trip')
  const departsOn =
    opts.departsOn ?? (typeof doc['startDate'] === 'string' ? doc['startDate'].slice(0, 10) : undefined)

  const trip: Trip = {
    id: opts.id ?? `trip:wanderlog:${Date.now()}`,
    title,
    places,
    legs: [],
  }
  if (departsOn) trip.departsOn = departsOn
  // Read off the whole document rather than the itinerary: the Flights section
  // sits beside the days, not inside them.
  const flights = flightsFrom(document)
  if (flights.length > 0) trip.flights = flights
  const stays = staysFrom(document)
  if (stays.length > 0) trip.stays = stays
  const routes = routesFrom(document)
  if (Object.keys(routes).length > 0) trip.routes = routes
  return { trip, report }
}

/** The short id in wanderlog.com/plan/<key>. */
export function wanderlogKey(document: unknown): string | undefined {
  const root = unwrap(document)
  return typeof root['key'] === 'string' ? root['key'] : undefined
}
