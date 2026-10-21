import { isRegistrarSpacesEnabled } from '@/lib/25live/client'
import SpacesPage from './spaces-page'

/**
 * Browse/Book Rooms. A server shell only so the Registrar flag is read where
 * the environment is -- flipping REGISTRAR_SPACES_ENABLED needs no rebuild.
 */
export default function BrowsePage() {
  return <SpacesPage registrarEnabled={isRegistrarSpacesEnabled()} />
}
