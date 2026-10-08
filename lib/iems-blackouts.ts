/**
 * The one space IEMS may black out (issue #227).
 *
 * In a module of its own, with no imports, so the SGA Spaces page can offer the
 * right space without pulling the server-side access check in
 * lib/blackout-access.ts along with it.
 *
 * By name, because `spaces` has nothing else that tells one room from another --
 * no slug, no kind, no ordering column -- and its ids are gen_random_uuid()s,
 * which a reseeded or freshly built database would not reproduce, where it would
 * keep the names. The name is already how the committee display finds the rooms
 * (SPACE_DISPLAY_ORDER in lib/spaces-display.ts), so renaming the room is already
 * a change that has to be made in code as well as in the table.
 *
 * Why only this room: SGA events held in the Conference Room are IEMS's to run,
 * so blocking it out for one is their call to make. The corners are not event
 * space, and blacking out every space at once stays an admin power.
 */
export const IEMS_BLACKOUT_SPACE_NAME = 'Conference Room'
