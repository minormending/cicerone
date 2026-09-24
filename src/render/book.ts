import type { Corridor, Coordinates, Flight, Guide, Leg, Passage, Photo, Place, PlaceFacts, RouteFact, Stay, Subject, Trip } from '../domain/types.ts'
import { imageUrl } from '../import/wanderlogPlaces.ts'
import { metresBetween } from '../corridor/legs.ts'
import { dayDirectionsUrl, directionsLabel, directionsUrl } from './directions.ts'

/**
 * The book.
 *
 * Chapters by day, each a sequence of places and the corridors between them,
 * read front to back. The corridor passages are what make it read like a book
 * rather than a directory: a day becomes arrive, walk, notice, arrive, instead
 * of a list of pins.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * A passage is markdown, but only ever a little of it: paragraphs, emphasis
 * and nothing else. A full renderer would be a dependency and an injection
 * surface for prose a model wrote, in exchange for formatting nobody needs in
 * a guidebook.
 */
export function paragraphs(body: string, claims: Passage['claims'], offset: number): string {
  return body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${inline(block, claims, offset)}</p>`)
    .join('\n')
}

function inline(block: string, claims: Passage['claims'], offset: number): string {
  let html = escapeHtml(block)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![*\w])\*([^*]+)\*(?!\w)/g, '<em>$1</em>')

  // A claim marks the end of the sentence it belongs to, so the reader can see
  // which assertion is being held up rather than which paragraph.
  claims.forEach((claim, index) => {
    const needle = escapeHtml(claim.text.trim())
    const at = html.indexOf(needle)
    if (at === -1) return
    const end = at + needle.length
    const n = offset + index + 1
    html = `${html.slice(0, end)}<a class="claim" href="#claim-${n}" aria-label="Source ${n}">${n}</a>${html.slice(end)}`
  })
  return html
}

function subjectKey(subject: Subject): string {
  return `${subject.kind}:${subject.id}`
}

/**
 * The stops of each day, in the order the traveller arranged them.
 *
 * The document's order, deliberately, and not sorted by the clock. Sorting
 * looked safer and was wrong, and it took a routed line on a map to show it:
 * most stops on a real itinerary carry no arrival time at all, a sort sends
 * every one of them to the end of the day, and day two of this trip read
 * Lokál at half past seven, then the hotel, then Old Town Square, then the
 * Klementinum, then the bridge. Four stops in the wrong half of the evening.
 *
 * Worse than the stops being out of order, the corridors were not. They are
 * placed after the stop they leave from, and they come from `inferLegs`,
 * which has always used the document's order — so the chapter was announcing
 * a walk from Mr. Banh Mi to Old Town Square and then showing the
 * Astronomical Clock. The two orders have to be one order, and the document's
 * is the one that is also the itinerary.
 *
 * It is invisible on a day where every stop has a time, which is why three of
 * this trip's five days were unaffected and nobody caught it.
 */
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

export function dateOf(trip: Trip, dayIndex: number): string {
  if (!trip.departsOn) return ''
  const at = new Date(new Date(trip.departsOn).getTime() + (dayIndex - 1) * 86_400_000)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(at)
}

/**
 * The span of the trip, as a book's title page would set it.
 *
 * "Wednesday 14 October to Sunday 18 October" twice over is a lot of words
 * for one line, so the month and year are said once when both ends share
 * them — which is how anybody writing a date range by hand would do it.
 */
export function dateRange(trip: Trip, days: number): string {
  if (!trip.departsOn) return ''
  const start = new Date(trip.departsOn)
  const end = new Date(start.getTime() + Math.max(0, days - 1) * 86_400_000)
  const part = (at: Date, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(at)

  const year = part(end, { year: 'numeric' })
  if (part(start, { month: 'long' }) === part(end, { month: 'long' })) {
    return `${part(start, { day: 'numeric' })} \u2013 ${part(end, { day: 'numeric', month: 'long' })} ${year}`
  }
  return `${part(start, { day: 'numeric', month: 'long' })} \u2013 ${part(end, { day: 'numeric', month: 'long' })} ${year}`
}

/**
 * A row of counts.
 *
 * Pluralised, because "1 Corridors" is the sort of thing that makes a reader
 * stop trusting the careful parts of a page. The day version is dropped
 * altogether where there is only one stop: a summary of a single thing is not
 * a summary, it is furniture. Day one of this trip is an airport and an
 * overnight flight, and it carried "1 Stops / 0 Corridors" under its own
 * chapter heading, which says nothing twice.
 */
function figures(cells: Array<{ n: number; one: string; many: string }>): string {
  const cell = ({ n, one, many }: { n: number; one: string; many: string }) =>
    `<div><div class="figure-n">${n}</div><div class="figure-l">${escapeHtml(n === 1 ? one : many)}</div></div>`
  return `<div class="figures">\n${cells.map(cell).join('\n')}\n</div>`
}

/**
 * The flights touching a day, set like the line on a boarding pass.
 *
 * A flight shows on both days it touches: the day you get on it and the day
 * you get off, which for a night crossing are different days and the second
 * one is the one that matters. Times are local to each end and exactly as the
 * airline states them — no duration, because working one out needs both ends
 * resolved to a real timezone and this document's own offset for Prague is an
 * hour wrong in October.
 */
function flightStrip(flights: Flight[] | undefined, trip: Trip, dayIndex: number): string {
  if (!flights || flights.length === 0 || !trip.departsOn) return ''
  const on = new Date(new Date(trip.departsOn).getTime() + (dayIndex - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const rows = flights
    .filter((f) => f.depart.date === on || f.arrive.date === on)
    .map((f) => {
      const overnight = f.arrive.date !== f.depart.date ? '<span class="flight-next">+1</span>' : ''
      return `<div class="flight">
<span class="flight-no">${escapeHtml(f.number)}</span>
<span class="flight-leg">${escapeHtml(f.depart.iata)} <b>${escapeHtml(f.depart.time)}</b></span>
<span class="flight-arrow">&rarr;</span>
<span class="flight-leg">${escapeHtml(f.arrive.iata)} <b>${escapeHtml(f.arrive.time)}</b>${overnight}</span>
<span class="flight-airline">${escapeHtml(f.airline)}</span>
</div>`
    })
  return rows.join('')
}

/**
 * The booked stay, on the two mornings it matters.
 *
 * Nights are computed here and a flight's hours are not, which is not an
 * inconsistency: a night is a whole calendar day apart and needs no timezone
 * to count, where an hour in the air needs both airports resolved and this
 * document gets one of them wrong.
 */
function stayStrip(stays: Stay[] | undefined, trip: Trip, dayIndex: number): string {
  if (!stays || stays.length === 0 || !trip.departsOn) return ''
  const on = new Date(new Date(trip.departsOn).getTime() + (dayIndex - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10)

  return stays
    .filter((stay) => stay.checkIn === on || stay.checkOut === on)
    .map((stay) => {
      const nights = Math.round(
        (new Date(stay.checkOut).getTime() - new Date(stay.checkIn).getTime()) / 86_400_000,
      )
      const arriving = stay.checkIn === on
      const tail = arriving
        ? `${nights} night${nights === 1 ? '' : 's'}, out on ${weekday(stay.checkOut)}`
        : `in since ${weekday(stay.checkIn)}`
      return `<div class="flight stay">
<span class="flight-no">${arriving ? 'Check in' : 'Check out'}</span>
<span class="flight-leg"><b>${escapeHtml(stay.name)}</b></span>
<span class="flight-airline">${escapeHtml(tail)}</span>
</div>`
    })
    .join('')
}

/** "Sunday", for a `YYYY-MM-DD`. */
function weekday(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(date))
}

/**
 * The front of the book.
 *
 * It opened on "Day One" with no cover, which is the one thing every printed
 * guide has and the reason a stack of chapters does not feel like a book.
 * Everything on it is derived — the city, the dates, four counts — because a
 * title page makes no claim about the world that could be wrong, and the
 * parts of this book that could be wrong are written and checked elsewhere.
 *
 * The counts are the honest advertisement for what this is. Corridors are on
 * it deliberately: they are the thing no other guide has, and a reader who
 * does not know to look for them will read the book as a list of stops.
 */
function titlePage(
  trip: Trip,
  city: string,
  counts: { days: number; stops: number; corridors: number; claims: number },
): string {
  const when = dateRange(trip, counts.days)

  return `<header class="title-page">
<div class="label accent">${escapeHtml(when || trip.title)}</div>
<h1>${escapeHtml(city)}</h1>
<p class="title-lead">${counts.stops} stops over ${counts.days} day${
    counts.days === 1 ? '' : 's'
  }, and the ground in between &mdash; which is the half nobody writes about.</p>
${figures([
    { n: counts.days, one: 'Day', many: 'Days' },
    { n: counts.stops, one: 'Stop', many: 'Stops' },
    { n: counts.corridors, one: 'Corridor', many: 'Corridors' },
    { n: counts.claims, one: 'Checked claim', many: 'Checked claims' },
  ])}
</header>`
}

const ORDINALS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

/**
 * Everything before the first comma, bracket or dash, minus a trailing word
 * that says only what kind of place it is.
 *
 * "Vinohradský Parlament Restaurant to Antonínovo pekařství" ran to four lines
 * of heading on a phone, and "Restaurant" was carrying none of them.
 *
 * Only words a listing appends, never ones a building is called. Palace,
 * museum and cathedral stay: "Šternberský" is an adjective, not a name, and
 * St. Vitus without its cathedral is a saint.
 */
const GENERIC_TAIL = /\s+(restaurant|café|cafe|bistro|bar|pub|hotel)$/i

export function shortName(name: string): string {
  const head = name.split(/[,(\u2013-]/)[0]?.trim() || name
  const trimmed = head.replace(GENERIC_TAIL, '')
  // Only when something recognisable is left: "Palace" alone is not a name.
  return trimmed.length >= 6 ? trimmed : head
}

/**
 * What to call a day.
 *
 * Derived from its own ends rather than invented, because an invented title
 * is the first place a guide starts sounding like a brochure. One stop is its
 * own title; several are the span between the first and the last.
 */
export function dayTitle(stops: Place[], city: string): string {
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (!first) return city
  if (!last || first === last) return shortName(first.name)
  const from = shortName(first.name)
  const to = shortName(last.name)
  return from === to ? from : `${from} to ${to}`
}

/** Is this subject one of today's? */
function onThisDay(subject: Subject, stops: Place[], corridors: Corridor[]): boolean {
  return subject.kind === 'place'
    ? stops.some((p) => p.id === subject.id)
    : corridors.some((c) => c.id === subject.id)
}

/**
 * How far apart two stops can be and still belong on the same little map.
 *
 * A day that starts at an airport has one leg of twelve kilometres and
 * thirteen of under two. Fitting all of it into one frame put the airport at
 * the far left and squashed the entire rest of the day into a thumbnail-sized
 * scribble on the right: a map of nothing, at the top of every chapter.
 *
 * So the map is of the day on foot. A stop whose nearest neighbour is further
 * than this is a transfer rather than part of the shape, and it is left off.
 */
const MAP_MAX_GAP_METRES = 3_000

/** The stops that make up the day's shape, without the transfers. */
export function mapPoints(places: Place[]): Place[] {
  if (places.length < 3) return places
  const near = places.filter((p) =>
    places.some((q) => q !== p && metresBetween(p.coords, q.coords) <= MAP_MAX_GAP_METRES),
  )
  // If nothing clusters, the day really is spread out and the map should say so.
  return near.length >= 2 ? near : places
}

const MAP_W = 800
const MAP_PAD = 30

/**
 * How the day reads in one direction rather than none.
 *
 * A closed coral loop with eight identical rings on it is a map of where the
 * day went and says nothing about which way round it went, which is half of
 * what a route is for. So the line and the rings fade from the first stop to
 * the last: strongest where you start, faintest where you end up.
 *
 * The floor is 0.4 rather than nothing, because the last stop of a day is not
 * less important than the first, only later. Below about a third it stops
 * being a pale mark and starts being a missing one.
 */
const FADE_FROM = 1
const FADE_TO = 0.4
const LINE_FROM = 0.95
const LINE_TO = 0.3

/** Where along the route this is, as an opacity. */
function fade(t: number, from: number, to: number): number {
  return Number((from + (to - from) * t).toFixed(3))
}
/** A frame shaped like the day, within reason: never a letterbox, never a tower. */
const MAP_MIN_H = 240
const MAP_MAX_H = 520

/**
 * The route, drawn as a coral line.
 *
 * The one image that is about *this* trip rather than borrowed, and the only
 * one we can always produce — so it has to be worth looking at.
 *
 * Projected at equal scale in both directions, with longitude compressed by
 * the cosine of the latitude, so the drawing is the shape the day actually
 * has. The first version stretched latitude and longitude independently to
 * fill a 10:1 box, which turns every route into a horizontal line whatever it
 * really looks like. A day that is genuinely linear should draw as a line; a
 * day that loops should draw as a loop.
 *
 * There are no labels. They used to sit in an evenly spaced row beneath a
 * geographically placed set of dots, so each name was under whichever dot
 * happened to be above it, which was none of them. The stops are named in the
 * chapter below in the order you visit them.
 */
/**
 * The day as a list of legs, each one a line of its own.
 *
 * A leg is the planner's polyline where the document carried one and its mode
 * agreed with ours, and the straight line between the two stops where it did
 * not — so a day never has a gap in it, whatever the import knew. The pairs
 * come from the stops that survived `mapPoints`, which means a transfer that
 * was dropped from the frame takes its twelve-kilometre line with it instead
 * of dragging the whole map out to the airport.
 */
interface Segment {
  points: Coordinates[]
  /** False for a straight line standing in for a route nobody has. */
  routed: boolean
}

function legSegments(stops: Place[], legs: Leg[]): Segment[] {
  const out: Segment[] = []
  for (let i = 0; i + 1 < stops.length; i++) {
    const from = stops[i] as Place
    const to = stops[i + 1] as Place
    const leg = legs.find((l) => l.fromPlaceId === from.id && l.toPlaceId === to.id)
    const path = leg?.route?.path
    out.push(
      path && path.length >= 2
        ? { points: path, routed: true }
        : { points: [from.coords, to.coords], routed: false },
    )
  }
  return out
}

export function routeSvg(places: Place[], legs: Leg[] = []): string {
  const stops = mapPoints(places)
  const points = stops.map((p) => p.coords)
  if (points.length < 2) return ''

  // One polyline per leg: the planner's own, where the document carried one
  // and its mode agreed, and the straight line between the two stops where it
  // did not. Both kinds draw identically, so a day with one unrouted leg is
  // one slightly straighter stretch rather than a different kind of picture.
  const segments = legSegments(stops, legs)
  const all = segments.flatMap((segment) => segment.points)
  /*
   * A leg we have no route for is drawn dotted — but only on a day where the
   * others are routed.
   *
   * Straightness used to mean nothing here: every leg was a straight line and
   * the drawing read as a schematic. Once four legs bend around corners and
   * one cuts diagonally across the frame, that one looks like a bug in the
   * renderer rather than a gap in what the import knew. Dotted says the true
   * thing: this is the way there, and this part of it is a guess.
   *
   * On a trip with no routed legs at all nothing is dotted, because then
   * straight is the convention again and every leg is keeping the same
   * honest silence.
   */
  const someRouted = segments.some((segment) => segment.routed)

  const meanLat = all.reduce((n, p) => n + p.lat, 0) / all.length
  const k = Math.cos((meanLat * Math.PI) / 180)
  const raw = all.map((p) => ({ x: p.lon * k, y: -p.lat }))

  const xs = raw.map((p) => p.x)
  const ys = raw.map((p) => p.y)
  const spanX = Math.max(...xs) - Math.min(...xs)
  const spanY = Math.max(...ys) - Math.min(...ys)
  if (spanX === 0 && spanY === 0) return ''

  // The frame takes the day's proportions rather than the day being squeezed
  // into a fixed one. Fitting a roughly square walk into a wide box left a
  // small squiggle adrift in a lot of empty sand.
  const inner = MAP_W - MAP_PAD * 2
  const height = spanX > 0
    ? Math.min(MAP_MAX_H, Math.max(MAP_MIN_H, Math.round((spanY / spanX) * inner) + MAP_PAD * 2))
    : MAP_MAX_H
  const mapH = height

  // One scale for both axes: that is what makes it a shape rather than a graph.
  const scale = Math.min(
    spanX > 0 ? inner / spanX : Infinity,
    spanY > 0 ? (mapH - MAP_PAD * 2) / spanY : Infinity,
  )
  const midX = (Math.max(...xs) + Math.min(...xs)) / 2
  const midY = (Math.max(...ys) + Math.min(...ys)) / 2

  const project = (p: Coordinates) => ({
    x: MAP_W / 2 + (p.lon * k - midX) * scale,
    y: mapH / 2 + (-p.lat - midY) * scale,
  })

  // One path per leg, so each can carry its own opacity. The round caps of two
  // neighbouring legs overlap at the stop between them, and every stop has a
  // dot drawn over it, so the join never shows.
  const last = segments.length
  const drawn: string[] = []
  segments.forEach((segment, i) => {
    const d = segment.points
      .map((p, n) => {
        const { x, y } = project(p)
        return `${n === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
    // Round caps turn a near-zero dash into a dot, so the gap is the whole
    // measurement and the line reads as a row of beads rather than a fence.
    const dots = someRouted && !segment.routed ? ' stroke-dasharray="0.1 10"' : ''
    drawn.push(
      `<path d="${d}" opacity="${fade((i + 0.5) / last, LINE_FROM, LINE_TO)}"${dots}></path>`,
    )
  })

  const xy = points.map(project)
  const dots = xy
    .map((p, i) =>
      i === 0
        ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="var(--coral)" stroke="none"></circle>`
        : `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="7" stroke-opacity="${fade(
            i / last,
            FADE_FROM,
            FADE_TO,
          )}"></circle>`,
    )
    .join('')

  return `<svg viewBox="0 0 ${MAP_W} ${mapH}" role="img" aria-label="The shape of the day on foot, ${points.length} stops, fading from the first to the last">
<g fill="none" stroke="var(--coral)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${drawn.join('')}</g>
<g fill="var(--paper)" stroke="var(--coral)" stroke-width="3.5">${dots}</g>
</svg>`
}

