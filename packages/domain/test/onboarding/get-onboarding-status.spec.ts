import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultBusinessContextUnauthorizedError,
  getOnboardingStatus,
  type OnboardingStatusRepository,
} from "../../src/onboarding/get-onboarding-status.ts";
import type { VerifiedSubject } from "../../src/identity/auth-provider.ts";

const identity: VerifiedSubject = { provider: "supabase", subject: "farmer-1" };

function repository(overrides: Partial<OnboardingStatusRepository> = {}) {
  const calls: string[] = [];
  const value: OnboardingStatusRepository = {
    resolveDefaultBusiness: async (receivedIdentity) => {
      calls.push("resolve");
      assert.deepEqual(receivedIdentity, identity);
      return { kind: "authorized", userId: "user-1", businessId: "business-1" };
    },
    hasCompletedOnboarding: async (context) => {
      calls.push("completion");
      assert.deepEqual(context, { kind: "authorized", userId: "user-1", businessId: "business-1" });
      return false;
    },
    ...overrides,
  };
  return { value, calls };
}

test("reports onboarding needed when the authorized default context has no completion", async () => {
  const repo = repository();
  assert.deepEqual(await getOnboardingStatus(identity, repo.value), {
    firstFieldOnboardingNeeded: true,
  });
  assert.deepEqual(repo.calls, ["resolve", "completion"]);
});

test("reports onboarding needed when the user has no default business pointer", async () => {
  const repo = repository({
    resolveDefaultBusiness: async (receivedIdentity) => {
      repo.calls.push("resolve");
      assert.deepEqual(receivedIdentity, identity);
      return { kind: "missing" };
    },
  });
  assert.deepEqual(await getOnboardingStatus(identity, repo.value), {
    firstFieldOnboardingNeeded: true,
  });
  assert.deepEqual(repo.calls, ["resolve"]);
});

test("reports onboarding complete from durable completion state", async () => {
  const repo = repository({
    hasCompletedOnboarding: async (context) => {
      repo.calls.push("completion");
      assert.deepEqual(context, { kind: "authorized", userId: "user-1", businessId: "business-1" });
      return true;
    },
  });
  assert.deepEqual(await getOnboardingStatus(identity, repo.value), {
    firstFieldOnboardingNeeded: false,
  });
  assert.deepEqual(repo.calls, ["resolve", "completion"]);
});

test("fails safely without checking completion when default context is unauthorized", async () => {
  const repo = repository({
    resolveDefaultBusiness: async () => {
      repo.calls.push("resolve");
      throw new DefaultBusinessContextUnauthorizedError();
    },
  });
  await assert.rejects(
    getOnboardingStatus(identity, repo.value),
    DefaultBusinessContextUnauthorizedError,
  );
  assert.deepEqual(repo.calls, ["resolve"]);
});
