import type { SupabaseClient } from '@supabase/supabase-js'
import type { Guide, Passage, Photo, PlaceFacts, Subject, Trip } from '../domain/types.ts'
import { planReimport, reconcile, type ReimportPlan, type Reconciliation } from '../import/reconcile.ts'

/**
 * Reading and writing trips and guides.
 *
 * Deliberately thin. Every method is one query and no method decides anything:
 * what to write is settled before it gets here, by `check`. A store that
 * validates is a store two callers disagree with.
 */

export interface SavedTrip {
  id: string
  title: string
  departsOn?: string
  source: 'wanderlog' | 'polarsteps'
  sourceKey: string
  graph: Trip
  importedAt: string
  updatedAt: string
}

interface TripRow {
  id: string
  title: string
  departs_on: string | null
  source: 'wanderlog' | 'polarsteps'
  source_key: string
  graph: Trip
  imported_at: string
  updated_at: string
}

interface PassageRow {
  id: string
  trip_id: string
  subject_kind: Subject['kind']
  subject_id: string
  kind: Passage['kind']
  title: string
  body: string
  claims: Passage['claims']
  sources: Passage['sources']
  computed: boolean
  written_at: string
}

interface PhotoRow {
  trip_id: string
  subject_kind: Subject['kind']
  subject_id: string
  unsplash_id: string | null
  url: string
  credit_name: string | null
  credit_link: string | null
  claim: Photo['claim']
  chosen_by: Photo['chosenBy']
}

function toTrip(row: TripRow): SavedTrip {
  return {
    id: row.id,
    title: row.title,
    ...(row.departs_on ? { departsOn: row.departs_on } : {}),
    source: row.source,
    sourceKey: row.source_key,
    graph: row.graph,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  }
}

function toPassage(row: PassageRow): Passage {
  return {
    id: row.id,
    subject: { kind: row.subject_kind, id: row.subject_id },
    kind: row.kind,
    title: row.title,
    body: row.body,
    claims: row.claims ?? [],
    sources: row.sources ?? [],
    writtenAt: row.written_at,
    ...(row.computed ? { computed: true } : {}),
  }
}

function toPhoto(row: PhotoRow): Photo {
  return {
    subject: { kind: row.subject_kind, id: row.subject_id },
    ...(row.unsplash_id ? { unsplashId: row.unsplash_id } : {}),
    url: row.url,
    ...(row.credit_name && row.credit_link
      ? { credit: { name: row.credit_name, link: row.credit_link } }
      : {}),
    claim: row.claim,
    chosenBy: row.chosen_by,
  }
}

/**
 * Any client pointed at this app's schema. Typed loosely on purpose: the
 * schema generic differs between a browser client built with `db.schema` and
 * one the CLI makes, and pinning it here would make the two incompatible for
 * no benefit — the queries are identical and the row shapes are declared above.
 */
export type CiceroneClient = SupabaseClient<any, 'public', string, any, any>

export interface TripInput {
  title: string
  departsOn?: string
  source: 'wanderlog' | 'polarsteps'
  sourceKey: string
  graph: Trip
}

export type ImportResult =
  | { id: string; created: true }
  | { id: string; created: false; reconciliation: Reconciliation; plan: ReimportPlan }

export class Store {
  readonly #db: CiceroneClient
  readonly #owner: string

  constructor(db: CiceroneClient, owner: string) {
    this.#db = db
    this.#owner = owner
  }

