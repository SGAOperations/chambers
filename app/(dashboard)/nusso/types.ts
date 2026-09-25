/** An available room returned by /api/nusso/search (a GetAvailabilityList row). */
export interface AvailableRoom {
  RoomId: number
  RoomCode: string
  RoomDescription: string
  BuildingDescription: string
  Capacity: number
  MinCapacity: number
  DefaultSetupTypeId: number
  Alert: string | null
}
