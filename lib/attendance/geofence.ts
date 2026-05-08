// Pure geofence math. Edge-safe — Haversine formula, no Prisma, no
// node:* imports. Coords in decimal degrees, radius/distance in meters.

const EARTH_RADIUS_M = 6_371_000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points in meters. */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** True if `point` is within `radiusMeters` of `center`. */
export function isWithinGeofence(
  point: LatLng,
  center: LatLng,
  radiusMeters: number,
): boolean {
  return (
    haversineDistance(point.lat, point.lng, center.lat, center.lng) <= radiusMeters
  );
}