/**
 * The same points, for the real map that covers the drawing.
 *
 * Handed to the page as an attribute rather than fetched, so the map needs
 * nothing from the backend and a book saved to a file still has its routes.
 * Five decimal places is about a metre, which is finer than the itinerary
 * knows and far finer than the frame can show.
 */
export function routeData(places: Place[]): string {
  const points = mapPoints(places).map((p) => p.coords)
  if (points.length < 2) return ''
  return JSON.stringify(points.map((p) => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]))
}

/**
 * The same line the drawing draws, for the real map to take over.
 *
 * Separate from `routeData`, which is the stops: the map puts a ring on each
 * stop and a line along the route, and once the line follows streets those
 * are no longer the same list of points. Emitted as flat pairs rather than
 * objects because it is an attribute in a file somebody emails — a thousand
 * points as `{"lat":…,"lon":…}` is three times the bytes of the same thousand
 * as `[lon,lat]`, for a rendering detail nothing reads twice.
 *
 * Empty when no leg of the day carried a route, so the map falls back to
 * joining the stops and the page is exactly what it was before.
 */
export function pathData(places: Place[], legs: Leg[]): string {
  const stops = mapPoints(places)
  if (stops.length < 2) return ''
  const routed = legSegments(stops, legs)
  const anyReal = stops.some((from, i) => {
    const to = stops[i + 1]
    return to && legs.some((l) => l.fromPlaceId === from.id && l.toPlaceId === to.id && l.route)
  })
  if (!anyReal) return ''
  // Flattened: the legs already meet at the stops between them, so the joins
  // need no help, and one LineString is what the gradient runs along.
  const flat: Array<[number, number]> = []
  for (const segment of routed) {
    for (const point of segment.points) flat.push([point.lon, point.lat])
  }
  return JSON.stringify(flat)
}

