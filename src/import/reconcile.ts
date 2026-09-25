import type { Corridor, Passage, Photo, Place, Subject, Trip } from '../domain/types.ts'
import { withLegs } from '../corridor/legs.ts'
import { corridorsOf } from '../corridor/waking.ts'

/**
 * What a re-import does to a book that already exists.
 *
 * A trip keeps changing after it is imported — the Prague one gained five
 * stops, lost two, and had its third afternoon reordered in the week after
 * its book was finished — and until this existed a re-import simply replaced
 * the graph. Passages hang off subject ids, so any passage whose id no longer
 * existed dropped off the page without a word, and `check` then refused every
 * save until somebody deleted them by hand, which the routine is forbidden to
 * do. So the routine could not update a changed trip, and a person updating it
 * from the site quietly broke the book.
 *
 * Reconciling is three questions per subject. Is it still here — then its
 * passages follow it, under whatever id it has now. Is it gone — then its
 * passages are set aside, never deleted, because somebody may have written
 * them by hand and the stop may come back. Is it new — then it is named, so
 * the routine knows what to write.
 */

export interface Reconciliation {
  /** `kind:oldId` → new id, for every subject that survives. */
  rekey: Map<string, string>
  /** `kind:oldId` for every subject that does not. */
  gone: Set<string>
  /** Subjects in the new trip that had no counterpart in the old one. */
  added: Array<{ subject: Subject; label: string }>
  /** Stops in both whose brief changed — the things a person should reread. */
  edited: Array<{ id: string; name: string; changes: string[] }>
  /** Whether any stop, corridor or day was added or removed. */
  subjectsChanged: boolean
  /**
   * Whether there is anything new to write — and so whether the guide should
   * count as stale. Only additions qualify. A removed stop takes its passages
   * with it and leaves nothing to do; a changed note is worth telling a
   * person about, but it is no reason to send the routine back to a book it
   * is forbidden to rewrite.
   */
  newWork: boolean
}

const key = (subject: Subject) => `${subject.kind}:${subject.id}`

function scheduled(trip: Trip): Place[] {
  return trip.places.filter((p) => p.dayIndex !== undefined)
}

/**
 * Match every stop in the old trip to one in the new, or to nothing.
 *
 * By the source's own id wherever both sides have one, which is every
 * re-import from here on. Graphs saved before stops carried that id are
 * matched the only way left: same day, same name, and the same occurrence of
 * that name on that day, so the hotel's bag-drop and its check-in on one day
 * stay two different stops. That fallback cannot follow a stop that moved to
 * a different day; it sets the old one aside and names the new one as added,
 * which costs a passage its place in the book rather than putting it in the
 * wrong one.
 */
function matchPlaces(before: Place[], after: Place[]): Map<string, string> {
  const out = new Map<string, string>()
  const taken = new Set<string>()

  const bySource = new Map(after.filter((p) => p.sourceId).map((p) => [p.sourceId!, p]))
  for (const old of before) {
    const now = old.sourceId ? bySource.get(old.sourceId) : undefined
    if (now) {
      out.set(old.id, now.id)
      taken.add(now.id)
    }
  }

  const occurrences = (list: Place[]) => {
    const seen = new Map<string, number>()
    return new Map(
      list.map((p) => {
        const base = `${p.dayIndex}|${p.name}`
        const n = (seen.get(base) ?? 0) + 1
        seen.set(base, n)
        return [p.id, `${base}|${n}`]
      }),
    )
  }
  const oldKeys = occurrences(before)
  const newByKey = new Map([...occurrences(after)].map(([id, k]) => [k, id]))
  for (const old of before) {
    if (out.has(old.id) || old.sourceId) continue
    const now = newByKey.get(oldKeys.get(old.id)!)
    if (now && !taken.has(now)) {
      out.set(old.id, now)
      taken.add(now)
    }
  }
  return out
}

function describeEdits(old: Place, now: Place): string[] {
  const changes: string[] = []
  if (old.dayIndex !== now.dayIndex) changes.push(`moved from day ${old.dayIndex} to day ${now.dayIndex}`)
  if ((old.arrive ?? '') !== (now.arrive ?? '')) changes.push(`time ${old.arrive ?? 'none'} → ${now.arrive ?? 'none'}`)
  if ((old.depart ?? '') !== (now.depart ?? '')) changes.push(`leaves ${old.depart ?? 'unset'} → ${now.depart ?? 'unset'}`)
  if ((old.note ?? '').trim() !== (now.note ?? '').trim()) changes.push(old.note ? (now.note ? 'note rewritten' : 'note removed') : 'note added')
  return changes
}