  async listTrips(): Promise<SavedTrip[]> {
    const { data, error } = await this.#db
      .from('trips')
      .select('id,title,departs_on,source,source_key,graph,imported_at,updated_at')
      .order('updated_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data as TripRow[]).map(toTrip)
  }

  async getTrip(id: string): Promise<SavedTrip | null> {
    const { data, error } = await this.#db
      .from('trips')
      .select('id,title,departs_on,source,source_key,graph,imported_at,updated_at')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toTrip(data as TripRow) : null
  }

  /**
   * Upsert on (owner, source, source_key), so re-importing a trip updates it
   * in place.
   *
   * `stale` decides whether `imported_at` moves, and `imported_at` is what
   * `pending` compares the guide against — so it means "there is something
   * new to write", not "the document was fetched". A re-import that only
   * changed notes updates the graph and leaves the guide current.
   *
   * Not for re-importing a trip that has a guide: that goes through
   * `importTrip`, which keeps the passages attached to the stops they are
   * about. Calling this directly on such a trip is how a book loses its pages.
   */
  async saveTrip(input: TripInput & { stale?: boolean }): Promise<string> {
    const { data, error } = await this.#db
      .from('trips')
      .upsert(
        {
          owner: this.#owner,
          title: input.title,
          departs_on: input.departsOn ?? null,
          source: input.source,
          source_key: input.sourceKey,
          graph: input.graph,
          ...(input.stale === false ? {} : { imported_at: new Date().toISOString() }),
        },
        { onConflict: 'owner,source,source_key' },
      )
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }

  /** The trip already imported from this source key, if there is one. */
  async findTrip(source: TripInput['source'], sourceKey: string): Promise<SavedTrip | null> {
    const { data, error } = await this.#db
      .from('trips')
      .select('id,title,departs_on,source,source_key,graph,imported_at,updated_at')
      .eq('source', source)
      .eq('source_key', sourceKey)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? toTrip(data as TripRow) : null
  }

  /**
   * Import a trip, keeping an existing book attached to it.
   *
   * The only way a trip should enter the database, from the site and the CLI
   * alike. A first import is a plain save. A re-import is reconciled: the
   * passages and photos of every stop and corridor that survived follow it to
   * its current id, the written passages of those that left are set aside in
   * `retired_passages`, and the graph is saved last.
   *
   * The order is for the run that dies halfway. Everything before the graph
   * is saved is computed from the old graph, and a passage already moved to a
   * new id is neither in the old graph's keep list nor its gone list, so a
   * second run leaves it alone and finishes the rest.
   */
  async importTrip(input: TripInput): Promise<ImportResult> {
    const existing = await this.findTrip(input.source, input.sourceKey)
    if (!existing) return { id: await this.saveTrip(input), created: true }

    const reconciliation = reconcile(existing.graph, input.graph)
    const guide = await this.getGuide(existing.id)
    const plan = planReimport(reconciliation, guide.passages, guide.photos)
    const tripId = existing.id

    if (plan.retire.length > 0) {
      const names = new Map(existing.graph.places.map((p) => [p.id, p]))
      const reason = (p: Passage) => {
        if (p.subject.kind === 'place') {
          const stop = names.get(p.subject.id)
          return `day ${stop?.dayIndex ?? '?'}: ${stop?.name ?? p.subject.id} left the trip`
        }
        return p.subject.kind === 'day' ? `day ${p.subject.id} left the trip` : 'this stretch is no longer walked'
      }
      const set = await this.#db.from('retired_passages').upsert(
        plan.retire.map((p) => ({
          trip_id: tripId,
          id: p.id,
          subject_kind: p.subject.kind,
          subject_id: p.subject.id,
          kind: p.kind,
          title: p.title,
          body: p.body,
          claims: p.claims,
          sources: p.sources,
          written_at: p.writtenAt,
          reason: reason(p),
        })),
        { onConflict: 'trip_id,id' },
      )
      if (set.error) throw new Error(`setting passages aside: ${set.error.message}`)
    }

    const drop = [...plan.retire.map((p) => p.id), ...plan.dropComputed]
    if (drop.length > 0) {
      const gone = await this.#db.from('passages').delete().eq('trip_id', tripId).in('id', drop)
      if (gone.error) throw new Error(`removing set-aside passages: ${gone.error.message}`)
    }

    if (plan.rekeyPassages.length > 0) {
      const moves = new Map(plan.rekeyPassages.map((m) => [m.id, m.to]))
      const moved = await this.#db.from('passages').upsert(
        guide.passages
          .filter((p) => moves.has(p.id))
          .map((p) => ({
            id: p.id,
            trip_id: tripId,
            subject_kind: p.subject.kind,
            subject_id: moves.get(p.id),
            kind: p.kind,
            title: p.title,
            body: p.body,
            claims: p.claims,
            sources: p.sources,
            computed: p.computed ?? false,
            written_at: p.writtenAt,
          })),
        { onConflict: 'id' },
      )
      if (moved.error) throw new Error(`moving passages to their stops' new ids: ${moved.error.message}`)
    }

    for (const move of plan.rekeyPhotos) {
      const moved = await this.#db
        .from('photos')
        .update({ subject_id: move.to })
        .eq('trip_id', tripId)
        .eq('subject_kind', move.kind)
        .eq('subject_id', move.from)
      if (moved.error) throw new Error(`moving a photo to its stop's new id: ${moved.error.message}`)
    }

