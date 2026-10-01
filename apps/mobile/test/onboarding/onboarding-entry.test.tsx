import { createApiClient } from "../../../../packages/api-client/src/index";
import { getOnboardingEntryRoute } from "../../src/features/onboarding/onboarding-entry";

describe("farmer onboarding entry", () => {
  function createStatusClient(firstFieldOnboardingNeeded: boolean) {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(
      new Response(JSON.stringify({ firstFieldOnboardingNeeded }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    return {
      client: createApiClient({ fetch: fetchMock }),
      fetchMock,
    };
  }

  it("routes a new farmer into first-field onboarding from generated status", async () => {
    const { client, fetchMock } = createStatusClient(true);

    await expect(getOnboardingEntryRoute(client)).resolves.toBe("first-field-onboarding");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/onboarding/status");
  });

  it("routes a returning farmer to the app when first-field onboarding is complete", async () => {
    const { client, fetchMock } = createStatusClient(false);

    await expect(getOnboardingEntryRoute(client)).resolves.toBe("home");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/onboarding/status");
  });
});