export function reconcile(beforeTrip: Trip, afterTrip: Trip): Reconciliation {
  const before = withLegs(beforeTrip)
  const after = withLegs(afterTrip)
  const oldStops = scheduled(before)
  const newStops = scheduled(after)
  const placeMap = matchPlaces(oldStops, newStops)

  const rekey = new Map<string, string>()
  const gone = new Set<string>()
  for (const p of oldStops) {
    const now = placeMap.get(p.id)
    if (now) rekey.set(`place:${p.id}`, now)
    else gone.add(`place:${p.id}`)
  }

  // A corridor survives when both its ends survive and are still next to each
  // other. A stop inserted between them makes it a different walk, and a
  // passage about the old one is about ground they no longer cross.
  const oldCorridors = corridorsOf(before)
  const newCorridors = corridorsOf(after)
  const newByEnds = new Map(newCorridors.map((c) => [`${c.fromPlaceId}>${c.toPlaceId}`, c]))
  const matchedCorridors = new Set<string>()
  for (const c of oldCorridors) {
    const from = placeMap.get(c.fromPlaceId)
    const to = placeMap.get(c.toPlaceId)
    const now = from && to ? newByEnds.get(`${from}>${to}`) : undefined
    if (now) {
      rekey.set(`corridor:${c.id}`, now.id)
      matchedCorridors.add(now.id)
    } else {
      gone.add(`corridor:${c.id}`)
    }
  }

  /*
   * A chapter is keyed by the day's number, so it stays with the day. That is
   * right for everything short of a day inserted before it, which would
   * leave every later chapter one day early. Nothing has done that yet, and
   * a date-keyed chapter would be the fix when something does.
   */
  const newDays = new Set(newStops.map((p) => String(p.dayIndex)))
  for (const day of new Set(oldStops.map((p) => String(p.dayIndex)))) {
    if (newDays.has(day)) rekey.set(`day:${day}`, day)
    else gone.add(`day:${day}`)
  }

  const names = new Map(newStops.map((p) => [p.id, p.name]))
  const matchedPlaces = new Set(placeMap.values())
  const added: Reconciliation['added'] = [
    ...newStops
      .filter((p) => !matchedPlaces.has(p.id))
      .map((p) => ({ subject: { kind: 'place' as const, id: p.id }, label: `day ${p.dayIndex}: ${p.name}` })),
    ...newCorridors
      .filter((c) => !matchedCorridors.has(c.id))
      .map((c: Corridor) => ({
        subject: { kind: 'corridor' as const, id: c.id },
        label: `day ${c.dayIndex}: ${names.get(c.fromPlaceId)} → ${names.get(c.toPlaceId)}`,
      })),
  ]

  const oldById = new Map(oldStops.map((p) => [p.id, p]))
  const newById = new Map(newStops.map((p) => [p.id, p]))
  const edited: Reconciliation['edited'] = []
  for (const [oldId, newId] of placeMap) {
    const changes = describeEdits(oldById.get(oldId)!, newById.get(newId)!)
    if (changes.length > 0) edited.push({ id: newId, name: newById.get(newId)!.name, changes })
  }

  return { rekey, gone, added, edited, subjectsChanged: added.length > 0 || gone.size > 0, newWork: added.length > 0 }
}

// ---- what to do to the stored book ------------------------------------------

export interface ReimportPlan {
  /** Passage id → the subject id it moves to. */
  rekeyPassages: Array<{ id: string; kind: Subject['kind']; from: string; to: string }>
  /** Written passages whose subject is gone: set aside, never deleted. */
  retire: Passage[]
  /** Computed light passages whose stop is gone. Regenerated on every save, so dropped. */
  dropComputed: string[]
  /** Photos that move with their subject. */
  rekeyPhotos: Array<{ kind: Subject['kind']; from: string; to: string }>
  /** Passages sitting on a stop whose brief changed, for a person to reread. */
  reread: Array<{ passageId: string; stop: string; changes: string[] }>
}

export function planReimport(r: Reconciliation, passages: Passage[], photos: Photo[]): ReimportPlan {
  const plan: ReimportPlan = { rekeyPassages: [], retire: [], dropComputed: [], rekeyPhotos: [], reread: [] }

  for (const p of passages) {
    const k = key(p.subject)
    const to = r.rekey.get(k)
    if (to !== undefined) {
      if (to !== p.subject.id) plan.rekeyPassages.push({ id: p.id, kind: p.subject.kind, from: p.subject.id, to })
      continue
    }
    if (r.gone.has(k)) {
      if (p.computed) plan.dropComputed.push(p.id)
      else plan.retire.push(p)
    }
    // Neither: already under an id the new trip uses — a second run of an
    // import that stopped halfway. Leave it where it is.
  }

  for (const photo of photos) {
    const to = r.rekey.get(key(photo.subject))
    if (to !== undefined && to !== photo.subject.id) {
      plan.rekeyPhotos.push({ kind: photo.subject.kind, from: photo.subject.id, to })
    }
  }

  const edits = new Map(r.edited.map((e) => [e.id, e]))
  for (const p of passages) {
    if (p.computed || p.subject.kind !== 'place') continue
    const now = r.rekey.get(key(p.subject)) ?? p.subject.id
    const edit = edits.get(now)
    if (edit) plan.reread.push({ passageId: p.id, stop: edit.name, changes: edit.changes })
  }
  return plan
}

// ---- has anything changed at all? --------------------------------------------

/**
 * The parts of a trip a guide is written against, reduced to a string.
 *
 * Equal fingerprints mean a daily check can leave the trip alone. Routes are
 * deliberately left out: Wanderlog fills them in lazily and recomputes them,
 * so including them would re-import a trip nobody had touched, bump its date,
 * and send the routine to rewrite a book with nothing new in it.
 *
 * A graph from before stops carried their source id never matches, which is
 * what makes the first daily check after this change move every old trip
 * onto stable ids by itself.
 */
export function fingerprint(trip: Trip): string {
  return canonical({
    title: trip.title,
    departsOn: trip.departsOn ?? null,
    stops: scheduled(trip).map((p) => [p.sourceId ?? `legacy:${p.id}`, p.name, p.dayIndex, p.arrive ?? null, p.depart ?? null, (p.note ?? '').trim()]),
    stays: trip.stays ?? [],
    flights: trip.flights ?? [],
  })
}

/**
 * JSON with every object's keys sorted, so equal values print equally.
 *
 * Needed because the stored side comes back out of a `jsonb` column, and
 * Postgres keeps an object's keys in its own order rather than the order they
 * were written. The first daily check compared plain JSON.stringify output and
 * reported both trips as changed on a morning when nobody had touched either:
 * the stays read back as {name, checkIn, placeId, checkOut}, fresh from the
 * import they were {name, checkIn, checkOut, placeId}.
 */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  )
}
