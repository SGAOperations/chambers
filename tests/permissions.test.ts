import { describe, expect, it } from 'vitest'
import positionMap from '@/docs/sgauth/chambers-position-map.json'
import { ADMIN_ROLES, MANAGEMENT_ROLES, REQUEST_ALERT_ROLES, VIEW_ONLY_ROLES } from '@/lib/admin-roles'
import { EMAIL_PREF_ADMIN_ROLES, EMAIL_PREF_IEMS_ROLES } from '@/lib/email-preferences'
import {
  adminRoleFromPositions,
  iemsRoleFromPositions,
  isPositionKey,
  positionKeysForOffice,
} from '@/lib/permissions'

/**
 * lib/permissions.ts translates positions into the office names the rest of
 * Chambers already checks. These hold the two vocabularies together, so the
 * approved map (#153) and lib/admin-roles.ts cannot drift apart unnoticed.
 */

const office = (key: string) => adminRoleFromPositions([key])

describe('the approved map and Chambers agree', () => {
  it('every Management position is a Management office', () => {
    expect(positionMap.adminTiers.management.map(office).sort()).toEqual([...MANAGEMENT_ROLES].sort())
  })

  it('every view-only position is a view-only office', () => {
    expect(positionMap.adminTiers.viewOnly.map(office)).toEqual(VIEW_ONLY_ROLES)
  })

  it('every admin position is an admin office, and every admin office has a position', () => {
    const all = [...positionMap.adminTiers.management, ...positionMap.adminTiers.booking, ...positionMap.adminTiers.viewOnly]
    expect(all.map(office).sort()).toEqual([...ADMIN_ROLES].sort())
  })

  it('the request alert positions are the request alert offices', () => {
    expect(positionMap.requestAlerts.map(office).sort()).toEqual([...REQUEST_ALERT_ROLES].sort())
  })

  it('the admin email preference positions are the offices that get those preferences', () => {
    expect(positionMap.adminEmailPrefs.map(office).sort()).toEqual([...EMAIL_PREF_ADMIN_ROLES].sort())
  })

  it('both IEMS offices keep their email preferences', () => {
    const offices = positionMap.iems.map(k => iemsRoleFromPositions([k]))
    for (const role of EMAIL_PREF_IEMS_ROLES) expect(offices).toContain(role)
  })
})

describe('adminRoleFromPositions', () => {
  it('is null for no admin position', () => {
    expect(adminRoleFromPositions([])).toBeNull()
    expect(adminRoleFromPositions(['senator', 'director-of-events'])).toBeNull()
  })

  it('never lets a lesser second office narrow a greater one', () => {
    expect(adminRoleFromPositions(['student-body-president', 'comptroller'])).toBe('Comptroller')
    expect(adminRoleFromPositions(['comptroller', 'information-manager'])).toBe('Information Manager')
  })

  it('does not treat Digital Innovation Manager as an admin office (0020)', () => {
    expect(adminRoleFromPositions(['digital-innovation-manager'])).toBeNull()
  })
})

describe('iemsRoleFromPositions', () => {
  it('maps both offices and the product role', () => {
    expect(iemsRoleFromPositions(['vice-president-of-external-affairs'])).toBe('Vice President of External Affairs')
    expect(iemsRoleFromPositions(['chambers-iems'])).toBe('IEMS Access')
    expect(iemsRoleFromPositions(['senator'])).toBeNull()
  })
})

describe('positionKeysForOffice', () => {
  it('finds the position behind an office, for looking up other people', () => {
    expect(positionKeysForOffice('Comptroller')).toEqual(['comptroller'])
    expect(positionKeysForOffice('Director of Events')).toEqual(['director-of-events'])
    expect(positionKeysForOffice('Not an office')).toEqual([])
  })
})

describe('isPositionKey', () => {
  it('accepts slugs and nothing else', () => {
    expect(isPositionKey('vice-president-of-operational-affairs')).toBe(true)
    expect(isPositionKey('Comptroller')).toBe(false)
    expect(isPositionKey('a--b')).toBe(false)
    expect(isPositionKey("x'; drop table users")).toBe(false)
    expect(isPositionKey(42)).toBe(false)
  })
})
