#!/usr/bin/env node
/**
 * The seam between the routine and everything else.
 *
 * The routine is an agent: it researches and it writes, which is the half that
 * needs judgment. Everything deterministic lives here, in code that can be
 * tested and that anybody can run without a model in the loop.
 *
 * That split is what keeps the choice of runner cheap. Today a scheduled
 * Claude Code task on one machine calls these commands; moving to a GitHub
 * Actions cron with the Agent SDK later is a runner swap, because the tools
 * it calls do not change.
 *
 *   cicerone login <token>        save a session from the web app
 *   cicerone pending              trips with no guide, or one gone stale
 *   cicerone trip <id>            the trip graph and its corridors, as JSON
 *   cicerone save <id> <file>     check a guide, then write it
 *   cicerone check <id> [file]    check without writing
 *   cicerone import <key>         fetch a Wanderlog trip and store it
 *   cicerone photos <id>          find and store a photograph per subject
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { checkGuide, substantiatedShare, type CheckResult } from '../src/check.ts'
import { corridorsOf } from '../src/corridor/waking.ts'
import { withLegs } from '../src/corridor/legs.ts'
import { lightPassages } from '../src/light/light.ts'
import { Store } from '../src/backend/store.ts'
import { fetchTrip, tripUrl } from '../src/import/wanderlogApi.ts'
import { tripFromWanderlog } from '../src/import/wanderlog.ts'
import { illustrate } from '../src/photos/illustrate.ts'
import { readToken, TOKEN_PATH, writeToken } from '../src/backend/session.ts'
import type { Coordinates, Corridor, Guide, Passage, TransportMode, Trip } from '../src/domain/types.ts'

const USAGE = `cicerone — the seam between the routine and the database

  cicerone login <token>           save the token from the site, and check it
  cicerone pending                 trips with no guide, or one gone stale
  cicerone trip <id>               the trip graph and its corridors, as JSON
  cicerone save <id> <file.json>   check a guide, then write it
  cicerone check <id> [file.json]  check without writing
  cicerone check --trip <trip.json> <passages.json>   check with no database
  cicerone import <wanderlog-key>  fetch a trip and store it
  cicerone photos <id>             find and store a photograph per subject

Environment:
  SUPABASE_URL, SUPABASE_ANON_KEY   the project
  SUPABASE_REFRESH_TOKEN            overrides the saved session, for CI
  UNSPLASH_ACCESS_KEY               for \`photos\` only
`

function die(message: string, code = 1): never {
  console.error(message)
  process.exit(code)
}

async function connect(): Promise<Store> {
  const url = process.env['SUPABASE_URL']
  const anonKey = process.env['SUPABASE_ANON_KEY']
  const refreshToken = readToken()
  if (!url || !anonKey) die('Set SUPABASE_URL and SUPABASE_ANON_KEY.')
  if (!refreshToken) {
    die(
      `No session. Sign in at the site, press "Copy token for the routine",\n` +
        `then run:  npm run cicerone login <paste>\n\n` +
        `Stored at ${TOKEN_PATH}.`,
    )
  }

  const db = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'cicerone' },
  })
  const { data, error } = await db.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.user) {
    console.error(`Could not sign in: ${error?.message ?? 'no session'}`)
    die('That token has been retired. Copy a fresh one and run `cicerone login`.')
  }

  // The token just used is now spent. Saving its replacement is what keeps the
  // routine signed in without anybody going back to the web app.
  if (data.session?.refresh_token) writeToken(data.session.refresh_token)
  return new Store(db, data.user.id)
}

/** The trip as the routine needs to see it: graph, corridors, what exists. */
function brief(trip: Trip) {
  const withL = withLegs(trip)
  const corridors = corridorsOf(withL)
  const byId = new Map(withL.places.map((p) => [p.id, p]))

  return {
    trip: { id: withL.id, title: withL.title, departsOn: withL.departsOn },
    places: withL.places
      .filter((p) => p.dayIndex !== undefined)
      .map((p) => ({
        id: p.id,
        name: p.name,
        day: p.dayIndex,
        arrive: p.arrive,
        coords: p.coords,
        country: p.countryCode,
        note: p.note,
      })),
    corridors: corridors.map((c) => ({
      id: c.id,
      day: c.dayIndex,
      mode: c.mode,
      view: c.view,
      from: byId.get(c.fromPlaceId)?.name,
      to: byId.get(c.toPlaceId)?.name,
      fromCoords: byId.get(c.fromPlaceId)?.coords,
      toCoords: byId.get(c.toPlaceId)?.coords,
      // `passing` where they can see out; `prepare` where they cannot.
      writable: c.view === 'open' ? ['passing', 'event', 'look_for'] : ['prepare'],
    })),
  }
}