    await this.saveTrip({ ...input, stale: reconciliation.newWork })
    return { id: tripId, created: false, reconciliation, plan }
  }

  /** What has been set aside for a trip, newest first. */
  async retiredPassages(tripId: string): Promise<Array<Passage & { reason: string; retiredAt: string }>> {
    const { data, error } = await this.#db
      .from('retired_passages')
      .select('id,subject_kind,subject_id,kind,title,body,claims,sources,written_at,retired_at,reason')
      .eq('trip_id', tripId)
      .order('retired_at', { ascending: false })
    if (error) throw new Error(error.message)
    return (data as Array<PassageRow & { retired_at: string; reason: string }>).map((r) => ({
      ...toPassage({ ...r, trip_id: tripId, computed: false }),
      reason: r.reason,
      retiredAt: r.retired_at,
    }))
  }

  async getGuide(tripId: string): Promise<Guide> {
    const [passages, photos] = await Promise.all([
      this.#db
        .from('passages')
        .select('id,trip_id,subject_kind,subject_id,kind,title,body,claims,sources,computed,written_at')
        .eq('trip_id', tripId),
      this.#db
        .from('photos')
        .select('trip_id,subject_kind,subject_id,unsplash_id,url,credit_name,credit_link,claim,chosen_by')
        .eq('trip_id', tripId),
    ])
    if (passages.error) throw new Error(passages.error.message)
    if (photos.error) throw new Error(photos.error.message)

    const rows = passages.data as PassageRow[]
    return {
      tripId,
      passages: rows.map(toPassage),
      photos: (photos.data as PhotoRow[]).map(toPhoto),
      builtAt: rows.map((r) => r.written_at).sort().pop() ?? '',
    }
  }

  /**
   * Replace the passages for a trip.
   *
   * A whole-trip replace rather than a merge, because the routine writes a
   * whole trip and a half-written guide is worse than an old one. Photos are
   * left alone: a person's chosen picture survives every rebuild, which is
   * the promise the swap control makes.
   */
  async savePassages(tripId: string, passages: Passage[]): Promise<void> {
    const wipe = await this.#db.from('passages').delete().eq('trip_id', tripId)
    if (wipe.error) throw new Error(wipe.error.message)
    if (passages.length === 0) return

    const { error } = await this.#db.from('passages').insert(
      passages.map((p) => ({
        id: p.id,
        trip_id: tripId,
        subject_kind: p.subject.kind,
        subject_id: p.subject.id,
        kind: p.kind,
        title: p.title,
        body: p.body,
        claims: p.claims,
        sources: p.sources,
        computed: p.computed ?? false,
        written_at: p.writtenAt,
      })),
    )
    if (error) throw new Error(error.message)
  }

  /** What the import knows about the places on a trip, by Google place id. */
  async getFacts(placeIds: string[]): Promise<Record<string, PlaceFacts>> {
    if (placeIds.length === 0) return {}
    const { data, error } = await this.#db
      .from('place_facts')
      .select('place_id,name,hours,rating,rating_count,website,dishes')
      .in('place_id', [...new Set(placeIds)])
    if (error) throw new Error(error.message)

    const out: Record<string, PlaceFacts> = {}
    for (const row of data as Array<Record<string, unknown>>) {
      const id = row['place_id'] as string
      out[id] = {
        placeId: id,
        ...(Array.isArray(row['hours']) ? { hours: row['hours'] as string[] } : {}),
        ...(row['rating'] !== null ? { rating: Number(row['rating']) } : {}),
        ...(row['rating_count'] !== null ? { ratingCount: row['rating_count'] as number } : {}),
        ...(row['website'] ? { website: row['website'] as string } : {}),
        ...(Array.isArray(row['dishes'])
          ? { dishes: row['dishes'] as NonNullable<PlaceFacts['dishes']> }
          : {}),
      }
    }
    return out
  }

  /** Facts are about the real place, so they are keyed on it and shared. */
  async saveFacts(facts: Array<PlaceFacts & { name: string }>): Promise<void> {
    if (facts.length === 0) return
    const { error } = await this.#db.from('place_facts').upsert(
      facts.map((f) => ({
        place_id: f.placeId,
        name: f.name,
        hours: f.hours ?? null,
        rating: f.rating ?? null,
        rating_count: f.ratingCount ?? null,
        website: f.website ?? null,
        dishes: f.dishes ?? [],
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'place_id' },
    )
    if (error) throw new Error(error.message)
  }

  /** One photograph per subject; a swap replaces rather than accumulates. */
  async savePhoto(tripId: string, photo: Photo): Promise<void> {
    const { error } = await this.#db.from('photos').upsert(
      {
        trip_id: tripId,
        subject_kind: photo.subject.kind,
        subject_id: photo.subject.id,
        unsplash_id: photo.unsplashId ?? null,
        url: photo.url,
        credit_name: photo.credit?.name ?? null,
        credit_link: photo.credit?.link ?? null,
        claim: photo.claim,
        chosen_by: photo.chosenBy,
      },
      { onConflict: 'trip_id,subject_kind,subject_id' },
    )
    if (error) throw new Error(error.message)
  }

  /** Trips with no guide, or one written before the document last changed. */
  async pending(): Promise<SavedTrip[]> {
    const trips = await this.listTrips()
    const out: SavedTrip[] = []
    for (const trip of trips) {
      const { data, error } = await this.#db
        .from('passages')
        .select('written_at')
        .eq('trip_id', trip.id)
        .order('written_at', { ascending: false })
        .limit(1)
      if (error) throw new Error(error.message)

      const rows = data as Array<{ written_at: string }>
      const latest = rows[0]?.written_at
      // Date rather than timestamp: a guide written the same day the trip was
      // imported is current. Re-running within the day is the routine's job to
      // avoid, not the store's to police.
      if (!latest || latest < trip.importedAt.slice(0, 10)) out.push(trip)
    }
    return out
  }
}
