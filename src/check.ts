import { KIND_SUBJECTS, type Corridor, type Guide, type Place, type Trip } from './domain/types.ts'

/**
 * What a guide has to satisfy before it is saved.
 *
 * This is ordinary code on purpose. The research runs in an agent, which is
 * the right place for judgment and the wrong place for a quality bar — a bar
 * enforced by asking nicely is not a bar. Everything here can be run by
 * anybody, over any guide, at any time, with no model in the loop.
 *
 * Two kinds of finding. A `fault` is a rule broken and blocks the save. A
 * `note` is the shape of the guide reported back: how much of it is sourced,
 * where it is thin, what it left out. Notes never block, because "thin" is a
 * legitimate answer for a place there is nothing to say about, and the whole
 * design depends on that staying legitimate.
 */

export interface Fault {
  passageId: string
  rule: string
  detail: string
}

export interface Coverage {
  places: number
  placesWritten: number
  corridors: number
  corridorsWritten: number
  passages: number
  /** Passages carrying at least one sourced claim. */
  substantiated: number
  /** Researched passages with no claims at all: atmosphere. */
  atmosphere: number
}

export interface CheckResult {
  ok: boolean
  faults: Fault[]
  coverage: Coverage
}

/** A specific claim looks like one: a year, a number, a proper noun with a date. */
const SPECIFIC = /\b(1[0-9]{3}|20[0-9]{2})\b|\b\d+(\.\d+)?\s?(km|m|kg|metres|meters|years|centuries)\b/i

export interface CheckInput {
  trip: Trip
  corridors: Corridor[]
  guide: Guide
}

export function checkGuide(input: CheckInput): CheckResult {
  const { trip, corridors, guide } = input
  const faults: Fault[] = []

  const placeIds = new Set(trip.places.filter((p) => p.dayIndex !== undefined).map((p) => p.id))
  const corridorIds = new Set(corridors.map((c) => c.id))
  const seen = new Set<string>()

  for (const passage of guide.passages) {
    const at = (rule: string, detail: string) => faults.push({ passageId: passage.id, rule, detail })

    // The subject exists, and is part of the journey.
    const known = passage.subject.kind === 'place' ? placeIds : corridorIds
    if (!known.has(passage.subject.id)) {
      at('unknown-subject', `no ${passage.subject.kind} "${passage.subject.id}" on this trip`)
    }

    // The kind can attach to that subject.
    if (!KIND_SUBJECTS[passage.kind]?.includes(passage.subject.kind)) {
      at('wrong-subject', `${passage.kind} cannot attach to a ${passage.subject.kind}`)
    }

    // One passage per subject and kind, or the reader gets the same thing twice.
    const key = `${passage.subject.kind}:${passage.subject.id}:${passage.kind}`
    if (seen.has(key)) at('duplicate', `a second ${passage.kind} for this subject`)
    seen.add(key)

    if (!passage.title.trim()) at('no-title', 'a passage needs a title a reader would recognise')
    // A computed passage is one line of fact — "Low warm light 17:32–18:32."
    // — and is meant to be. The floor is for catching stubs of prose.
    if (!passage.computed && passage.body.trim().length < 40) {
      at('too-short', 'a passage is prose, not a field')
    }

    // Every claim points at a source that exists, and quotes the body.
    for (const claim of passage.claims) {
      if (!passage.sources[claim.source]) {
        at('dangling-claim', `claim cites source ${claim.source}, which is not in the list`)
      }
      if (!passage.body.includes(claim.text)) {
        at('claim-not-in-body', `"${truncate(claim.text)}" is not in the passage it belongs to`)
      }
    }

    for (const source of passage.sources) {
      if (!/^https?:\/\//.test(source.url)) at('bad-source', `"${source.url}" is not a URL`)
    }

    // The load-bearing rule. A specific claim without a source is not
    // published: it is rewritten into something general enough to be safe, or
    // it is cut. A computed passage is exempt — nothing was retrieved because
    // nothing needed to be.
    if (!passage.computed) {
      for (const sentence of sentences(passage.body)) {
        if (!SPECIFIC.test(sentence)) continue
        // A claim is a span *within* a sentence, not the whole of it. Reading
        // it the other way round refused "Charles IV laid the first stone in
        // 1344 and did not expect to see it finished" while its claim quoted
        // exactly the half that needed holding up.
        const held = passage.claims.some((claim) => sentence.includes(claim.text.trim()))
        if (!held) at('unsourced-specific', `"${truncate(sentence)}" states a specific with no claim behind it`)
      }
    }

    if (passage.computed && passage.sources.length > 0) {
      at('computed-with-sources', 'a computed passage cites nothing, because nothing was retrieved')
    }
  }

  return { ok: faults.length === 0, faults, coverage: coverageOf(trip, corridors, guide) }
}

function coverageOf(trip: Trip, corridors: Corridor[], guide: Guide): Coverage {
  const researched = guide.passages.filter((p) => !p.computed)
  // Counted from researched passages only. Every place gets a computed light
  // passage, so counting those made a trip with one written stop report 33 of
  // 33 — a coverage number that could never fall below perfect.
  const written = new Set(researched.map((p) => `${p.subject.kind}:${p.subject.id}`))
  const scheduled = trip.places.filter((p: Place) => p.dayIndex !== undefined)

  return {
    places: scheduled.length,
    placesWritten: scheduled.filter((p) => written.has(`place:${p.id}`)).length,
    corridors: corridors.length,
    corridorsWritten: corridors.filter((c) => written.has(`corridor:${c.id}`)).length,
    passages: guide.passages.length,
    substantiated: researched.filter((p) => p.claims.length > 0).length,
    atmosphere: researched.filter((p) => p.claims.length === 0).length,
  }
}

/**
 * Rough sentence split. Good enough to find an unsourced year, which is all it
 * is for; it does not need to survive an abbreviation.
 */
function sentences(body: string): string[] {
  return body
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .filter((s) => s.trim().length > 0)
}

function truncate(text: string, at = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= at ? flat : `${flat.slice(0, at - 1)}…`
}

/** The one number worth watching: how much of the guide is actually held up. */
export function substantiatedShare(coverage: Coverage): number {
  const researched = coverage.substantiated + coverage.atmosphere
  return researched === 0 ? 0 : coverage.substantiated / researched
}