/** The block a chapter opens with: the drawing, and what a map needs to replace it. */
function route(places: Place[], corridors: Corridor[], legs: Leg[]): string {
  const svg = routeSvg(places, legs)
  if (!svg) return ''
  const path = pathData(places, legs)
  return `<div class="route" data-route="${escapeHtml(routeData(places))}"${
    path ? ` data-path="${escapeHtml(path)}"` : ''
  }>${svg}${dayRoute(places, corridors)}</div>`
}

/**
 * The whole day, handed over in one link.
 *
 * Under the map rather than beside the heading, because it is the same offer
 * the map is making and a reader who wants the real streets is already
 * looking at the drawing of them. It is absent more often than it is present
 * — see `dayDirectionsUrl` for the four things that have to be true — and
 * that is deliberate: every corridor on the day has its own link regardless,
 * so nothing is lost when the day as a whole cannot be drawn honestly.
 */
function dayRoute(places: Place[], corridors: Corridor[]): string {
  const day = dayDirectionsUrl(places, corridors)
  if (!day) return ''
  return `<div class="route-foot"><a class="directions" href="${escapeHtml(day.url)}" title="${escapeHtml(
    day.description,
  )}" aria-label="${escapeHtml(day.description)}" target="_blank" rel="noreferrer noopener">${escapeHtml(
    day.label,
  )}<span class="arrow" aria-hidden="true">&#8599;</span></a></div>`
}

