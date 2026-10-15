import { act, create, type TestRenderer } from "react-test-renderer";
import type { ApiClient } from "../../../../packages/api-client/src/index";
import {
  IrrigationRecordCreateScreen,
  type IrrigationRecordCreateScreenProps,
} from "../../src/features/operations/irrigation-record-create-screen";

const id = "11111111-1111-4111-8111-111111111111";
const activeSeasonId = "22222222-2222-4222-8222-222222222222";
const now = () => new Date("2026-10-05T10:00:00Z");
const record = {
  id, fieldId: "field-1", seasonId: activeSeasonId, occurredAt: "2026-10-05T09:00:00.000Z",
  businessTimezone: "Europe/Istanbul", method: null, durationMinutes: null,
  waterVolumeCubicMetres: null, note: null, recordedAt: "2026-10-05T10:00:00.000Z",
};

function node(screen: TestRenderer, label: string) {
  const found = screen.root.findAll(({ props }) => props.accessibilityLabel === label)[0];
  expect(found).toBeDefined();
  return found!;
}

async function mount(POST: jest.Mock, seasonId?: string) {
  let screen!: TestRenderer;
  const props: IrrigationRecordCreateScreenProps & { seasonId?: string } = {
    client: {
      GET: jest.fn().mockResolvedValue({
        data: { businessTimezone: "Europe/Istanbul", items: [], nextCursor: null },
        response: { ok: true, status: 200 },
      }),
      POST,
    } as unknown as ApiClient,
    fieldId: "field-1",
    now,
    createId: () => id,
    ...(seasonId ? { seasonId } : {}),
  };
  await act(async () => { screen = create(<IrrigationRecordCreateScreen {...props} />); });
  return screen;
}

async function pressSave(screen: TestRenderer) {
  await act(async () => { (node(screen, "Sulamayı kaydet").props.onPress as () => void)(); });
}

describe("irrigation record Season context", () => {
  it("submits the supplied active diary Season with an online create", async () => {
    const POST = jest.fn().mockResolvedValue({ data: record, response: { ok: true, status: 201 } });
    const screen = await mount(POST, activeSeasonId);

    await pressSave(screen);

    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/irrigation-records", {
      params: { path: { fieldId: "field-1" } },
      body: expect.objectContaining({
        irrigationRecordId: id,
        capturedBusinessTimezone: "Europe/Istanbul",
        seasonId: activeSeasonId,
      }),
    });
    await act(async () => screen.unmount());
  });

  it("allows online Field-only capture when no Season is supplied", async () => {
    const POST = jest.fn().mockResolvedValue({ data: { ...record, seasonId: null }, response: { ok: true, status: 201 } });
    const screen = await mount(POST);

    await pressSave(screen);

    expect(POST).toHaveBeenCalledWith("/fields/{fieldId}/irrigation-records", {
      params: { path: { fieldId: "field-1" } },
      body: {
        irrigationRecordId: id,
        occurredAtLocal: "2026-10-05T13:00",
        occurredAt: "2026-10-05T10:00:00.000Z",
        capturedBusinessTimezone: "Europe/Istanbul",
      },
    });
    await act(async () => screen.unmount());
  });
});
