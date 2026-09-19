import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/lib/better-auth'

/** Better Auth's endpoints: sign-in, sign-out, session, password reset (issue #136). */
export const { GET, POST } = toNextJsHandler(auth)
