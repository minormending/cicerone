import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Keeping the routine signed in without spending a refresh token per command.
 *
 * Supabase rotates refresh tokens: every `refreshSession` retires the token it
 * was called with and mints another. The first version of this refreshed on
 * every single command, so a run of `check`, `save`, `book` burned three
 * rotations in under a minute, and any one of them failing to write its
 * replacement broke the chain for good. It broke twice in an afternoon.
 *
 * So the access token is saved too. It is valid for about an hour, and while
 * it is, a command uses it directly and touches the refresh chain not at all.
 * That turns five rotations a minute into one an hour, which is few enough
 * that the window for losing one is small — and the failure, when it comes,
 * is now loud instead of silent.
 *
 * It is a credential, so it lives at 0600 in the user's own config directory
 * rather than in the repository: a token in a `.env` gets committed
 * eventually, and this one opens somebody's travel plans.
 */

export const TOKEN_PATH = join(homedir(), '.config', 'cicerone', 'token')

export interface SavedSession {
  refreshToken: string
  accessToken?: string
  /** Seconds since the epoch, as Supabase reports it. */
  expiresAt?: number
}

/** A minute of slack, so a command never starts on a token about to expire. */
const EXPIRY_MARGIN_SECONDS = 60

export function readSession(path = TOKEN_PATH): SavedSession | undefined {
  // The environment wins, so CI and a one-off run can pass a token directly.
  const fromEnv = process.env['SUPABASE_REFRESH_TOKEN']
  if (fromEnv) return { refreshToken: fromEnv }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8').trim()
  } catch {
    return undefined
  }
  if (!raw) return undefined

  // A bare token is what the first version of this wrote, and what somebody
  // pastes by hand. Both keep working.
  if (!raw.startsWith('{')) return { refreshToken: raw }
  try {
    const parsed = JSON.parse(raw) as Partial<SavedSession>
    return typeof parsed.refreshToken === 'string'
      ? {
          refreshToken: parsed.refreshToken,
          ...(parsed.accessToken ? { accessToken: parsed.accessToken } : {}),
          ...(parsed.expiresAt ? { expiresAt: parsed.expiresAt } : {}),
        }
      : undefined
  } catch {
    return undefined
  }
}

/** Is the saved access token still good enough to use as it stands? */
export function stillValid(session: SavedSession | undefined, now = Date.now()): boolean {
  if (!session?.accessToken || !session.expiresAt) return false
  return session.expiresAt - EXPIRY_MARGIN_SECONDS > Math.floor(now / 1000)
}

/**
 * Save the session, and say so if it cannot be saved.
 *
 * The first version swallowed the error on the grounds that a routine which
 * cannot save its token has still done its work. That was wrong: it has also
 * guaranteed the next run fails, with no hint as to why, and losing the chain
 * costs somebody a trip to a browser.
 */
export function writeSession(session: SavedSession, path = TOKEN_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  } catch (err) {
    console.error(
      `Warning: could not save the session to ${path} (${(err as Error).message}).\n` +
        'The next command will need a fresh token from the site.',
    )
  }
}

/** Back-compatible helpers for anything holding only a refresh token. */
export function readToken(path = TOKEN_PATH): string | undefined {
  return readSession(path)?.refreshToken
}

export function writeToken(token: string, path = TOKEN_PATH): void {
  writeSession({ refreshToken: token }, path)
}
