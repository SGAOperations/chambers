import { sgauthEnabled } from '@/lib/sgauth'
import ManagementTabs from './management-tabs'

/**
 * Management (issue #64). A server component only so it can say whether
 * Chambers signs in through SGAuth, which decides the tabs (#151, #152); the
 * page itself is ManagementTabs.
 */
export default function ManagementPage() {
  return <ManagementTabs sgauth={sgauthEnabled()} />
}
