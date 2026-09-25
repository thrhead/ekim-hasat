import type { ApiClient } from "../../api/onboarding-client";
import { getOnboardingStatus } from "../../api/onboarding-client";

export type OnboardingEntryRoute = "first-field-onboarding" | "home";

/** Call after sign-in with the authenticated generated API client. */
export async function getOnboardingEntryRoute(
  client: ApiClient,
): Promise<OnboardingEntryRoute> {
  const status = await getOnboardingStatus(client);
  if (typeof status.firstFieldOnboardingNeeded !== "boolean") {
    throw new Error("Onboarding status response is invalid");
  }

  return status.firstFieldOnboardingNeeded ? "first-field-onboarding" : "home";
}
