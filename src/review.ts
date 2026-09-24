import type { Corridor, Guide, Leg, Passage, Place, Trip } from './domain/types.ts'
import { costText, routeMinutes } from './render/cost.ts'

/**
 * The self-review, as code.
 *
 * The first Prague book passed `check` and was still wrong in ways a reader
 * noticed within a chapter. Three reviews found them: fifteen of twenty-three
 * corridors opening on a distance, a cathedral with fewer words than the
 * supermarket, the first and last days carrying no research, a quarter of all
 * citations on Wikipedia. The skill now tells the writer to repeat those
 * reviews on every draft, and this is that instruction made into something
 * that runs, because a bar enforced by asking nicely is not a bar.
 *
 * Everything here is a note, never a fault, and that is a deliberate line. A
 * fault is a rule broken — an unsourced year, a claim that is not in its own
 * passage — and it can be decided by looking at one passage. These are
 * judgements about a whole book: whether an opening is a formula depends on
 * the six around it, whether a stop is thin depends on what else was written.
 * A corridor inside one square honestly has nothing to cite. So the review
 * reports, the writer decides, and `save` never refuses on its account.
 */

export type ReviewRule =
  | 'opening-distance'
  | 'opening-date'
  | 'opening-repeat'
  | 'thin-famous'
  | 'one-deep'
  | 'claim-free'
  | 'silent'
  | 'bare-ends'
  | 'same-day-echo'
  | 'citation-share'
  | 'figures'

export interface ReviewNote {
  rule: ReviewRule
  /** A passage id, a subject key, or `guide` for something about the whole. */
  subject: string
  detail: string
}

export interface ReviewInput {
  trip: Trip
  corridors: Corridor[]
  guide: Guide
  /**
   * How much has been written about each stop, by place id: the snippet
   * counts from `cicerone sources`. The only fair measure available of how
   * much a reader will expect, and so the only thing that can tell a thin
   * cathedral from a thin bus stop. Without it the two length rules skip.
   */
  snippets?: Map<string, number>
}

/** What each rule is for, printed once above its notes. */
export const RULE_TEXT: Record<ReviewRule, string> = {
  'opening-distance': 'corridors opening on their distance or duration — the heading already prints it',
  'opening-date': 'origins opening on a date — keep the date, find another way in',
  'opening-repeat': 'passages on the same day that open the same way',
  'thin-famous': 'much-written-about stops with less prose than stops almost nobody writes about',
  'one-deep': 'much-written-about stops with a single passage — look for the event',
  'claim-free': 'researched passages with no claim — legitimate for timing advice, otherwise unresearched',
  silent: 'stops, corridors and days with nothing written',
  'bare-ends': 'the first or last day carrying no research, so the book opens or closes on its thinnest page',
  'same-day-echo': 'two passages on one day reaching for the same material',
  'citation-share': 'where the citations point',
  figures: 'corridor figures that disagree with the heading, or transit times the book will not print',
}

export function reviewGuide(input: ReviewInput): ReviewNote[] {
  const { trip, corridors, guide } = input
  const notes: ReviewNote[] = []
  const researched = guide.passages.filter((p) => !p.computed)
  const places = new Map(trip.places.map((p) => [p.id, p]))
  const corridorById = new Map(corridors.map((c) => [c.id, c]))
  const legs = new Map(trip.legs.map((l) => [l.id, l]))
  const dayOf = (p: Passage): number | undefined =>
    p.subject.kind === 'day'
      ? Number(p.subject.id)
      : p.subject.kind === 'place'
        ? places.get(p.subject.id)?.dayIndex
        : corridorById.get(p.subject.id)?.dayIndex

  notes.push(...openings(researched, dayOf))
  if (input.snippets) notes.push(...weight(trip, researched, input.snippets))
  notes.push(...claimFree(researched))
  notes.push(...silences(trip, corridors, researched))
  notes.push(...bareEnds(researched, dayOf))
  notes.push(...echoes(trip, researched, dayOf))
  notes.push(...citations(researched))
  notes.push(...figures(researched, corridorById, legs))
  return notes
}

// ---- openings ------------------------------------------------------------

const NUMBER_WORDS = new Set([
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'dozen', 'half',
  'few', 'couple',
])

