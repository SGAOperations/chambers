export type EmailPrefKey =
  | 'res_missed'
  | 'event_res_created'
  | 'event_res_missed'
  | 'event_res_cancelled'
  | 'sga_res_force_cancelled'
  | 'blackout_created'
  | 'res_altered'

export const EMAIL_PREF_LABELS: Record<EmailPrefKey, string> = {
  res_missed: 'Reservation Missed',
  event_res_created: 'Event Reservation Created',
  event_res_missed: 'Event Reservation Missed',
  event_res_cancelled: 'Event Reservation Cancelled',
  sga_res_force_cancelled: 'SGA Reservation Force-Cancelled',
  blackout_created: 'Blackout Window Created',
  res_altered: 'Reservation Altered',
}

export const EMAIL_PREF_ADMIN_ROLES = [
  'Executive Vice President',
  'Vice President of Operational Affairs',
  'Comptroller',
  'Information Manager',
]

export const EMAIL_PREF_IEMS_ROLES = [
  'Vice President of External Affairs',
  'Director of Events',
]

export const ADMIN_ROLE_PREF_KEYS: EmailPrefKey[] = [
  'res_missed',
  'event_res_created',
  'event_res_missed',
  'event_res_cancelled',
  'sga_res_force_cancelled',
  'blackout_created',
]

export const IEMS_ROLE_PREF_KEYS: EmailPrefKey[] = [
  'res_altered',
  'event_res_created',
  'event_res_missed',
  'event_res_cancelled',
]

export function getPrefsForRole(
  adminRole: string | null | undefined,
  iemsRole: string | null | undefined
): EmailPrefKey[] {
  if (adminRole && EMAIL_PREF_ADMIN_ROLES.includes(adminRole)) return ADMIN_ROLE_PREF_KEYS
  if (iemsRole && EMAIL_PREF_IEMS_ROLES.includes(iemsRole)) return IEMS_ROLE_PREF_KEYS
  return []
}

export function userWantsEmail(
  prefs: Record<string, boolean> | null | undefined,
  key: EmailPrefKey,
  adminRole: string | null | undefined,
  iemsRole: string | null | undefined
): boolean {
  const eligible = getPrefsForRole(adminRole, iemsRole)
  if (!eligible.includes(key)) return false
  if (!prefs || !(key in prefs)) return true
  return prefs[key] === true
}
