import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Keeping the routine signed in.
 *
 * Supabase rotates refresh tokens: every `refreshSession` mints a new one and
 * retires the one it was called with. A token pasted into a file is therefore
 * a wasting asset — it works until something refreshes the session, and then
 * the scheduled job fails in the middle of the night with "Invalid Refresh
 * Token". That is exactly how it behaved in the app this replaces, where the
 * answer was to go and copy a fresh one.
 *
 * So the new token is written back after every use and the chain stays alive.
 * Copying one from the web app becomes a one-off rather than a chore.
 *
 * It is a credential, so it lives at 0600 in the user's own config directory
 * rather than in the repository — a token in a `.env` gets committed
 * eventually, and this one is a key to somebody's travel plans.
 */

export const TOKEN_PATH = join(homedir(), '.config', 'cicerone', 'token')

export function readToken(path = TOKEN_PATH): string | undefined {
  // The environment wins, so CI and a one-off run can pass a token directly.
  const fromEnv = process.env['SUPABASE_REFRESH_TOKEN']
  if (fromEnv) return fromEnv
  try {
    const raw = readFileSync(path, 'utf8').trim()
    return raw || undefined
  } catch {
    return undefined
  }
}

export function writeToken(token: string, path = TOKEN_PATH): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${token}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
  } catch {
    // A routine that cannot save its token still ran; it will need a fresh one
    // next time, which is the old behaviour rather than a new failure.
  }
}