function figure(photo: Photo | undefined, place: Place | undefined, city: string): string {
  if (!photo) return ''
  // A caption may only claim what can be checked. Only a person can earn a
  // name — their own photograph, or one they chose having looked at it — so
  // everything found by searching is captioned as the city, which it is.
  const caption = photo.claim === 'named' && place ? place.name : city
  // Say where it came from, exactly. An imported picture called "your own
  // photograph" is a small lie about authorship in a book whose whole argument
  // is that it does not make those.
  const credit = photo.credit
    ? `Photo by <a href="${escapeHtml(photo.credit.link)}?utm_source=cicerone&amp;utm_medium=referral">${escapeHtml(photo.credit.name)}</a> on <a href="https://unsplash.com/?utm_source=cicerone&amp;utm_medium=referral">Unsplash</a>`
    : photo.chosenBy === 'import'
      ? 'From your itinerary'
      : 'Your own photograph'

  return `<figure>
<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(caption)}" loading="lazy">
<figcaption><span>${escapeHtml(caption)} &middot; ${credit}</span>
<button type="button" class="swap" data-swap="${escapeHtml(subjectKey(photo.subject))}">Swap photo</button></figcaption>
</figure>`
}

/**
 * The practical spine: opening hours, what people think, what to order.
 *
 * Shown, never derived. These are Google's facts arriving through the import,
 * and putting them beside the writing is the point — a guide that makes you
 * open another app to find out whether the place is shut is not a guide. Set
 * small and quiet, because they are the frame and the prose is the picture.
 */