/**
 * The first words of a passage with the numbers taken out.
 *
 * "Six hundred metres north-east" and "Seven hundred metres south-east" are
 * the same opening, and the reader hears them as the same opening, so they
 * have to compare equal. Every number becomes `#`, a run of them becomes one,
 * and hyphenated words are split so "five-minute" and "twenty-odd" fall into
 * line with everything else.
 */
export function openingShape(body: string, words = 6): string[] {
  const tokens = body
    .trim()
    .toLowerCase()
    .replace(/[“”"‘’'(),;:.!?…—–]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, words + 4)
    .map((t) => (/^\d+([.,]\d+)?$/.test(t) || NUMBER_WORDS.has(t) ? '#' : t))
    .filter((t) => t !== 'odd' && t !== 'and' && t !== 'or' && t !== 'a' && t !== 'of')
  const collapsed: string[] = []
  for (const t of tokens) if (!(t === '#' && collapsed.at(-1) === '#')) collapsed.push(t)
  return collapsed.slice(0, words)
}

const UNITS = /^(metres?|meters?|m|kilometres?|kilometers?|km|minutes?|mins?|seconds?|blocks?|steps?|paces?|miles?)$/
const HEDGES = new Set(['about', 'some', 'barely', 'just', 'roughly', 'nearly', 'almost', 'only', 'under', 'over'])
const SHORT_WALK = /^this is (barely |just |only |hardly )?(an? |the )?(short(est)? |brief |quick |tiny )?(walk|stroll|hop|ride|crossing)\b/i

function opensOnDistance(body: string): boolean {
  if (SHORT_WALK.test(body.trim())) return true
  const shape = openingShape(body, 4)
  const start = HEDGES.has(shape[0] ?? '') ? 1 : 0
  return shape[start] === '#' && UNITS.test(shape[start + 1] ?? '')
}

function opensOnDate(body: string): boolean {
  const first = sentencesOf(body)[0] ?? ''
  const early = first.split(/\s+/).slice(0, 12).join(' ')
  return /\b(1[0-9]{3}|20[0-2][0-9])\b/.test(early)
}

function openings(passages: Passage[], dayOf: (p: Passage) => number | undefined): ReviewNote[] {
  const out: ReviewNote[] = []
  for (const p of passages) {
    if (p.subject.kind === 'corridor' && opensOnDistance(p.body)) {
      out.push({ rule: 'opening-distance', subject: p.id, detail: `opens "${firstWords(p.body)}"` })
    }
    if (p.kind === 'origin' && opensOnDate(p.body)) {
      out.push({ rule: 'opening-date', subject: p.id, detail: `opens "${firstWords(p.body, 10)}"` })
    }
  }

  // Two words, because that is where a formula lives: "This is…", "# metres…".
  // Three let "This is barely a walk" and "This is the shortest walk" pass
  // as different, and a reader does not hear them as different.
  //
  // A passage already reported for opening on its distance is left out, so
  // four "# minutes" corridors on one day are four notes rather than eight.
  const flagged = new Set(out.filter((n) => n.rule === 'opening-distance').map((n) => n.subject))
  const byDay = new Map<number, Map<string, Passage[]>>()
  for (const p of passages) {
    if (p.kind === 'chapter' || flagged.has(p.id)) continue
    const day = dayOf(p)
    if (day === undefined) continue
    const key = openingShape(p.body, 2).join(' ')
    if (!key) continue
    const shapes = byDay.get(day) ?? new Map<string, Passage[]>()
    shapes.set(key, [...(shapes.get(key) ?? []), p])
    byDay.set(day, shapes)
  }
  for (const [day, shapes] of [...byDay].sort((a, b) => a[0] - b[0])) {
    for (const [, group] of shapes) {
      if (group.length < 2) continue
      // A shared "The" and a different noun is not a formula; a shared "The
      // library hall" twice in a day is. The key is two words, so only an
      // article that matches on its noun as well gets this far.
      out.push({
        rule: 'opening-repeat',
        subject: `day:${day}`,
        detail: group.map((p) => `${p.id} "${firstWords(p.body, 4)}…"`).join(' · '),
      })
    }
  }
  return out
}

// ---- weight: length and depth against how much has been written ----------

function weight(trip: Trip, passages: Passage[], snippets: Map<string, number>): ReviewNote[] {
  const stops = trip.places.filter((p) => p.dayIndex !== undefined)
  const rows = stops.map((place) => {
    const own = passages.filter((p) => p.subject.kind === 'place' && p.subject.id === place.id)
    return {
      place,
      snippets: snippets.get(place.id) ?? 0,
      passages: own.length,
      words: own.reduce((n, p) => n + wordCount(p.body), 0),
    }
  })

  /*
   * Famous means somebody has written a great deal about it: the top quarter
   * of the trip by snippets, and never fewer than twenty, so a trip of eight
   * sparsely covered stops does not promote a bakery to a cathedral.
   */
  const counts = rows.map((r) => r.snippets).filter((n) => n > 0).sort((a, b) => a - b)
  const threshold = Math.max(20, counts[Math.floor(counts.length * 0.75)] ?? Infinity)
  const famous = rows.filter((r) => r.snippets >= threshold)
  const written = rows.filter((r) => r.words > 0).map((r) => r.words).sort((a, b) => a - b)
  const median = written[Math.floor(written.length / 2)] ?? 0

  const out: ReviewNote[] = []
  for (const f of famous) {
    /*
     * The inversion, measured the way it was noticed: a stop with a quarter
     * of the attention or less carrying more prose. On its own that is not a
     * fault — the premise is that nobody writes about the bakery — so it only
     * fires when the famous stop is also below the book's median, which is
     * where Charles Bridge at 99 words was and St Vitus at 131.
     */
    if (f.words < median) {
      const lesser = rows
        .filter((r) => r.snippets <= f.snippets / 4 && r.words > f.words)
        .sort((a, b) => b.words - a.words)[0]
      out.push({
        rule: 'thin-famous',
        subject: `place:${f.place.id}`,
        detail:
          `${f.place.name}: ${f.words} words from ${f.snippets} snippets, below the book's median of ${median}` +
          (lesser ? ` — ${lesser.place.name} has ${lesser.words} from ${lesser.snippets}` : ''),
      })
    }
    if (f.passages === 1) {
      out.push({
        rule: 'one-deep',
        subject: `place:${f.place.id}`,
        detail: `${f.place.name}: one passage from ${f.snippets} snippets`,
      })
    }
  }
  return out
}

// ---- claims, silences, the ends of the book ------------------------------

function claimFree(passages: Passage[]): ReviewNote[] {
  return passages
    .filter((p) => p.kind !== 'chapter' && p.claims.length === 0)
    .map((p) => ({ rule: 'claim-free' as const, subject: p.id, detail: `${wordCount(p.body)} words, no claim` }))
}

function silences(trip: Trip, corridors: Corridor[], passages: Passage[]): ReviewNote[] {
  const written = new Set(passages.map((p) => `${p.subject.kind}:${p.subject.id}`))
  const out: ReviewNote[] = []
  for (const place of trip.places) {
    if (place.dayIndex === undefined || written.has(`place:${place.id}`)) continue
    out.push({ rule: 'silent', subject: `place:${place.id}`, detail: `${place.name}, day ${place.dayIndex}` })
  }
  const names = new Map(trip.places.map((p) => [p.id, p.name]))
  for (const c of corridors) {
    if (written.has(`corridor:${c.id}`)) continue
    const ends = names.get(c.fromPlaceId) && names.get(c.toPlaceId)
      ? `${names.get(c.fromPlaceId)} → ${names.get(c.toPlaceId)}`
      : c.id
    out.push({ rule: 'silent', subject: `corridor:${c.id}`, detail: `${ends}, day ${c.dayIndex ?? '?'}` })
  }
  for (const day of daysOf(trip)) {
    if (written.has(`day:${day}`)) continue
    out.push({ rule: 'silent', subject: `day:${day}`, detail: `day ${day} has no chapter` })
  }
  return out
}

function bareEnds(passages: Passage[], dayOf: (p: Passage) => number | undefined): ReviewNote[] {
  const days = [...new Set(passages.map(dayOf).filter((d): d is number => d !== undefined))].sort((a, b) => a - b)
  if (days.length < 2) return []
  const ends = [days[0]!, days[days.length - 1]!]
  return ends
    .filter((day) => passages.filter((p) => dayOf(p) === day).every((p) => p.claims.length === 0))
    .map((day) => ({
      rule: 'bare-ends' as const,
      subject: `day:${day}`,
      detail: `day ${day} is the ${day === ends[0] ? 'first' : 'last'} chapter and carries no claim`,
    }))
}

// ---- same-day echoes ------------------------------------------------------

const STOPWORDS = new Set(
  (
    'the a an and or but of to in on at by for from with into onto over under as is are was were be been ' +
    'being it its this that these those there here their they them you your yours he she his her we our ' +
    'not no nor so than then too very can could would should will just also only more most much many some ' +
    'any all each every one two which who whom whose what when where why how if because while after before ' +
    'up down out off again once about through between during without within across along around behind ' +
    'has have had do does did has same other such own still even ever yet now'
  ).split(' '),
)

/** Content words with their case kept, because case is what marks a name. */
function contentTokens(text: string): string[] {
  return text
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w.toLowerCase()))
}

