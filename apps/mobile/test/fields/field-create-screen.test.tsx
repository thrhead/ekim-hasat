jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

import { Pressable, Text, TextInput } from "react-native";
import * as ExpoLocation from "expo-location";
import { createApiClient } from "../../../../packages/api-client/src/index";
import type { FieldComponents } from "../../../../packages/api-client/src/index";
import {
  createFieldAttempt,
  FieldCreateControls,
  FieldCreateSuccessView,
  submitFieldCreate,
} from "../../src/features/fields/field-create-screen";
import { MapAdapter, type MapPolygon } from "../../src/features/onboarding/map/map-adapter";

type TestElement = { type: unknown; props: Record<string, unknown> };
function collectElements(node: unknown): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  return [element, ...collectElements(element.props.children)];
}

const point: FieldComponents["schemas"]["Point"] = { type: "Point", coordinates: [29.02, 41.01] };
const polygon: MapPolygon = {
  type: "Polygon",
  coordinates: [[[29, 41], [29.01, 41], [29.01, 41.01], [29, 41]]],
};
const field: FieldComponents["schemas"]["FieldDetail"] = {
  id: "field-1",
  name: "Tarla 1",
  version: 1,
  representativePoint: point,
  hasCurrentBoundary: false,
  boundary: null,
  activeSeason: null,
  regionContext: {
    administrativeLocation: { state: "UNRESOLVED", resolvedAt: null },
    agriculturalRegion: { state: "UNRESOLVED", resolvedAt: null },
    agriculturalRegionOverride: null,
  },
};

describe("additional Field creation", () => {
  it("offers current location, map point, and Polygon choices without requesting permission on render", () => {
    const form = collectElements(FieldCreateControls({
      name: "",
      mode: "point",
      locationSelected: false,
      submitting: false,
      errorMessage: null,
      onNameChange: jest.fn(),
      onModeChange: jest.fn(),
      onLocationChange: jest.fn(),
      onSubmit: jest.fn(),
      onRetry: jest.fn(),
    }));
    expect(form.some(({ type, props }) => type === TextInput && props.accessibilityLabel === "Tarla adı (isteğe bağlı)")).toBe(true);
    expect(form.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Haritadan nokta seç")).toBe(true);
    expect(form.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tarla sınırı çiz")).toBe(true);
    expect(form.some(({ type }) => type === MapAdapter)).toBe(true);
    expect(ExpoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
    expect(form.some(({ type, props }) => type === Text && String(props.children).includes("Konum izni verilmedi"))).toBe(false);
    expect(form.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Haritadan nokta seç")).toBe(true);
  });

  it("trims an optional name and submits either a Point or Polygon with one stable idempotency key", () => {
    expect(createFieldAttempt("  North  ", { type: "Point", coordinates: [29.02, 41.01] }, "same-key")).toEqual({
      idempotencyKey: "same-key",
      request: { name: "North", location: { type: "POINT", point } },
    });
    expect(createFieldAttempt(" \t ", polygon, "same-key")).toEqual({
      idempotencyKey: "same-key",
      request: { location: { type: "POLYGON", polygon } },
    });
  });

  it("does not report success for validation or network failures and preserves the retry attempt", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "Invalid", requestId: "r1" } }), { status: 400 }))
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    const client = createApiClient({ fetch: fetchMock });
    const attempt = createFieldAttempt("North", { type: "Point", coordinates: [29.02, 41.01] }, "retry-key");
    await expect(submitFieldCreate(client, attempt)).rejects.toThrow();
    await expect(submitFieldCreate(client, attempt)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [request] of fetchMock.mock.calls) {
      expect((request as Request).headers.get("Idempotency-Key")).toBe("retry-key");
      expect(JSON.parse(await (request as Request).clone().text())).toEqual({ name: "North", location: { type: "POINT", point } });
    }
    const correctedForm = collectElements(FieldCreateControls({
      name: "North",
      mode: "polygon",
      locationSelected: true,
      submitting: false,
      errorMessage: "Tarla kaydedilemedi. Bilgilerinizi kontrol edip tekrar deneyin.",
      onNameChange: jest.fn(),
      onModeChange: jest.fn(),
      onLocationChange: jest.fn(),
      onSubmit: jest.fn(),
      onRetry: jest.fn(),
    }));
    expect(correctedForm.some(({ type, props }) => type === TextInput && props.value === "North")).toBe(true);
    expect(correctedForm.some(({ type, props }) => type === Text && props.accessibilityRole === "alert")).toBe(true);
    expect(correctedForm.some(({ type, props }) => type === Pressable && props.accessibilityLabel === "Tarla sınırı çiz")).toBe(true);
    expect(correctedForm.some(({ type }) => type === MapAdapter)).toBe(true);
  });

  it("returns and displays a Field only after the server accepts the create command", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(JSON.stringify(field), { status: 201, headers: { "Content-Type": "application/json", ETag: '"1"' } }),
    );
    const client = createApiClient({ fetch: fetchMock });
    const result = await submitFieldCreate(client, createFieldAttempt("", { type: "Point", coordinates: [29.02, 41.01] }, "accepted-key"));
    expect(result).toEqual(field);
    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe("/v1/fields");
    expect(request.headers.get("Idempotency-Key")).toBe("accepted-key");
    expect(JSON.parse(await request.text())).toEqual({ location: { type: "POINT", point } });
    const success = collectElements(FieldCreateSuccessView({ field: result }));
    expect(success.some(({ type, props }) => type === Text && props.children === "Tarla kaydedildi")).toBe(true);
    expect(success.some(({ type, props }) => type === Text && props.children === field.name)).toBe(true);
  });
});