function factsBlock(facts: PlaceFacts | undefined, arrive: string | undefined): string {
  if (!facts) return ''

  const today = arrive ? openingFor(facts.hours) : undefined
  const bits: string[] = []
  if (today) bits.push(`<span><b>Open</b> ${escapeHtml(today)}</span>`)
  if (facts.rating) {
    const count = facts.ratingCount ? ` &middot; ${facts.ratingCount.toLocaleString('en-GB')} reviews` : ''
    bits.push(`<span><b>${facts.rating.toFixed(1)}</b>${count}</span>`)
  }
  if (facts.website) {
    bits.push(`<a href="${escapeHtml(facts.website)}">${escapeHtml(hostOf(facts.website))}</a>`)
  }
  if (bits.length === 0) return ''
  return `<div class="facts">${bits.join('')}</div>`
}

/** Every day the same, or a range. Anything else is left to the hours list. */
function openingFor(hours: string[] | undefined): string | undefined {
  if (!hours || hours.length === 0) return undefined
  const times = hours.map((h) => h.split(': ').slice(1).join(': ').trim()).filter(Boolean)
  if (times.length === 0) return undefined
  const unique = [...new Set(times)]
  return unique.length === 1 ? (unique[0] as string) : `${times[0] as string} (varies by day)`
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/**
 * What the kitchen is known for, as pictures.
 *
 * This is the one place a photograph earns its keep on a restaurant. A stock
 * shot of somebody else's dining room says nothing; six plates from this
 * kitchen say what you are choosing between.
 */
function dishes(facts: PlaceFacts | undefined): string {
  const all = (facts?.dishes ?? []).filter((d) => d.imageKey)
  if (all.length < 3) return ''
  // Three or six, so the grid always tiles. A row of two orphans looks like a
  // mistake rather than a choice.
  const withImages = all.slice(0, all.length >= 6 ? 6 : 3)
  return `<div class="dishes">
${withImages
  .map(
    (d) =>
      `<figure><img src="${escapeHtml(imageUrl(d.imageKey as string, 'freeImageSmall'))}" alt="${escapeHtml(d.name)}" loading="lazy"><figcaption>${escapeHtml(d.name)}</figcaption></figure>`,
  )
  .join('\n')}
</div>`
}

const SUN_ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--coral-ink)" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.4v2.6M12 19v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.4 12H5M19 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9"></path></svg>'