function report(result: CheckResult): void {
  const c = result.coverage
  const share = Math.round(substantiatedShare(c) * 100)
  console.log(
    `${c.passages} passages · ${c.placesWritten}/${c.places} places · ` +
      `${c.corridorsWritten}/${c.corridors} corridors · ${share}% carry a sourced claim`,
  )
  if (c.atmosphere > c.substantiated && c.substantiated + c.atmosphere > 4) {
    console.log(
      `  note: ${c.atmosphere} of ${c.substantiated + c.atmosphere} researched passages are atmosphere.\n` +
        '  A guide made mostly of atmosphere is the failure this design exists to avoid.',
    )
  }
  for (const fault of result.faults) {
    console.error(`  ${fault.rule}  ${fault.passageId}: ${fault.detail}`)
  }
}

/**
 * Whatever shape of trip somebody points `check --trip` at.
 *
 * The obvious file to hand it is the one `cicerone trip` just wrote, which is
 * the brief rather than the graph — so that is what it takes. Anything else
 * would make the documented workflow fail on its first command, which it did:
 * every subject came back unknown because the brief calls the field `day` and
 * carries no legs at all.
 *
 * A raw graph, or a stored row with one inside, still work.
 */
function readTripFile(parsed: unknown): { trip: Trip; corridors: Corridor[] } {
  const asBrief = parsed as {
    trip?: { id?: string; title?: string; departsOn?: string }
    places?: Array<{ id: string; name: string; day?: number; arrive?: string; coords: Coordinates }>
    corridors?: Array<{ id: string; day?: number; mode?: TransportMode; view?: Corridor['view'] }>
  }

  if (Array.isArray(asBrief.corridors) && Array.isArray(asBrief.places)) {
    const trip: Trip = {
      id: asBrief.trip?.id ?? 'trip',
      title: asBrief.trip?.title ?? 'Trip',
      ...(asBrief.trip?.departsOn ? { departsOn: asBrief.trip.departsOn } : {}),
      places: asBrief.places.map((p) => ({
        id: p.id,
        name: p.name,
        coords: p.coords,
        ...(p.day !== undefined ? { dayIndex: p.day } : {}),
        ...(p.arrive ? { arrive: p.arrive } : {}),
      })),
      legs: [],
    }
    // The brief already names its corridors, so they are taken rather than
    // re-derived: the ids the routine was given are the ids it must use.
    const corridors: Corridor[] = asBrief.corridors.map((c) => ({
      id: c.id,
      legId: c.id.replace(/^corridor:/, 'leg:'),
      fromPlaceId: '',
      toPlaceId: '',
      mode: c.mode ?? 'walk',
      view: c.view ?? 'open',
      ...(c.day !== undefined ? { dayIndex: c.day } : {}),
    }))
    return { trip, corridors }
  }

  const graph = ('graph' in (parsed as object) ? (parsed as { graph: Trip }).graph : parsed) as Trip
  if (!Array.isArray(graph?.places)) die('That file is neither a trip brief nor a trip graph.')
  const withL = withLegs(graph)
  return { trip: withL, corridors: corridorsOf(withL) }
}

