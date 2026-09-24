import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fetchTripInBrowser } from '../web/wanderlog.ts'

/*
 * The page's import, which shipped calling wanderlog.com directly. That works
 * from the CLI and cannot work from a browser — Wanderlog answers 200 with no
 * Access-Control-Allow-Origin and the browser drops it — so these pin the page
 * to the edge function and check its answers are read correctly.
 */

const DOC = readFileSync('test/fixtures/wanderlog-prague.json', 'utf8')

const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json; charset=utf-8' } })

test('the page asks the edge function, with the key and nothing else', async () => {
  const calls: Array<{ name: string; params: Record<string, string> }> = []
  const result = await fetchTripInBrowser('igucwxswyn', async (name, params) => {
    calls.push({ name, params })
    return json(DOC)
  })
  assert.deepEqual(calls, [{ name: 'wanderlog-trip', params: { key: 'igucwxswyn' } }])
  assert.equal(result.ok, true)
})

test("the function's refusal is given in its own words", async () => {
  const result = await fetchTripInBrowser('NOT-A-KEY', async () =>
    json(JSON.stringify({ error: 'That does not look like a Wanderlog trip key.' }), 400),
  )
  assert.deepEqual(result, { ok: false, reason: 'That does not look like a Wanderlog trip key.' })
})

test("Wanderlog's own 200 failure still reads as a missing trip through the proxy", async () => {
  const body = JSON.stringify({ success: false, messages: ['Not found'], errTypes: ['keyNotFound'] })
  const result = await fetchTripInBrowser('abcdef123', async () => json(body))
  assert.deepEqual(result, { ok: false, reason: 'no trip is shared under the key "abcdef123"' })
})

test('a build with no backend says so rather than failing to fetch', async () => {
  const result = await fetchTripInBrowser('igucwxswyn', async () => null)
  assert.equal(result.ok, false)
  assert.match((result as { reason: string }).reason, /no backend configured/)
})