const KIND_LABEL: Record<Passage['kind'], string> = {
  origin: 'Origin',
  event: 'What happened here',
  table: 'At the table',
  craft: 'Made here',
  nearby: 'Just round the corner',
  look_for: 'Look for',
  passing: 'Passing',
  prepare: 'Before you board',
  // Never shown as a label: a chapter is the heading, not a passage under one.
  chapter: 'The day',
}

/**
 * The order passages read in, which is not alphabetical and is not the order
 * they were written.
 *
 * Why this exists: sorted by name, `look_for` came before `origin`, so every
 * stop opened with its golden hour and the history sat underneath. The
 * computed light passage is a footnote to a place, not its headline, and it
 * goes last for the same reason.
 */
const KIND_ORDER: Record<Passage['kind'], number> = {
  // Lifted out of the stop list entirely and rendered as the chapter head.
  chapter: -1,
  origin: 0,
  event: 1,
  craft: 2,
  table: 3,
  nearby: 3.5,
  passing: 4,
  prepare: 5,
  look_for: 6,
}

interface Numbered {
  passage: Passage
  offset: number
}

/**
 * A passage, with the title it has always had and never shown.
 *
 * Every passage carries one, `check` refuses a passage without one, and the
 * routine writes them with some care — "Order the deer", "The tower nobody
 * looks up at", "The road they put through the middle of it". None of them
 * had ever reached a reader: renderPassage took the body and dropped the
 * title on the floor, so a stop with three passages arrived as eight hundred
 * words of undifferentiated prose under one heading.
 *
 * Showing them is most of what this page needed. It separates the history
 * from the practical without inventing any new furniture, it gives a long
 * entry something to scan, and it makes the shape of the writing visible —
 * which is the shape it was written in.
 *
 * Not on a computed passage. Those are one line of arithmetic about the sun
 * and already carry their own footer; a heading over them would be three
 * times the size of the thing it introduces.
 */
function renderPassage({ passage, offset }: Numbered): string {
  const body = paragraphs(passage.body, passage.claims, offset)
  if (passage.computed) {
    return `${body}<div class="computed">${SUN_ICON}<span>Computed from latitude, longitude and date &mdash; no source needed</span></div>`
  }
  const title = passage.title.trim()
  return `${title ? `<h3 class="passage-title">${escapeHtml(title)}</h3>` : ''}${body}`
}

/**
 * A stop, or nothing.
 *
 * Nothing is the common case. The rule that matters is the one about what
 * counts as something: a computed light passage rides along with research, it
 * does not justify an entry on its own. Without that, every stop on the trip
 * rendered — thirty-three headings each followed by one line of golden hour,
 * several of them identical, which is the padding this whole design refuses
 * arriving through the back door.
 *
 * A photograph is enough on its own, because a chapter opener is a deliberate
 * element rather than an accident of having computed something.
 */
function renderPlace(
  place: Place,
  passages: Numbered[],
  photo: Photo | undefined,
  city: string,
  facts: PlaceFacts | undefined,
): string {
  const researched = passages.some((n) => !n.passage.computed)
  if (!researched && !photo) return ''

  const lead = passages[0]?.passage
  return `<section class="entry" id="place-${escapeHtml(place.id)}">
<div class="entry-side">
<div class="label accent">${escapeHtml(lead ? KIND_LABEL[lead.kind] : 'Stop')}</div>
${place.arrive ? `<div class="entry-when">${escapeHtml(place.arrive)}</div>` : ''}
</div>
<div class="entry-body">
<h2>${escapeHtml(place.name)}</h2>
${factsBlock(facts, place.arrive)}
${ownNote(place)}
${passages.map(renderPassage).join('\n')}
${dishes(facts)}
${figure(photo, place, city)}
</div>
</section>`
}

/**
 * What the traveller wrote here, in their own voice and marked as theirs.
 *
 * This is the one thing on the page the guide did not write, and it has to
 * look like it. Everything else here is research — prose in the serif, facts
 * in the sans, a corridor in its sand band — and all of it speaks in the same
 * voice from the outside. A note is the reader talking to themselves three
 * weeks ago: "6 min from the hotel; fast, which suits an arrival day", a
 * booking marked PAID, a price, a warning about what not to order.
 *
 * So it gets a coral wash and a coral rule rather than the sand the rest of
 * the furniture uses, because coral is this trip's own colour and that is
 * exactly the claim being made. It sits after the facts and before the prose,
 * because it is the brief: it says why this stop is on the day, and the
 * passages under it are the answer to that.
 *
 * It is never edited, reflowed or summarised. Shortening somebody's own note
 * for them is the one unforgivable thing to do to it.
 */
