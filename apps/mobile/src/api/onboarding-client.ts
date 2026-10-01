import type { ApiClient } from "../../../../packages/api-client/src/index";

export type { ApiClient };
export type { components } from "../../../../packages/api-client/src/index";

/** Read the minimum onboarding state through the generated, authenticated API client. */
export async function getOnboardingStatus(client: ApiClient) {
  const { data, error, response } = await client.GET("/onboarding/status");
  if (!response.ok || error !== undefined || data === undefined) {
    throw new Error("Unable to load onboarding status");
  }
  return data;
}
