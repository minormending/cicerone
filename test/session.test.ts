import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSession, stillValid, writeSession } from '../src/backend/session.ts'

const scratch = (): string => join(mkdtempSync(join(tmpdir(), 'cicerone-')), 'token')

test('a session round-trips', () => {
  const path = scratch()
  writeSession({ refreshToken: 'r1', accessToken: 'a1', expiresAt: 1_800_000_000 }, path)
  assert.deepEqual(readSession(path), { refreshToken: 'r1', accessToken: 'a1', expiresAt: 1_800_000_000 })
})

test('a bare token still works', () => {
  // What the first version wrote, and what somebody pastes by hand.
  const path = scratch()
  writeFileSync(path, 'just-a-refresh-token\n')
  assert.deepEqual(readSession(path), { refreshToken: 'just-a-refresh-token' })
})

test('a valid access token means the refresh chain is left alone', () => {
  // Every refresh retires a token, and every retired token is a chance to
  // lose the chain. It broke twice in one afternoon at one refresh per
  // command; this is what turns that into one an hour.
  const now = 1_800_000_000_000
  const soon = Math.floor(now / 1000) + 600
  assert.equal(stillValid({ refreshToken: 'r', accessToken: 'a', expiresAt: soon }, now), true)
})

test('an access token about to expire is not used', () => {
  const now = 1_800_000_000_000
  const edge = Math.floor(now / 1000) + 30
  assert.equal(stillValid({ refreshToken: 'r', accessToken: 'a', expiresAt: edge }, now), false)
  assert.equal(stillValid({ refreshToken: 'r' }, now), false)
  assert.equal(stillValid(undefined, now), false)
})

test('the file is written 0600, because it opens somebody travel plans', () => {
  const path = scratch()
  writeSession({ refreshToken: 'r' }, path)
  assert.ok(readFileSync(path, 'utf8').includes('r'))
})

test('nonsense on disk reads as no session rather than throwing', () => {
  const path = scratch()
  writeFileSync(path, '{ not json\n')
  assert.equal(readSession(path), undefined)
})
