import type { Corridor, Guide, Passage, Place, Trip } from '../domain/types.ts'
import { minutesOfDay } from '../corridor/legs.ts'
import { escapeHtml, paragraphs } from './book.ts'

/**
 * Where I am now.
 *
 * The same passages, reduced to the one place or corridor they are in. Not a
 * separate content set and not a separate voice — the same words, found by
 * position in the itinerary rather than by page number.
 *
 * Selection is by **time**, not location. The itinerary carries dates and
 * times, so "what am I meant to be looking at" is answerable from the clock
 * plus a manual override, with no location permission, no geofencing and no
 * background services. Real positioning is a later question and probably a
 * native one.
 *
 * The corridor is what makes this surface earn its place. Standing on a
 * platform or sitting on a train is exactly when somebody has attention and
 * nothing to spend it on, and it is the only moment the passing passages are
 * any use at all. A book alone would waste them.
 */

export interface Position {
  /** 1-based day of the trip. */
  dayIndex: number
  /** Minutes since local midnight. */
  minute: number
}

export interface Where {
  kind: 'place' | 'corridor' | 'before' | 'after'
  place?: Place
  corridor?: Corridor
  from?: Place
  to?: Place
  next?: Place
}

/** Which day of a trip a date falls on, or nothing if it falls outside. */
export function dayIndexFor(trip: Trip, at: Date): number | undefined {
  if (!trip.departsOn) return undefined
  const start = Date.parse(`${trip.departsOn}T00:00:00Z`)
  if (Number.isNaN(start)) return undefined
  const days = Math.floor((Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - start) / 86_400_000)
  const last = Math.max(...trip.places.map((p) => p.dayIndex ?? 0))
  return days >= 0 && days < last ? days + 1 : undefined
}

/**
 * Where they are, from the clock.
 *
 * Between two stops is a corridor; at or after a stop and before the next is
 * that place. The bias is deliberate: a traveller who is running late is
 * better served by the corridor they are still in than by a stop they have
 * not reached.
 */
export function whereAt(trip: Trip, corridors: Corridor[], at: Position): Where {
  const stops = trip.places
    .filter((p) => p.dayIndex === at.dayIndex)
    .sort((a, b) => (minutesOfDay(a.arrive) ?? 1e9) - (minutesOfDay(b.arrive) ?? 1e9))

  if (stops.length === 0) return { kind: 'before' }

  const timed = stops.filter((p) => minutesOfDay(p.arrive) !== undefined)
  if (timed.length === 0) return { kind: 'place', place: stops[0] as Place, ...(stops[1] ? { next: stops[1] } : {}) }

  const first = timed[0] as Place
  if (at.minute < (minutesOfDay(first.arrive) as number)) return { kind: 'before', next: first }

  let current = first
  let next: Place | undefined
  for (const stop of timed) {
    const arrive = minutesOfDay(stop.arrive) as number
    if (arrive <= at.minute) current = stop
    else if (!next) next = stop
  }

  if (!next) return { kind: 'after', place: current }

  // Between two stops with a corridor joining them: that is where they are.
  const corridor = corridors.find((c) => c.fromPlaceId === current.id && c.toPlaceId === next?.id)
  const depart = minutesOfDay(current.depart)
  const leaving = depart === undefined || at.minute >= depart

  if (corridor && leaving) {
    return { kind: 'corridor', corridor, from: current, to: next, next }
  }
  return { kind: 'place', place: current, next }
}

function passagesFor(guide: Guide, kind: 'place' | 'corridor', id: string): Passage[] {
  return guide.passages.filter((p) => p.subject.kind === kind && p.subject.id === id)
}

const KIND_LABEL: Record<Passage['kind'], string> = {
  origin: 'Origin',
  event: 'What happened here',
  table: 'At the table',
  craft: 'Made here',
  look_for: 'Look for',
  passing: 'Passing',
  prepare: 'Before you board',
}

/** The fragment for the current position. Empty when there is nothing to say. */
export function renderNow(guide: Guide, where: Where): string {
  if (where.kind === 'before') {
    return `<div class="now-empty"><p class="label">Not started</p>
<p>${where.next ? `First stop: ${escapeHtml(where.next.name)}.` : 'Nothing scheduled today.'}</p></div>`
  }
  if (where.kind === 'after') {
    return `<div class="now-empty"><p class="label">Day done</p>
<p>${where.place ? escapeHtml(where.place.name) : ''} was the last stop. The book has the rest.</p></div>`
  }

  const subject =
    where.kind === 'corridor' && where.corridor
      ? { id: where.corridor.id, kind: 'corridor' as const }
      : { id: (where.place as Place).id, kind: 'place' as const }

  const found = passagesFor(guide, subject.kind, subject.id)
  const heading =
    where.kind === 'corridor'
      ? `${escapeHtml(where.from?.name ?? '')} &rarr; ${escapeHtml(where.to?.name ?? '')}`
      : escapeHtml((where.place as Place).name)

  const lead = found[0]
  const label =
    where.kind === 'corridor'
      ? (where.corridor?.view === 'enclosed' ? 'Before you board' : 'Passing')
      : lead
        ? KIND_LABEL[lead.kind]
        : 'Here'

  const body =
    found.length > 0
      ? found.map((p) => paragraphs(p.body, p.claims, 0)).join('\n')
      : `<p class="now-quiet">Nothing written for this one. Not every stop has a story worth telling, and a guide that pretends otherwise is padding.</p>`

  return `<div class="now-head">
<span class="label accent">${escapeHtml(label)}</span>
${where.kind === 'corridor' && where.corridor ? `<span class="dot"></span><span class="now-mode">${escapeHtml(where.corridor.mode)}</span>` : ''}
</div>
<h1 class="now-title">${heading}</h1>
<div class="now-body">${body}</div>
${where.next ? `<div class="now-next"><span class="label">Next</span><span>${escapeHtml(where.next.name)}</span></div>` : ''}`
}
