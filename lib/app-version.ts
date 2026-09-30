/**
 * The version Chambers reports about itself.
 *
 * One source of truth: package.json, inlined as NEXT_PUBLIC_APP_VERSION by
 * next.config.ts at build time. Bumping the version is `npm version`, and the
 * sidebar follows on the next build with nothing else to remember.
 *
 * Printed without a leading "v" -- callers add it -- because that is a display
 * choice and package.json does not carry one.
 *
 * The fallback only shows where the build-time inline did not happen: a test
 * runner or a script importing this module outside `next build`. It is
 * deliberately not a plausible version number, so a real build that somehow
 * lost the inline reads as broken rather than as an old release.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? 'unknown'
