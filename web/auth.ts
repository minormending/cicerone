import type { User } from '@supabase/supabase-js'
import { backendConfigured, currentUser, signInWithGoogle, signOut, supabase } from '../src/backend/client.ts'

/**
 * Signing in, and why.
 *
 * There is no signed-out mode here, unlike the app this replaces. A guide
 * lives in the account that owns the trip and nowhere else, because a trip
 * document holds confirmation codes, flight numbers and where somebody sleeps.
 * That is the whole reason for accounts, and the panel says so rather than
 * asking people to guess.
 */

function button(label: string, primary = false): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = label
  if (primary) element.className = 'primary'
  return element
}

function note(text: string, bad = false): HTMLParagraphElement {
  const element = document.createElement('p')
  element.className = bad ? 'auth-note bad' : 'auth-note'
  element.textContent = text
  return element
}

export interface AuthView {
  user: User | null
  refresh(): Promise<void>
}

export function mountAuth(host: HTMLElement, onChange: (user: User | null) => void): AuthView {
  const view: AuthView = { user: null, refresh: async () => {} }

  if (!backendConfigured()) {
    host.hidden = false
    host.append(
      note(
        'This build has no backend configured, so it cannot open a guide. Unlike the app this replaces there is no local-only mode: a guide lives in the account that owns the trip.',
        true,
      ),
    )
    return view
  }

  /**
   * Renders are sequenced by generation. supabase fires onAuthStateChange with
   * the initial session as soon as it is subscribed, which races the first
   * render: both clear the host, both await, and both append.
   */
  let generation = 0

  async function render(): Promise<void> {
    const mine = ++generation
    const user = await currentUser()
    if (mine !== generation) return

    host.replaceChildren()
    host.hidden = false
    view.user = user

    if (!user) {
      host.append(
        note(
          'Your trips hold confirmation codes, flight numbers and where you sleep. Signing in is how they stay yours and nobody else’s.',
        ),
      )
      const go = button('Continue with Google', true)
      go.addEventListener('click', () => {
        go.disabled = true
        const back = location.href.split('#')[0] ?? location.href
        void signInWithGoogle(back).then(({ error }) => {
          if (!error) return
          go.disabled = false
          host.append(note(error, true))
        })
      })
      host.append(go)
      onChange(null)
      return
    }

    const who = document.createElement('span')
    who.textContent = `Signed in as ${user.email ?? 'you'}`

    const token = button('Copy token for the routine')
    token.addEventListener('click', () => void copyToken(token))

    const out = button('Sign out')
    out.addEventListener('click', () => {
      void signOut().then(() => render())
    })

    host.append(who, token, out)
    onChange(user)
  }

  /**
   * The refresh token, for the routine that writes the guides.
   *
   * It is the user's own credential going into the user's own machine, and it
   * is shown only on a deliberate click rather than sitting in the bar.
   *
   * Refresh tokens rotate: every use mints a new one and retires the old. In
   * the app this replaced that made a copied token a wasting asset — it worked
   * until something else refreshed the session, and then the scheduled job
   * failed at three in the morning with "Invalid Refresh Token". The CLI here
   * writes each new token back to ~/.config/cicerone/token, so the chain stays
   * alive and this button is a one-off rather than a chore.
   */
  async function copyToken(trigger: HTMLButtonElement): Promise<void> {
    const db = supabase()
    if (!db) return
    const { data } = await db.auth.getSession()
    const refresh = data.session?.refresh_token
    if (!refresh) {
      trigger.textContent = 'No active session'
      return
    }
    try {
      await navigator.clipboard.writeText(refresh)
      trigger.textContent = 'Copied \u2014 run: cicerone login'
    } catch {
      // Clipboard is blocked in some contexts, and the token is still needed.
      trigger.textContent = 'Could not copy \u2014 see the console'
      console.log(refresh)
    }
    setTimeout(() => (trigger.textContent = 'Copy token for the routine'), 6000)
  }

  view.refresh = render
  void render()
  supabase()?.auth.onAuthStateChange(() => void render())
  return view
}
