import * as Location from "expo-location";
import {
  createMapPoint,
  createMapPolygon,
  getCurrentLocation,
  getLocationFallbackMessage,
  type MapPoint,
} from "../../src/features/onboarding/map/map-adapter";

jest.mock("react-native-maps", () => ({
  __esModule: true,
  default: "MapView",
  Marker: "Marker",
  Polygon: "NativePolygon",
  Polyline: "Polyline",
}));

jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

describe("SPEC-001 provider-neutral map adapter", () => {
  beforeEach(() => jest.clearAllMocks());

  it("converts selected coordinates to Point in GeoJSON longitude/latitude order", () => {
    expect(createMapPoint(29.02, 41.01)).toEqual({
      type: "Point",
      coordinates: [29.02, 41.01],
    });
    expect(createMapPoint(181, 41)).toBeNull();
    expect(createMapPoint(29, Number.NaN)).toBeNull();
  });

  it("closes a Polygon ring and requires at least three vertices", () => {
    const vertices = [
      createMapPoint(29, 41),
      createMapPoint(29.1, 41),
      createMapPoint(29.1, 41.1),
    ] as MapPoint[];

    expect(createMapPolygon(vertices)).toEqual({
      type: "Polygon",
      coordinates: [[
        [29, 41],
        [29.1, 41],
        [29.1, 41.1],
        [29, 41],
      ]],
    });
    expect(createMapPolygon(vertices.slice(0, 2))).toBeNull();
  });

  it("keeps current-location permission and failures behind a provider-neutral result", async () => {
    const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
    const getPosition = jest.mocked(Location.getCurrentPositionAsync);

    requestPermission.mockResolvedValue({ status: "granted" } as Location.LocationPermissionResponse);
    getPosition.mockResolvedValue({ coords: { latitude: 40.7, longitude: -73.9 } } as Location.LocationObject);
    await expect(getCurrentLocation()).resolves.toEqual({
      kind: "located",
      point: { type: "Point", coordinates: [-73.9, 40.7] },
    });
    expect(getPosition).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });

    requestPermission.mockResolvedValue({ status: "denied" } as Location.LocationPermissionResponse);
    await expect(getCurrentLocation()).resolves.toEqual({ kind: "permission-denied" });
    expect(getLocationFallbackMessage("permission-denied"))
      .toBe("Konum izni verilmedi. Haritaya dokunarak konum seçebilirsiniz.");
    expect(createMapPoint(30, 40)).toEqual({ type: "Point", coordinates: [30, 40] });
    expect(getPosition).toHaveBeenCalledTimes(1);

    requestPermission.mockRejectedValue(new Error("native location unavailable"));
    await expect(getCurrentLocation()).resolves.toEqual({ kind: "unavailable" });
    expect(getLocationFallbackMessage("unavailable"))
      .toBe("Konum alınamadı. Haritaya dokunarak konum seçebilirsiniz.");
    expect(getLocationFallbackMessage("located")).toBeNull();
  });
});
