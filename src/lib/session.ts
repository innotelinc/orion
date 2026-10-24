// The provider's issuer, as deploy/sso/docker-compose.yml gives it to
// oauth2-proxy: https://auth.cerulean.innotel.us/application/o/orion/
const AUTH_END_SESSION =
  'https://auth.cerulean.innotel.us/application/o/orion/end-session/'

/**
 * End both sessions.
 *
 * Two exist: the proxy's cookie and the provider's own login. Dropping only the
 * proxy's would sign this browser straight back in, because Authentik still
 * remembers it, so the redirect after /oauth2/sign_out is its end-session flow.
 */
export function signOut() {
  window.location.assign(`/oauth2/sign_out?rd=${encodeURIComponent(AUTH_END_SESSION)}`)
}
