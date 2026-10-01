jest.mock("@react-native-async-storage/async-storage", () => (
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock")
));

import { Pressable, Text, TextInput } from "react-native";
import { createApiClient } from "../../../../packages/api-client/src/index";
import {
  createFirstFieldAttempt,
  FirstFieldSuccessView,
  submitFirstField,
} from "../../src/features/onboarding/first-field-screen";
import { FirstFieldControls } from "../../src/features/onboarding/first-field-controls";
import { MapAdapter, type MapLocation } from "../../src/features/onboarding/map/map-adapter";

type TestElement = { type: unknown; props: Record<string, unknown> };

function collectElements(node: unknown): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(collectElements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as TestElement;
  return [element, ...collectElements(element.props.children)];
}

const point: MapLocation = { type: "Point", coordinates: [29.02, 41.01] };
const field = {
  id: "first-field-1",
  name: "Bahçe",
  representativePoint: point,
  createdAt: "2026-09-25T12:00:00.000Z",
};
const defaultNamedField = { ...field, name: "Tarla 1" };

describe("first-field onboarding screen", () => {
  it("omits blank names for the server default and trims entered names", () => {
    expect(createFirstFieldAttempt(" \t\n ", point, "stable-key")).toEqual({
      idempotencyKey: "stable-key",
      request: { location: point },
    });
    expect(createFirstFieldAttempt("  Bahçe  ", point, "stable-key")).toEqual({
      idempotencyKey: "stable-key",
      request: { name: "Bahçe", location: point },
    });
  });

  it("submits only the generated completion contract and returns its FirstFieldSummary", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(JSON.stringify({ field }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createApiClient({ fetch: fetchMock });
    const attempt = createFirstFieldAttempt("Bahçe", point, "same-attempt-key");

    await expect(submitFirstField(client, attempt)).resolves.toEqual(field);

    const request = fetchMock.mock.calls[0]?.[0] as Request;
    expect(new URL(request.url).pathname).toBe("/v1/onboarding/complete");
    expect(request.headers.get("Idempotency-Key")).toBe("same-attempt-key");
    expect(JSON.parse(await request.text())).toEqual({ name: "Bahçe", location: point });
  });

  it("keeps the same idempotency key and payload available for an uncertain-save retry", async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "INTERNAL_ERROR" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ field: defaultNamedField }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const client = createApiClient({ fetch: fetchMock });
    const attempt = createFirstFieldAttempt("", point, "retry-with-this-key");

    await expect(submitFirstField(client, attempt)).rejects.toThrow();
    await expect(submitFirstField(client, attempt)).resolves.toEqual(defaultNamedField);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [request] of fetchMock.mock.calls) {
      const body = JSON.parse(await (request as Request).clone().text());
      expect((request as Request).headers.get("Idempotency-Key")).toBe("retry-with-this-key");
      expect(body).toEqual({ location: point });
    }
  });

  it("offers optional naming, Point/Polygon choices, and a saved state from the API summary", () => {
    const form = collectElements(FirstFieldControls({
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
    expect(form.some(({ type, props }) => type === TextInput
      && props.accessibilityLabel === "Tarla adı (isteğe bağlı)")).toBe(true);
    expect(form.filter(({ type }) => type === Pressable)
      .some(({ props }) => props.accessibilityLabel === "Haritadan nokta seç")).toBe(true);
    expect(form.filter(({ type }) => type === Pressable)
      .some(({ props }) => props.accessibilityLabel === "Tarla sınırı çiz")).toBe(true);
    const map = form.find(({ type }) => type === MapAdapter);
    expect(map?.props.mode).toBe("point");

    const retry = FirstFieldControls({
      name: "",
      mode: "polygon",
      locationSelected: false,
      submitting: false,
      errorMessage: "Tarla kaydedilemedi.",
      onNameChange: jest.fn(),
      onModeChange: jest.fn(),
      onLocationChange: jest.fn(),
      onSubmit: jest.fn(),
      onRetry: jest.fn(),
    });
    const retryElements = collectElements(retry);
    expect(retryElements.some(({ type }) => type === MapAdapter)).toBe(true);
    expect(retryElements.some(({ type, props }) => type === Pressable
      && props.accessibilityLabel === "Tekrar dene")).toBe(true);

    const submitting = collectElements(FirstFieldControls({
      name: "",
      mode: "point",
      locationSelected: true,
      submitting: true,
      errorMessage: null,
      onNameChange: jest.fn(),
      onModeChange: jest.fn(),
      onLocationChange: jest.fn(),
      onSubmit: jest.fn(),
      onRetry: jest.fn(),
    }));
    expect(submitting.some(({ type, props }) => type === Text && props.children === "Tarla kaydediliyor…")).toBe(true);

    const success = collectElements(FirstFieldSuccessView({ field }));
    expect(success.some(({ type, props }) => type === Text && props.children === "Tarla kaydedildi")).toBe(true);
    expect(success.some(({ type, props }) => type === Text && props.children === field.name)).toBe(true);
  });
});