function contentWords(text: string): string[] {
  return contentTokens(text).map((w) => w.toLowerCase())
}

/**
 * Runs of three content words, lower-cased — except runs that are entirely
 * capitalised, which are a name ("Place Saint Michel", "National Gallery
 * Prague") and are left out, since two passages near the same square will
 * both name it without either one repeating a thought.
 */
function trigrams(tokens: string[]): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + 2 < tokens.length; i++) {
    const run = [tokens[i]!, tokens[i + 1]!, tokens[i + 2]!]
    if (run.every((w) => /^\p{Lu}/u.test(w))) continue
    out.add(run.map((w) => w.toLowerCase()).join(' '))
  }
  return out
}

/**
 * Two passages on one day saying the same thing.
 *
 * Measured as shared runs of three content words, which is how the real case
 * looked: the tram ride and the evening walk four hours apart both landed on
 * "apartment blocks where people live". Paraphrase escapes it — "standing on
 * them without knowing" and "easy to walk over without seeing" share nothing
 * — so this finds the lazy echo and leaves the subtle one to reading.
 *
 * A trigram made only of words from the day's own stop names is dropped,
 * because two passages about the same square will both say "Old Town
 * Square", and that is a name rather than a thought.
 */
function echoes(trip: Trip, passages: Passage[], dayOf: (p: Passage) => number | undefined): ReviewNote[] {
  const out: ReviewNote[] = []
  for (const day of daysOf(trip)) {
    const names = new Set(
      trip.places.filter((p) => p.dayIndex === day).flatMap((p) => contentWords(p.name)),
    )
    const onDay = passages
      .filter((p) => p.kind !== 'chapter' && dayOf(p) === day)
      .map((p) => ({
        p,
        grams: new Set(
          [...trigrams(contentTokens(p.body))].filter((g) => !g.split(' ').every((w) => names.has(w))),
        ),
      }))
    for (let i = 0; i < onDay.length; i++) {
      for (let j = i + 1; j < onDay.length; j++) {
        const a = onDay[i]!
        const b = onDay[j]!
        const shared = [...a.grams].filter((g) => b.grams.has(g))
        if (shared.length < 2) continue
        out.push({
          rule: 'same-day-echo',
          subject: `day:${day}`,
          detail: `${a.p.id} and ${b.p.id} share ${shared.length} runs of words, e.g. "${shared[0]}"`,
        })
      }
    }
  }
  return out
}

