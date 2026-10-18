import {getWorldMap, mapAncestry, childMaps} from '../db/worldMapsRepo';
import {listMapLayers, listMapMarkers, listTravelModes} from '../db/mapMarkersRepo';
import {listScenes} from '../db/worldStoryRepo';
import {listPresences} from '../db/worldPresenceRepo';
import {getWorldCalendar} from '../db/worldCalendarRepo';
import {getDb} from '../db/database';

/** The real Desktop read DTOs, scoped by the operation's owning vault. No
 * generation, mutation, calibration or renderer capability is exposed. */
export function mobileWorldMapReadSource(vaultId: string, mapId: unknown) {
  if (typeof mapId !== 'string' || !mapId || mapId.length > 1024) throw new Error('invalid_arguments');
  return getDb().transaction(() => {
  const map = getWorldMap(mapId);
  if (!map) throw new Error('record_not_found');
  const source = {version:1, vaultId, map, ancestry:mapAncestry(mapId), children:childMaps(mapId),
    layers:listMapLayers(mapId), markers:listMapMarkers(mapId), travelModes:listTravelModes(),
    scenes:listScenes(), presences:listPresences(), calendar:getWorldCalendar()};
  if (Buffer.byteLength(JSON.stringify(source),'utf8') > 16 * 1024 * 1024) throw new Error('map_read_source_too_large');
  return source;
  })();
}
