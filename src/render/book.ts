import type { Corridor, Guide, Passage, Photo, Place, Subject, Trip } from '../domain/types.ts'
import { minutesOfDay } from '../corridor/legs.ts'

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

function byDay(trip: Trip): Map<number, Place[]> {
  const days = new Map<number, Place[]>()
  for (const place of trip.places) {
    if (place.dayIndex === undefined) continue
    const list = days.get(place.dayIndex) ?? []
    list.push(place)
    days.set(place.dayIndex, list)
  }
  for (const list of days.values()) {
    list.sort((a, b) => (minutesOfDay(a.arrive) ?? 1e9) - (minutesOfDay(b.arrive) ?? 1e9))
  }
  return days
}

function dateOf(trip: Trip, dayIndex: number): string {
  if (!trip.departsOn) return ''
  const at = new Date(new Date(trip.departsOn).getTime() + (dayIndex - 1) * 86_400_000)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(at)
}

const ORDINALS = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN']

/** Everything before the first comma, bracket or dash. */
export function shortName(name: string): string {
  return name.split(/[,(\u2013-]/)[0]?.trim() || name
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
 * The route, drawn as a coral line.
 *
 * The one image that is about *this* trip rather than borrowed, and the only
 * one we can always produce. Coordinates are normalised into the viewBox, so
 * the shape is the day's actual shape rather than decoration.
 */
export function routeSvg(places: Place[], highlight?: number): string {
  const points = places.map((p) => p.coords)
  if (points.length < 2) return ''

  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const spanLat = maxLat - minLat || 1e-6
  const spanLon = maxLon - minLon || 1e-6

  const xy = points.map((p) => ({
    x: 24 + ((p.lon - minLon) / spanLon) * 952,
    // Latitude increases northward and SVG y increases downward.
    y: 20 + (1 - (p.lat - minLat) / spanLat) * 56,
  }))

  const path = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  const dots = xy
    .map(
      (p, i) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${i === highlight ? 5.5 : 6.5}"` +
        (i === highlight ? ' fill="var(--coral)" stroke="var(--coral)"' : '') +
        '></circle>',
    )
    .join('')

  return `<svg viewBox="0 0 1000 96" role="img" aria-label="The day's route, ${places.length} stops">
<path d="${path}" fill="none" stroke="var(--coral)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
<g fill="var(--paper)" stroke="var(--coral)" stroke-width="3">${dots}</g>
</svg>`
}

function figure(photo: Photo | undefined, place: Place | undefined, city: string): string {
  if (!photo) return ''
  // A caption may only claim what can be checked. `atmosphere` means the match
  // was never verified, so the picture is honest about being of the city.
  const caption = photo.claim === 'named' && place ? place.name : city
  const credit = photo.credit
    ? `Photo by <a href="${escapeHtml(photo.credit.link)}?utm_source=cicerone&amp;utm_medium=referral">${escapeHtml(photo.credit.name)}</a> on <a href="https://unsplash.com/?utm_source=cicerone&amp;utm_medium=referral">Unsplash</a>`
    : 'Your own photograph'

  return `<figure>
<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(caption)}" loading="lazy">
<figcaption><span>${escapeHtml(caption)} &middot; ${credit}</span>
<button type="button" class="swap" data-swap="${escapeHtml(subjectKey(photo.subject))}">Swap photo</button></figcaption>
</figure>`
}

const SUN_ICON =
  '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--coral-ink)" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"></circle><path d="M12 2.4v2.6M12 19v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.4 12H5M19 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9"></path></svg>'

const KIND_LABEL: Record<Passage['kind'], string> = {
  origin: 'Origin',
  event: 'What happened here',
  table: 'At the table',
  craft: 'Made here',
  look_for: 'Look for',
  passing: 'Passing',
  prepare: 'Before you board',
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
  origin: 0,
  event: 1,
  craft: 2,
  table: 3,
  passing: 4,
  prepare: 5,
  look_for: 6,
}

interface Numbered {
  passage: Passage
  offset: number
}

function renderPassage({ passage, offset }: Numbered): string {
  const body = paragraphs(passage.body, passage.claims, offset)
  const computed = passage.computed
    ? `<div class="computed">${SUN_ICON}<span>Computed from latitude, longitude and date &mdash; no source needed</span></div>`
    : ''
  return `${body}${computed}`
}

function renderPlace(place: Place, passages: Numbered[], photo: Photo | undefined, city: string): string {
  if (passages.length === 0 && !photo) return ''

  const lead = passages[0]?.passage
  return `<section class="entry" id="place-${escapeHtml(place.id)}">
<div class="entry-side">
<div class="label accent">${escapeHtml(lead ? KIND_LABEL[lead.kind] : 'Stop')}</div>
${place.arrive ? `<div class="entry-when">${escapeHtml(place.arrive)}</div>` : ''}
</div>
<div class="entry-body">
<h2>${escapeHtml(place.name)}</h2>
${passages.map(renderPassage).join('\n')}
${figure(photo, place, city)}
</div>
</section>`
}

function renderCorridor(corridor: Corridor, from: Place, to: Place, passages: Numbered[]): string {
  if (passages.length === 0) return ''
  const lead = passages[0]?.passage
  const mode = corridor.mode === 'walk' ? 'Walk' : corridor.mode

  return `<section class="corridor" id="corridor-${escapeHtml(corridor.id)}">
<div class="corridor-head">
<span class="label accent">${escapeHtml(lead ? KIND_LABEL[lead.kind] : 'Passing')}</span>
<span class="dot"></span>
<span class="corridor-route">${escapeHtml(mode)} &middot; ${escapeHtml(from.name)} &rarr; ${escapeHtml(to.name)}</span>
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

    for (const place of stops) {
      parts.push(renderPlace(place, numbered.get(`place:${place.id}`) ?? [], photos.get(`place:${place.id}`), city))
      const onward = corridors.find((c) => c.fromPlaceId === place.id)
      if (onward) {
        const from = places.get(onward.fromPlaceId)
        const to = places.get(onward.toPlaceId)
        if (from && to) {
          parts.push(renderCorridor(onward, from, to, numbered.get(`corridor:${onward.id}`) ?? []))
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
    chapters.push(`<section class="day">
<div class="day-head">
<div class="label">Day ${escapeHtml(ORDINALS[dayIndex] ?? String(dayIndex))}${
      dateOf(trip, dayIndex) ? ` &middot; ${escapeHtml(dateOf(trip, dayIndex))}` : ''
    }</div>
<div class="label">${escapeHtml(city)}</div>
</div>
<h1>${escapeHtml(dayTitle(stops, city))}</h1>
<div class="day-lead">
<p>${stops.length} stop${stops.length === 1 ? '' : 's'}${walked > 0 ? `, ${walked} of them joined on foot` : ''}.</p>
<div class="figures">
<div><div class="figure-n">${stops.length}</div><div class="figure-l">Stops</div></div>
<div><div class="figure-n">${corridors.length}</div><div class="figure-l">Corridors</div></div>
</div>
</div>
${
      stops.length > 1
        ? `<div class="route">${routeSvg(stops)}
<div class="route-stops">${stops
            .slice(0, 5)
            .map((p) => `<span>${escapeHtml(shortName(p.name))}</span>`)
            .join('')}</div>
</div>`
        : ''
    }
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

  return `<div class="wrap">${chapters.join('\n')}${checked}</div>`
}
