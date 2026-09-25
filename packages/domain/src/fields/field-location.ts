/** Provider-neutral GeoJSON input accepted when recording a field location. */
export type Position = [longitude: number, latitude: number];

export type PointLocation = {
  type: "Point";
  coordinates: Position;
};

export type PolygonLocation = {
  type: "Polygon";
  coordinates: Position[][];
};

export type FieldLocation = PointLocation | PolygonLocation;

export class FieldLocationValidationError extends Error {
  constructor(message: string = "Field location is invalid") {
    super(message);
    this.name = "FieldLocationValidationError";
  }
}

function invalid(message?: string): never {
  throw new FieldLocationValidationError(message);
}

function isPosition(value: unknown): value is Position {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [longitude, latitude] = value;
  return typeof longitude === "number"
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180
    && typeof latitude === "number"
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90;
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function cross(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Position, b: Position, p: Position): boolean {
  return cross(a, b, p) === 0
    && p[0] >= Math.min(a[0], b[0])
    && p[0] <= Math.max(a[0], b[0])
    && p[1] >= Math.min(a[1], b[1])
    && p[1] <= Math.max(a[1], b[1]);
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0))
    && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return true;
  return (abC === 0 && onSegment(a, b, c))
    || (abD === 0 && onSegment(a, b, d))
    || (cdA === 0 && onSegment(c, d, a))
    || (cdB === 0 && onSegment(c, d, b));
}

function signedArea(ring: Position[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  }
  return sum / 2;
}

function validateRing(value: unknown): Position[] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isPosition)) {
    return invalid("Polygon rings need at least four valid longitude/latitude positions");
  }
  const ring = value as Position[];
  if (!samePosition(ring[0]!, ring[ring.length - 1]!)) {
    return invalid("Polygon rings must be closed");
  }

  const vertices = ring.slice(0, -1);
  if (new Set(vertices.map(([longitude, latitude]) => `${longitude},${latitude}`)).size < 3) {
    return invalid("Polygon rings need at least three distinct vertices");
  }
  if (signedArea(ring) === 0) return invalid("Polygon rings must enclose an area");

  const edgeCount = ring.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    for (let j = i + 1; j < edgeCount; j += 1) {
      // Adjacent edges share an endpoint by definition, including the first
      // and last edge of the closed ring.
      if (j === i + 1 || (i === 0 && j === edgeCount - 1)) continue;
      if (segmentsIntersect(a, b, ring[j]!, ring[j + 1]!)) {
        return invalid("Polygon rings must not self-intersect");
      }
    }
  }
  return ring;
}

/**
 * Validate only input geometry structure and validity. This intentionally
 * does not calculate a representative point; polygon point-on-surface
 * derivation is owned by the PostGIS persistence adapter.
 */
export function validateFieldLocation(location: unknown): asserts location is FieldLocation {
  if (typeof location !== "object" || location === null) return invalid();
  const geometry = location as { type?: unknown; coordinates?: unknown };

  if (geometry.type === "Point") {
    if (!isPosition(geometry.coordinates)) {
      return invalid("Point coordinates must be longitude then latitude within WGS 84 bounds");
    }
    return;
  }

  if (geometry.type !== "Polygon") {
    return invalid("Only Point and Polygon field locations are supported");
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    return invalid("Polygon needs an outer ring");
  }
  for (const ring of geometry.coordinates) validateRing(ring);
}
