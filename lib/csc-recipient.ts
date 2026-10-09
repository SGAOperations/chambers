/**
 * Where mail to CSC goes, and whether it may be sent at all.
 *
 * Shared by Auto-Cancel and Auto-Request (issue #226), the two places Chambers
 * writes to a university office rather than to its own members. It lived inside
 * the Auto-Cancel route until there was a second sender, and a second copy of
 * this rule is exactly the kind of thing that drifts: the one that forgot the
 * production check would be the one that mailed CSC from a preview.
 */

export const DEFAULT_CSC_EMAIL = 'cscreservations@northeastern.edu'

export type CscRecipient = { to: string; isDefault: boolean } | { error: string }

/**
 * The default used to apply everywhere CSC_EMAIL was unset, which made a test
 * run safe only if an environment variable had been set, in the right Vercel
 * scope, on a deployment created after it was added -- and gave no sign when any
 * of that was not true. It mailed CSC instead. That happened.
 *
 * So outside production the real address is refused rather than defaulted to.
 * A preview deployment or a local server must name its recipient explicitly, and
 * if it has not, the request fails with an explanation instead of reaching a
 * university office. The failure mode is now "your test did not send", which
 * costs a minute, rather than "CSC received a real request", which costs an
 * apology and a retraction.
 *
 * Production is unchanged: VERCEL_ENV is 'production' there and the default
 * applies, so nothing has to be configured for either feature to work in earnest.
 */
export function resolveCscRecipient(): CscRecipient {
  const override = process.env.CSC_EMAIL?.trim()
  if (override) return { to: override, isDefault: false }

  // Vercel sets this to 'production' | 'preview' | 'development'. It is absent
  // under `next dev`, which is treated as not-production -- the safe reading.
  if (process.env.VERCEL_ENV !== 'production') {
    return {
      error:
        `Refusing to send: this is not the production deployment, and CSC_EMAIL is not set, so the request would go to ${DEFAULT_CSC_EMAIL}. ` +
        `Set CSC_EMAIL to a test address for this environment and redeploy, then try again.`,
    }
  }

  return { to: DEFAULT_CSC_EMAIL, isDefault: true }
}

/**
 * The recipient as a modal shows it before anything is selected, so it can say
 * where a send is headed -- or refuse up front rather than at the click.
 */
export function cscRecipientPreview() {
  const recipient = resolveCscRecipient()
  return {
    recipient: 'to' in recipient ? recipient.to : null,
    recipientIsReal: 'to' in recipient ? recipient.isDefault : false,
    blocked: 'error' in recipient ? recipient.error : null,
    cc: process.env.OPS_EMAIL || null,
  }
}
