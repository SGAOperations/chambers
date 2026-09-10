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
 * The types the Slack bot posts weekly meeting reminders for.
 *
 * Only committees today, which is what the issue asks for. Kept as a set rather
 * than an equality check so widening it later -- to working groups, say -- is a
 * one-line change here and not a hunt through the reminder job.
 */
export const SLACK_REMINDER_BODY_TYPES: readonly BodyType[] = ['Committee']

export function bodyTypeGetsSlackReminders(bodyType: string | null | undefined): boolean {
  return !!bodyType && (SLACK_REMINDER_BODY_TYPES as readonly string[]).includes(bodyType)
}
