/**
 * What kind of body a body is (issue #95).
 *
 * Committees were distinguished from boards, teams and working groups by their
 * name and nothing else, so no query could ask for "the committees" without
 * pattern-matching a string.
 *
 * Mirrors bodies_body_type_check in
 * supabase/migrations/20260909000000_body_types_and_slack_reminders.sql. The two
 * must agree; if you change one, change the other.
 */
export const BODY_TYPES = [
  'Committee',
  'Board',
  'Advisory Board',
  'Working Group',
  'Team',
  'Other',
] as const

export type BodyType = (typeof BODY_TYPES)[number]

export function isBodyType(v: unknown): v is BodyType {
  return typeof v === 'string' && (BODY_TYPES as readonly string[]).includes(v)
}

/**
 * There is deliberately no body-type gate on the Slack meeting reminders.
 *
 * They were committee-only to begin with (issue #95), which meant a board or a
 * working group that met weekly and had a channel got nothing, and the reason
 * was invisible: Management hid the channel field for those types, so there was
 * nothing to look at and nothing to explain why. Any body that meets can be
 * reminded about its meeting, so the type no longer decides.
 *
 * What gates a reminder now is what always did the real work -- a linked
 * slack_channel_id and slack_reminders_enabled on the body. Both are per body,
 * so a body that wants no reminders simply has no channel linked, or turns them
 * off from its own channel.
 */