// ---- citations -------------------------------------------------------------

function hostOf(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return /(^|\.)wikipedia\.org$/.test(host) ? 'wikipedia.org' : host
  } catch {
    return undefined
  }
}

function citations(passages: Passage[]): ReviewNote[] {
  const byHost = new Map<string, number>()
  let total = 0
  for (const p of passages) {
    for (const claim of p.claims) {
      const url = p.sources[claim.source]?.url
      const host = url ? hostOf(url) : undefined
      if (!host) continue
      byHost.set(host, (byHost.get(host) ?? 0) + 1)
      total++
    }
  }
  if (total === 0) return []
  const out: ReviewNote[] = []
  const pct = (n: number) => Math.round((n / total) * 100)

  const wikipedia = byHost.get('wikipedia.org') ?? 0
  // Counted by claim rather than by source, because the question is how much
  // of what the book asserts rests on it. A fifth is where it stops being one
  // source among many. The reference book itself sits at a third, and gets
  // this note too.
  if (total >= 10 && wikipedia / total >= 0.2) {
    out.push({
      rule: 'citation-share',
      subject: 'guide',
      detail: `Wikipedia carries ${wikipedia} of ${total} claims (${pct(wikipedia)}%) — move the monuments onto the institutions that own them`,
    })
  }
  // Never a source at all: Wanderlog's own text is generated, and citing it
  // launders a model's sentence through a footnote.
  for (const [host, n] of byHost) {
    if (/(^|\.)wanderlog\.com$/.test(host)) {
      out.push({ rule: 'citation-share', subject: 'guide', detail: `${n} claim(s) cite ${host}, which must never be a source` })
    }
  }
  return out
}

