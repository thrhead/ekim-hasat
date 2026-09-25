import { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import MapView, {
  Marker,
  Polygon as NativePolygon,
  Polyline,
  type LatLng,
  type MapPressEvent,
  type Region,
} from "react-native-maps";
import * as Location from "expo-location";

/** Provider-neutral GeoJSON locations supported by first-field onboarding. */
export type MapPoint = {
  type: "Point";
  coordinates: [longitude: number, latitude: number];
};

export type MapPolygon = {
  type: "Polygon";
  coordinates: [[longitude: number, latitude: number][]];
};

export type MapLocation = MapPoint | MapPolygon;

export type CurrentLocationResult =
  | { kind: "located"; point: MapPoint }
  | { kind: "permission-denied" }
  | { kind: "unavailable" };

export function getLocationFallbackMessage(
  result: CurrentLocationResult["kind"] | null,
): string | null {
  if (result === "permission-denied") {
    return "Konum izni verilmedi. Haritaya dokunarak konum seçebilirsiniz.";
  }
  if (result === "unavailable") {
    return "Konum alınamadı. Haritaya dokunarak konum seçebilirsiniz.";
  }
  return null;
}

export type MapAdapterProps = Readonly<{
  mode: "point" | "polygon";
  onLocationChange: (location: MapLocation) => void;
}>;

/** Convert an SDK-independent coordinate pair into the SPEC-001 Point shape. */
export function createMapPoint(longitude: number, latitude: number): MapPoint | null {
  if (!isValidPosition(longitude, latitude)) return null;
  return { type: "Point", coordinates: [longitude, latitude] };
}

/** Close a Polygon ring and reject attempts with fewer than three vertices. */
export function createMapPolygon(vertices: readonly MapPoint[]): MapPolygon | null {
  if (vertices.length < 3 || vertices.some(({ coordinates }) => !createMapPoint(...coordinates))) return null;
  const ring = vertices.map(({ coordinates }) => [...coordinates] as [number, number]);
  ring.push([...ring[0]!] as [number, number]);
  return { type: "Polygon", coordinates: [ring] };
}

const TURKIYE_CENTER: Region = {
  latitude: 39,
  longitude: 35,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

/** Request device location without exposing Expo Location types to callers. */
export async function getCurrentLocation(): Promise<CurrentLocationResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return { kind: "permission-denied" };

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const { latitude, longitude } = position.coords;
    if (
      !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      return { kind: "unavailable" };
    }
    const point = createMapPoint(longitude, latitude);
    return point ? { kind: "located", point } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * The sole react-native-maps boundary for SPEC-001. Native coordinates and
 * events are converted here to simple GeoJSON Point/Polygon values.
 */
export function MapAdapter({ mode, onLocationChange }: MapAdapterProps) {
  const [region, setRegion] = useState(TURKIYE_CENTER);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [vertices, setVertices] = useState<LatLng[]>([]);
  const [locationResult, setLocationResult] = useState<CurrentLocationResult["kind"] | null>(null);

  function handleMapPress(event: MapPressEvent) {
    const coordinate = event.nativeEvent.coordinate;
    if (!isValidCoordinate(coordinate)) return;

    setLocationResult(null);
    if (mode === "point") {
      setPoint(coordinate);
      const selectedPoint = createMapPoint(coordinate.longitude, coordinate.latitude);
      if (selectedPoint) onLocationChange(selectedPoint);
      return;
    }
    setVertices((current) => [...current, coordinate]);
  }

  async function handleCurrentLocation() {
    const result = await getCurrentLocation();
    if (result.kind === "permission-denied") {
      setLocationResult(result.kind);
      return;
    }
    if (result.kind === "unavailable") {
      setLocationResult(result.kind);
      return;
    }

    const [longitude, latitude] = result.point.coordinates;
    const coordinate = { latitude, longitude };
    setRegion({ ...coordinate, latitudeDelta: 0.02, longitudeDelta: 0.02 });
    setLocationResult("located");
    if (mode === "point") {
      setPoint(coordinate);
      onLocationChange(result.point);
    }
  }

  function finishPolygon() {
    if (vertices.length < 3) return;
    const polygon = createMapPolygon(vertices.flatMap(({ latitude, longitude }) => {
      const vertex = createMapPoint(longitude, latitude);
      return vertex ? [vertex] : [];
    }));
    if (polygon) onLocationChange(polygon);
  }

  const selectedCoordinate = mode === "point" ? point : null;
  const polygonCoordinates = vertices.length >= 3
    ? vertices.map(({ latitude, longitude }) => ({ latitude, longitude }))
    : undefined;
  const locationFallbackMessage = getLocationFallbackMessage(locationResult);

  return (
    <View style={styles.container}>
      <MapView
        accessibilityLabel={mode === "point" ? "Nokta seçmek için harita" : "Tarla sınırını çizmek için harita"}
        initialRegion={TURKIYE_CENTER}
        onPress={handleMapPress}
        onRegionChangeComplete={setRegion}
        region={region}
        style={styles.map}
        testID="onboarding-map"
      >
        {selectedCoordinate ? <Marker coordinate={selectedCoordinate} /> : null}
        {mode === "polygon" && polygonCoordinates ? (
          <>
            <Polyline coordinates={polygonCoordinates} strokeColor="#245b35" strokeWidth={3} />
            {vertices.length >= 3 ? (
              <NativePolygon coordinates={polygonCoordinates} fillColor="rgba(36, 91, 53, 0.16)" strokeColor="#245b35" strokeWidth={2} />
            ) : null}
            {vertices.map((coordinate, index) => <Marker key={`${index}-${coordinate.latitude}-${coordinate.longitude}`} coordinate={coordinate} />)}
          </>
        ) : null}
      </MapView>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Konumumu kullan"
          onPress={handleCurrentLocation}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Konumumu kullan</Text>
        </Pressable>
        {mode === "polygon" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sınırı tamamla"
            disabled={vertices.length < 3}
            onPress={finishPolygon}
            style={[styles.button, vertices.length < 3 && styles.disabledButton]}
          >
            <Text style={styles.buttonText}>Sınırı tamamla</Text>
          </Pressable>
        ) : null}
      </View>

      {locationFallbackMessage ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {locationFallbackMessage}
        </Text>
      ) : null}
      {mode === "polygon" ? (
        <Text accessibilityRole="text" style={styles.hint}>
          Sınırı çizmek için haritaya en az üç noktadan dokunun.
        </Text>
      ) : null}
    </View>
  );
}

function isValidCoordinate(coordinate: LatLng): boolean {
  return isValidPosition(coordinate.longitude, coordinate.latitude);
}

function isValidPosition(longitude: number, latitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  map: { height: 320, width: "100%" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: {
    alignItems: "center",
    backgroundColor: "#245b35",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  disabledButton: { opacity: 0.5 },
  buttonText: { color: "#ffffff", fontSize: 16 },
  notice: { color: "#7a3514", fontSize: 15 },
  hint: { color: "#333333", fontSize: 15 },
});
