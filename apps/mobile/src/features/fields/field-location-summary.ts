import type { FieldComponents } from "../../../../../packages/api-client/src/index";

type FieldBoundary = FieldComponents["schemas"]["FieldDetail"]["boundary"];

type CoordinatePair = readonly [number, number];

function isCoordinatePair(value: unknown): value is CoordinatePair {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && Number.isFinite(value[0])
    && typeof value[1] === "number"
    && Number.isFinite(value[1]);
}

/** Show only a short sample of the persisted current Polygon coordinates. */
export function formatCurrentBoundary(boundary: FieldBoundary): string {
  if (!boundary) return "Yalnızca tarla noktası kayıtlı; güncel sınır yok.";
  const coordinates: unknown = boundary.coordinates;
  const firstRing = Array.isArray(coordinates) ? coordinates[0] : undefined;
  const points = Array.isArray(firstRing) ? firstRing.filter(isCoordinatePair).slice(0, 5) : [];
  const summary = points.map(([longitude, latitude]) => `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`).join("; ");
  return `Güncel sınır (Polygon): ${summary || "Geometri mevcut"}`;
}
