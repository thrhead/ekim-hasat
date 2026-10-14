import type { ApiClient } from "../../../../packages/api-client/src/index";
import type { ObservationCommand, ObservationCommandStore } from "../../src/features/observations/observation-command-store";
import { createObservationDelivery } from "../../src/features/observations/observation-delivery";

const original: ObservationCommand = { accountId: "a", observationId: "123e4567-e89b-42d3-a456-426614174000",
  fieldId: "f", seasonId: null, description: "Original note", occurredAtLocal: "2026-10-14T12:00",
  occurredAt: "2026-10-14T09:00:00.000Z", capturedBusinessTimezone: "Europe/Istanbul", state: "PENDING" };

function setup(responses: Array<unknown>, initial: ObservationCommand = original) {
  let saved = initial;
  const store = {
    list: async () => [saved],
    markAttempt: async () => { saved = { ...saved, attemptMayHaveCommitted: true }; },
    finishAttempt: async () => {},
    recordAccepted: async (_a: string, _id: string, result: unknown) => { saved = { ...saved, state: "ACCEPTED", acceptedResult: result }; },
    recordAttention: async (_a: string, _id: string, state: ObservationCommand["state"], failureCode: string) => {
      saved = { ...saved, state, failureCode };
    },
    clearAttemptUncertainty: async () => { saved = { ...saved, attemptMayHaveCommitted: false }; },
  } as unknown as ObservationCommandStore;
  const POST = jest.fn();
  for (const response of responses) response instanceof Error ? POST.mockRejectedValueOnce(response) : POST.mockResolvedValueOnce(response);
  const client = { POST } as unknown as ApiClient;
  const delivery = createObservationDelivery({ store, getAuthorizationSession: () => ({ accountId: "a", client }) });
  return { delivery, POST, getSaved: () => saved };
}

const failure = (status: number, code: string) => ({ response: { ok: false, status }, error: { error: { code } } });

it("keeps an unknown crash/lost response unconfirmed after a later authorization denial", async () => {
  const fixture = setup([new TypeError("connection lost"), failure(403, "FORBIDDEN")]);
  await fixture.delivery.deliver("a");
  expect(fixture.getSaved()).toMatchObject({ state: "PENDING", attemptMayHaveCommitted: true });
  await fixture.delivery.deliver("a");
  expect(fixture.getSaved()).toMatchObject({ state: "UNCONFIRMED", description: "Original note" });
  await fixture.delivery.deliver("a");
  expect(fixture.POST).toHaveBeenCalledTimes(2);
});

it("holds a first-delivery timezone mismatch for attention without changing captured time", async () => {
  const fixture = setup([failure(409, "BUSINESS_TIMEZONE_CHANGED")]);
  await fixture.delivery.deliver("a");
  expect(fixture.getSaved()).toMatchObject({ state: "NEEDS_ATTENTION", description: original.description,
    occurredAt: original.occurredAt, occurredAtLocal: original.occurredAtLocal,
    capturedBusinessTimezone: original.capturedBusinessTimezone });
  await fixture.delivery.deliver("a");
  expect(fixture.POST).toHaveBeenCalledTimes(1);
});

it("keeps a prior uncertain attempt unconfirmed after a later timezone mismatch", async () => {
  const fixture = setup([failure(409, "BUSINESS_TIMEZONE_CHANGED")], { ...original, attemptMayHaveCommitted: true });
  await fixture.delivery.deliver("a");
  expect(fixture.getSaved()).toMatchObject({ state: "UNCONFIRMED", description: original.description,
    occurredAt: original.occurredAt, occurredAtLocal: original.occurredAtLocal,
    capturedBusinessTimezone: original.capturedBusinessTimezone });
});
