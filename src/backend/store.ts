import type { SupabaseClient } from '@supabase/supabase-js'
import type { Guide, Passage, Photo, PlaceFacts, Subject, Trip } from '../domain/types.ts'

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
   * in place. `imported_at` moves, which is what tells a guide it is stale.
   */
  async saveTrip(input: {
    title: string
    departsOn?: string
    source: 'wanderlog' | 'polarsteps'
    sourceKey: string
    graph: Trip
  }): Promise<string> {
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
          imported_at: new Date().toISOString(),
        },
        { onConflict: 'owner,source,source_key' },
      )
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
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