function ownNote(place: Place): string {
  const note = place.note?.trim()
  if (!note) return ''
  const lines = note
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${linkify(escapeHtml(line))}</p>`)
    .join('')
  return `<aside class="own-note"><div class="label">Your note</div>${lines}</aside>`
}

/**
 * A URL pasted into a note, shown as its host.
 *
 * People paste booking links into these and they run to three lines of
 * tracking parameters. The host is what a reader needs — it says which
 * service the booking is with — and the link still goes to the full URL.
 */
function linkify(escaped: string): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    let host: string
    try {
      host = new URL(url.replace(/&amp;/g, '&')).hostname.replace(/^www\./, '')
    } catch {
      return url
    }
    return `<a class="own-link" href="${url}">${escapeHtml(host)}</a>`
  })
}

/**
 * The way there, in the app that knows it.
 *
 * Sits in the corridor head rather than under the prose, because it belongs
 * with the "Walk - A to B" line that names the stretch: the head says which
 * stretch this is, and this says show me. Under the passage it would read as
 * a source, which it is not - nothing in the prose rests on it.
 *
 * `rel="noreferrer"` is not boilerplate. Without it the click tells Google
 * which document the reader came from, and this document is a private
 * itinerary with somebody's hotel in it.
 */
function directions(corridor: Corridor, from: Place, to: Place): string {
  const url = directionsUrl(from, to, corridor.mode)
  if (!url) return ''
  const label = directionsLabel(from, to, corridor.mode) ?? 'Directions in Google Maps'
  return `<a class="directions" href="${escapeHtml(url)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(
    label,
  )}" target="_blank" rel="noreferrer noopener">Directions<span class="arrow" aria-hidden="true">&#8599;</span></a>`
}

/**
 * How far and how long, as the planner already worked it out.
 *
 * Distance always; time only where time is a fact about walking rather than a
 * fact about a timetable. Nine minutes between two stops in the Old Town is
 * arithmetic on a distance and a human pace, and will be true next year. The
 * forty-two minutes from the airport is a bus that runs every twenty minutes
 * on a weekday, read on the day the trip was planned, and a book that prints
 * it as though it were the same kind of number is making a promise it has no
 * way to keep. So a transit corridor gets its distance and keeps quiet about
 * the clock — the link in the same row answers that live.
 */
function cost(leg?: Leg): string {
  const route = leg?.route
  if (!route) return ''
  return `<span class="corridor-cost">${escapeHtml(costText(route))}</span>`
}

/**
 * The corridor head's figures as plain text: "530 m · 6 min", or "15.1 km".
 *
 * Exported because the routine is handed exactly this string in its brief.
 * A passage that says "twenty minutes" under a head that says 25 MIN is the
 * book contradicting itself in adjacent lines, and the only reliable way to
 * stop it is for the writer and the page to read one formatter.
 */
export function costText(route: RouteFact): string {
  const parts = [distanceText(route.metres)]
  if (route.mode !== 'transit') parts.push(`${Math.max(1, Math.round(route.seconds / 60))} min`)
  return parts.join(' \u00B7 ')
}

/**
 * Metric, and rounded to what a walk is actually accurate to.
 *
 * The document's own `text` is rendered for the account that owns the trip,
 * which is imperial here, so a Prague itinerary comes back saying `0.38 mi`
 * about a five-minute walk. The book speaks metres everywhere else and the
 * trip is in Europe; only the raw value is read.
 */
