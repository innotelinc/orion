/**
 * Start a sign-in.
 *
 * The desktop itself is public; this is the one door that asks the provider for
 * credentials. orion-api runs the OIDC flow itself, with the state it needs kept
 * on the server, so the round trip does not depend on a cookie of ours
 * surviving a redirect through the provider. The return path is the page the
 * person is on, hash included, so signing in from Files lands back in Files.
 */
export function signIn() {
  const here = `${window.location.pathname}${window.location.hash}`
  window.location.assign(`/auth/start?rd=${encodeURIComponent(here)}`)
}

/**
 * End both sessions.
 *
 * Two exist: ours and the provider's own login. /auth/logout clears this
 * service's cookie and then hands the browser to the provider's end-session
 * flow, because dropping only our cookie would sign the person straight back
 * in — Authentik still remembers them.
 */
export function signOut() {
  window.location.assign(`/auth/logout?rd=${encodeURIComponent('/')}`)
}