// ---- figures against the heading ------------------------------------------

const UNIT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
}

/** "six hundred" → 600, "twenty-five" → 25, "12" → 12. Undefined for anything else. */
export function parseNumber(text: string): number | undefined {
  const t = text.toLowerCase().trim()
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t)
  let total = 0
  let current = 0
  let seen = false
  for (const word of t.split(/[\s-]+/)) {
    if (word === 'and' || word === 'a') continue
    if (word in UNIT_WORDS) {
      current += UNIT_WORDS[word]!
      seen = true
    } else if (word === 'hundred') {
      current = (current || 1) * 100
      seen = true
    } else if (word === 'thousand') {
      total += (current || 1) * 1000
      current = 0
      seen = true
    } else {
      return undefined
    }
  }
  return seen ? total + current : undefined
}

const NUM = String.raw`(\d+(?:\.\d+)?|(?:(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|and|a)[\s-]?)+)`
const MINUTES = new RegExp(String.raw`\b${NUM}(-odd)?(?:\s(?:or|to)\s${NUM})?[\s-]minutes?\b`, 'gi')
const METRES = new RegExp(String.raw`\b${NUM}[\s-](metres?|meters?|kilometres?|kilometers?|km)\b`, 'gi')

/**
 * What the prose says about distance and time, against what the page prints.
 *
 * Only the first sentence, because that is where a corridor says how far it
 * is going. It was the first paragraph until a Paris corridor's opening
 * paragraph explained that the tax farmers wanted a 24-kilometre wall round
 * the city, which is a fact about the eighteenth century rather than about
 * tonight's metro. Everything after the first sentence is about the world.
 */
function figures(
  passages: Passage[],
  corridors: Map<string, Corridor>,
  legs: Map<string, Leg>,
): ReviewNote[] {
  const out: ReviewNote[] = []
  for (const p of passages) {
    if (p.subject.kind !== 'corridor') continue
    const corridor = corridors.get(p.subject.id)
    const route = corridor ? legs.get(corridor.legId)?.route : undefined
    if (!route) continue
    const lead = sentencesOf(p.body)[0] ?? ''

    for (const m of lead.matchAll(MINUTES)) {
      if (route.mode === 'transit') {
        out.push({ rule: 'figures', subject: p.id, detail: `"${m[0]}" on a transit corridor, where the book prints no time` })
        continue
      }
      const shown = routeMinutes(route)
      const low = parseNumber(m[1] ?? '')
      if (low === undefined) continue
      const high = m[3] ? parseNumber(m[3]) ?? low : m[2] ? low + 9 : low
      // Two minutes or a tenth, whichever is more: "ten minutes" for a nine-
      // minute walk is how people talk, and "twenty minutes" under a heading
      // that prints 25 is the book contradicting itself — the skill's own
      // example, which a fifth's tolerance let through.
      const tolerance = Math.max(2, shown * 0.1)
      if (shown < low - tolerance || shown > high + tolerance) {
        out.push({ rule: 'figures', subject: p.id, detail: `says "${m[0]}", the heading prints ${costText(route)}` })
      }
    }

    for (const m of lead.matchAll(METRES)) {
      const value = parseNumber(m[1] ?? '')
      if (value === undefined) continue
      const metres = /^k/i.test(m[2] ?? '') ? value * 1000 : value
      // Wider than time, because until this week the prose was told to give
      // the straight-line distance, which runs a fifth to a third short of
      // the walked one. A third is where "about" stops covering it.
      if (Math.abs(metres - route.metres) / route.metres > 0.33) {
        out.push({ rule: 'figures', subject: p.id, detail: `says "${m[0]}", the heading prints ${costText(route)}` })
      }
    }
  }
  return out
}

// ---- small things ---------------------------------------------------------

function daysOf(trip: Trip): number[] {
  return [...new Set(trip.places.map((p: Place) => p.dayIndex).filter((d): d is number => d !== undefined))].sort(
    (a, b) => a - b,
  )
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function firstWords(text: string, n = 6): string {
  return text.trim().split(/\s+/).slice(0, n).join(' ')
}

function sentencesOf(body: string): string[] {
  return body
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z“"'])/)
    .filter((s) => s.trim().length > 0)
}
