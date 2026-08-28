import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { fetchMyRooms } from '@/lib/my-rooms-data'
import type { MyRoomsResponse } from './shared'
import MyRoomsClient from './my-rooms-client'

/**
 * Reads this user's bookings while rendering the document, and hands them to the
 * client component as props.
 *
 * The page used to fetch /api/my-rooms from the browser on mount, which could not
 * start until the bundle had downloaded and hydrated and then cost a full
 * browser -> Vercel -> Postgres round trip. Here the same read is an in-process
 * call on a warm pooled connection, and its result ships inside the HTML.
 */
export default async function MyRoomsPage() {
  const supabase = await createClient()

  // The layout above already established there is a valid session; this is only
  // to get the user object fetchMyRooms needs. getClaims() verifies locally, so
  // it is not a second round trip to the auth server.
  const user = await getAuthedUser(supabase)
  if (!user) redirect('/')

  const initialData = (await fetchMyRooms(supabase, user)) as unknown as MyRoomsResponse

  return <MyRoomsClient initialData={initialData} />
}