function distanceText(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`
  return `${Math.max(10, Math.round(metres / 10) * 10)} m`
}

function renderCorridor(
  corridor: Corridor,
  from: Place,
  to: Place,
  passages: Numbered[],
  leg?: Leg,
): string {
  if (passages.length === 0) return ''
  const lead = passages[0]?.passage
  const mode = corridor.mode === 'walk' ? 'Walk' : corridor.mode

  return `<section class="corridor" id="corridor-${escapeHtml(corridor.id)}">
<div class="corridor-head">
<span class="label accent">${escapeHtml(lead ? KIND_LABEL[lead.kind] : 'Passing')}</span>
<span class="dot"></span>
<span class="corridor-route">${escapeHtml(mode)} &middot; ${escapeHtml(from.name)} &rarr; ${escapeHtml(to.name)}</span>
${cost(leg)}
${directions(corridor, from, to)}
</div>
<div class="corridor-body">
${passages.map(renderPassage).join('\n')}
</div>
</section>`
}

export interface BookOptions {
  corridors: Corridor[]
  /** Shown under each day. Defaults to the trip title's own city guess. */
  city?: string
}

/**
 * The body of the book. Returns a fragment rather than a document, because the
 * web app has the stylesheet already and the CLI wraps it.
 */
export function renderBook(trip: Trip, guide: Guide, opts: BookOptions): string {
  const city = opts.city ?? trip.title
  const places = new Map(trip.places.map((p) => [p.id, p]))
  const photos = new Map(guide.photos.map((p) => [subjectKey(p.subject), p]))

  // Claims are numbered across the whole book so a footnote index is stable.
  let claimCount = 0
  const numbered = new Map<string, Numbered[]>()
  const footnotes: Array<{ n: number; claim: Passage['claims'][number]; passage: Passage }> = []

  const order: Passage[] = [...guide.passages].sort(
    (a, b) => Number(a.computed ?? false) - Number(b.computed ?? false) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  )
  for (const passage of order) {
    const key = subjectKey(passage.subject)
    const list = numbered.get(key) ?? []
    list.push({ passage, offset: claimCount })
    numbered.set(key, list)
    passage.claims.forEach((claim) => footnotes.push({ n: ++claimCount, claim, passage }))
  }

  const days = byDay(trip)
  const chapters: string[] = []

  for (const [dayIndex, stops] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
    const corridors = opts.corridors.filter((c) => c.dayIndex === dayIndex)
    const parts: string[] = []

    // The day's photograph belongs to the chapter, not to whichever stop
    // happens to be first. Rendered inside the stop it put a picture of Prague
    // under a heading that said "Václav Havel Airport".
    const opener = stops[0]
    const chapterPhoto = opener ? photos.get(`place:${opener.id}`) : undefined

    for (const place of stops) {
      const own = place === opener ? undefined : photos.get(`place:${place.id}`)
      const facts = place.placeId ? guide.facts?.[place.placeId] : undefined
      parts.push(renderPlace(place, numbered.get(`place:${place.id}`) ?? [], own, city, facts))
      const onward = corridors.find((c) => c.fromPlaceId === place.id)
      if (onward) {
        const from = places.get(onward.fromPlaceId)
        const to = places.get(onward.toPlaceId)
        if (from && to) {
          const leg = trip.legs.find((l) => l.id === onward.legId)
          parts.push(renderCorridor(onward, from, to, numbered.get(`corridor:${onward.id}`) ?? [], leg))
        }
      }
    }

    const written = parts.filter(Boolean)
    // A computed light passage rides along; it does not justify a chapter on
    // its own. Day one of a real trip was an airport with a golden-hour note
    // against it and nothing else, which is precisely the padding this design
    // is meant to refuse.
    const researched = [...(numbered.values() as Iterable<Numbered[]>)]
      .flat()
      .filter((n) => !n.passage.computed)
      .some((n) => onThisDay(n.passage.subject, stops, corridors))
    if (written.length === 0 || !researched) continue

    const walked = corridors.filter((c) => c.mode === 'walk').length
    /*
     * The chapter, if somebody wrote one.
     *
     * Its title is the heading and its body is the line under it. Without one
     * both fall back to what they always were — the first and last stop, and
     * a count — which is the honest answer for a day nobody has named yet.
     */
    const chapter = guide.passages.find(
      (p) => p.subject.kind === 'day' && p.subject.id === String(dayIndex) && p.kind === 'chapter',
    )
    chapters.push(`<section class="day">
<div class="day-head">
<div class="label">Day ${escapeHtml(ORDINALS[dayIndex] ?? String(dayIndex))}${
      dateOf(trip, dayIndex) ? ` &middot; ${escapeHtml(dateOf(trip, dayIndex))}` : ''
    }</div>
<div class="label">${escapeHtml(city)}</div>
</div>
<h1>${escapeHtml(chapter?.title.trim() || dayTitle(stops, city))}</h1>
<div class="day-lead">
<p>${
      chapter
        ? paragraphs(chapter.body, [], 0).replace(/<\/?p>/g, '')
        : `${stops.length} stop${stops.length === 1 ? '' : 's'}${walked > 0 ? `, ${walked} of them joined on foot` : ''}.`
    }</p>
${
      stops.length > 1
        ? figures([
            { n: stops.length, one: 'Stop', many: 'Stops' },
            { n: corridors.length, one: 'Corridor', many: 'Corridors' },
          ])
        : ''
    }
</div>
${flightStrip(trip.flights, trip, dayIndex)}
${stayStrip(trip.stays, trip, dayIndex)}
${figure(chapterPhoto, undefined, city)}
${route(stops, corridors, trip.legs)}
${written.join('\n')}
</section>`)
  }

  const checked =
    footnotes.length === 0
      ? ''
      : `<div class="checked">
<div class="label" style="width:150px;flex-shrink:0">Checked</div>
<div class="checked-list">
${footnotes
  .map(
    ({ n, claim, passage }) =>
      `<div id="claim-${n}"><b>${n}</b> &nbsp;${escapeHtml(claim.support ?? claim.text)} &mdash; <a href="${escapeHtml(
        passage.sources[claim.source]?.url ?? '#',
      )}">${escapeHtml(passage.sources[claim.source]?.title ?? 'source')}</a></div>`,
  )
  .join('\n')}
</div>
</div>`

  const writtenCorridors = new Set(
    guide.passages.filter((p) => p.subject.kind === 'corridor').map((p) => p.subject.id),
  ).size
  const front = titlePage(trip, city, {
    days: days.size,
    stops: [...days.values()].reduce((n, stops) => n + stops.length, 0),
    corridors: writtenCorridors,
    claims: footnotes.length,
  })

  return `<div class="wrap">${front}${chapters.join('\n')}${checked}</div>`
}
