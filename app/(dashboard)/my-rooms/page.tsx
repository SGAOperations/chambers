import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { fetchMyRooms } from '@/lib/my-rooms-data'
import { flattenMyRooms, todayInAppZone, type MyRoomsResponse } from './shared'
import MyRoomsClient from './my-rooms-client'

/**
 * Reads this user's bookings while rendering the document, flattens them, and
 * hands the finished rows to the client component as props.
 *
 * The page used to fetch /api/my-rooms from the browser on mount, which could not
 * start until the bundle had downloaded and hydrated and then cost a full
 * browser -> Vercel -> Postgres round trip. Here the same read is an in-process
 * call on a warm pooled connection, and its result ships inside the HTML.
 *
 * `today` is resolved here and passed down with the rows. Every date decision on
 * the render path -- which bookings are past, which fall in the "next N days"
 * window, which cell the calendar highlights -- keys off this one string, so the
 * server's markup and React's first client render agree by construction rather
 * than by both happening to read compatible clocks. See todayInAppZone().
 */
export default async function MyRoomsPage() {
  const supabase = await createClient()

  // The layout above already established there is a valid session; this is only
  // to get the user object fetchMyRooms needs. getClaims() verifies locally, so
  // it is not a second round trip to the auth server.
  const user = await getAuthedUser(supabase)
  if (!user) redirect('/')

  const data = (await fetchMyRooms(supabase, user)) as unknown as MyRoomsResponse
  const today = todayInAppZone()

  return (
    <MyRoomsClient
      initialBookings={flattenMyRooms(data, today)}
      initialSenateTypePreferences={data.senateTypePreferences ?? {}}
      today={today}
    />
  )
}