/** A guide file is the passages the routine wrote; light is added here. */
function readGuide(file: string, trip: Trip, tripId: string): Guide {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    die(`Could not read ${file}: ${(err as Error).message}`)
  }
  const written = Array.isArray(parsed) ? parsed : (parsed as { passages?: Passage[] }).passages
  if (!Array.isArray(written)) die(`${file} should be an array of passages, or {"passages": [...]}.`)

  // Computed light passages are added rather than asked for. The routine has
  // no way to work them out and should not be spending attention trying.
  const researched = written.filter((p) => !p.computed)
  return {
    tripId,
    passages: [...researched, ...lightPassages(trip)],
    photos: [],
    builtAt: new Date().toISOString().slice(0, 10),
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE)
    return
  }

  if (command === 'login') {
    const token = rest[0]
    if (!token) die('cicerone login <token from the site>')
    writeToken(token)
    console.log(`Saved to ${TOKEN_PATH}.`)

    // Proved rather than assumed: a token that does not work should say so now
    // rather than at three in the morning.
    const store = await connect()
    const trips = await store.listTrips()
    console.log(`Signed in. ${trips.length} trip${trips.length === 1 ? '' : 's'} in the account.`)
    return
  }

  if (command === 'pending') {
    const store = await connect()
    const trips = await store.pending()
    if (trips.length === 0) {
      console.log('Nothing pending. Every trip has a guide no older than its import.')
      return
    }
    for (const trip of trips) {
      console.log(`${trip.id}\t${trip.departsOn ?? '????-??-??'}\t${trip.title}`)
    }
    return
  }

  if (command === 'trip') {
    const id = rest[0]
    if (!id) die('cicerone trip <id>')
    const store = await connect()
    const saved = await store.getTrip(id)
    if (!saved) die(`No trip ${id}.`)
    console.log(JSON.stringify(brief(saved.graph), null, 2))
    return
  }

  // Offline check: no database, no session, no network. The routine iterates
  // against this while it writes, and anybody can run it over a pair of files.
  if (command === 'check' && rest[0] === '--trip') {
    const tripFile = rest[1]
    const passageFile = rest[2]
    if (!tripFile || !passageFile) die('cicerone check --trip <trip.json> <passages.json>')

    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(tripFile, 'utf8'))
    } catch (err) {
      die(`Could not read ${tripFile}: ${(err as Error).message}`)
    }

    const { trip, corridors } = readTripFile(parsed)
    const guide = readGuide(passageFile, trip, trip.id)
    const result = checkGuide({ trip, corridors, guide })
    report(result)
    if (!result.ok) die(`\n${result.faults.length} fault(s).`)
    return
  }

  if (command === 'check' || command === 'save') {
    const id = rest[0]
    if (!id) die(`cicerone ${command} <id> <file.json>`)
    const store = await connect()
    const saved = await store.getTrip(id)
    if (!saved) die(`No trip ${id}.`)

    const withL = withLegs(saved.graph)
    const corridors = corridorsOf(withL)
    const file = rest[1]

    const guide = file ? readGuide(file, withL, id) : await store.getGuide(id)
    const result = checkGuide({ trip: withL, corridors, guide })
    report(result)

    if (!result.ok) die(`\n${result.faults.length} fault(s). Nothing was written.`)
    if (command === 'check') return

    await store.savePassages(id, guide.passages)
    console.log(`\nSaved ${guide.passages.length} passages to ${saved.title}.`)
    return
  }

  if (command === 'import') {
    const key = rest[0]
    if (!key) die('cicerone import <wanderlog-key>')
    const store = await connect()

    const fetched = await fetchTrip(key)
    if (!fetched.ok) die(`Could not fetch ${key}: ${fetched.reason}`)

    const { trip, report: imported } = tripFromWanderlog(fetched.document, {})
    const scheduled = imported.places - imported.unscheduled
    if (scheduled === 0) die(`${tripUrl(key)} has no scheduled stops.`)

    const tripId = await store.saveTrip({
      title: trip.title,
      ...(trip.departsOn ? { departsOn: trip.departsOn } : {}),
      source: 'wanderlog',
      sourceKey: key,
      graph: withLegs(trip),
    })
    const corridors = corridorsOf(withLegs(trip))
    console.log(`${tripId}\t${trip.title}`)
    console.log(
      `${scheduled} stops, ${corridors.length} corridors` +
        (imported.unscheduled > 0 ? `, ${imported.unscheduled} places left in standing lists` : ''),
    )
    return
  }

  if (command === 'photos') {
    const id = rest[0]
    if (!id) die('cicerone photos <id>')
    if (!process.env['UNSPLASH_ACCESS_KEY']) die('Set UNSPLASH_ACCESS_KEY.')
    const store = await connect()
    const saved = await store.getTrip(id)
    if (!saved) die(`No trip ${id}.`)

    const found = await illustrate(withLegs(saved.graph), {
      accessKey: process.env['UNSPLASH_ACCESS_KEY'] as string,
      onProgress: (done, total) => process.stderr.write(`\r  ${done}/${total}`),
    })
    process.stderr.write('\r')
    for (const photo of found) await store.savePhoto(id, photo)

    const named = found.filter((p) => p.claim === 'named').length
    console.log(`${found.length} photographs · ${named} can be captioned by name, ${found.length - named} as atmosphere`)
    return
  }

  die(`Unknown command "${command}".\n\n${USAGE}`)
}

await main()
