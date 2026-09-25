import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ApiClient, components } from "../../api/onboarding-client";
import { FirstFieldControls, type LocationMode } from "./first-field-controls";
import type { MapLocation } from "./map/map-adapter";
import { OnboardingRecovery, type OnboardingRecoveryState } from "./onboarding-recovery";
import { createOnboardingDraftLifecycle } from "./onboarding-draft.lifecycle";
import { createOnboardingDraftStore } from "./onboarding-draft.store";

type FirstFieldSummary = components["schemas"]["FirstFieldSummary"];

export type FirstFieldAttempt = {
  idempotencyKey: string;
  request: components["schemas"]["CompleteOnboardingRequest"];
};

type DraftStore = ReturnType<typeof createOnboardingDraftStore>;
type DraftLifecycle = ReturnType<typeof createOnboardingDraftLifecycle>;

const defaultDraftStore = createOnboardingDraftStore();
const defaultDraftLifecycle = createOnboardingDraftLifecycle({ store: defaultDraftStore });

export function createFirstFieldDraftBinding(options: {
  accountId: string;
  store: Pick<DraftStore, "read" | "save" | "recordActivity">;
  lifecycle: Pick<DraftLifecycle, "successfulSave" | "cancel">;
}) {
  return {
    async restore(): Promise<{ name: string; location: MapLocation | null; mode: LocationMode; hasDraft: boolean }> {
      const draft = await options.store.read(options.accountId);
      if (draft) {
        try {
          await options.store.recordActivity(options.accountId);
        } catch {
          // A local activity timestamp failure does not invalidate a readable draft.
        }
      }
      const location = draft?.geometry ?? null;
      return {
        name: draft?.fieldName ?? "",
        location,
        mode: location?.type === "Polygon" ? "polygon" : "point",
        hasDraft: Boolean(draft && (draft.fieldName || location)),
      };
    },
    persist(name: string, location: MapLocation | null): Promise<void> {
      return options.store.save(options.accountId, {
        ...(name ? { fieldName: name } : {}),
        ...(location ? { geometry: location } : {}),
      });
    },
    async submit<T>(send: () => Promise<T>): Promise<T> {
      const result = await send();
      try {
        await options.lifecycle.successfulSave(options.accountId);
      } catch {
        // The server response remains authoritative if local cleanup is unavailable.
      }
      return result;
    },
    cancel(): Promise<void> {
      return options.lifecycle.cancel(options.accountId);
    },
  };
}

/** Keep blank names absent so the approved server default remains authoritative. */
export function createFirstFieldAttempt(
  name: string,
  location: MapLocation,
  idempotencyKey: string,
): FirstFieldAttempt {
  const trimmedName = name.trim();
  return {
    idempotencyKey,
    request: {
      ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
      location,
    },
  };
}

/** Submit using only the generated OpenAPI request and response types. */
export async function submitFirstField(
  client: ApiClient,
  attempt: FirstFieldAttempt,
): Promise<FirstFieldSummary> {
  const { data, error, response } = await client.POST("/onboarding/complete", {
    params: { header: { "Idempotency-Key": attempt.idempotencyKey } },
    body: attempt.request,
  });
  if (!response.ok || error !== undefined || data === undefined) {
    const failure = new Error("Unable to save first field") as Error & { recoveryState: OnboardingRecoveryState };
    failure.recoveryState = response.status === 401 || response.status === 403
      ? "session-expired"
      : response.status === 400 || response.status === 422
        ? "invalid-geometry"
        : response.status >= 500
          ? "uncertain-save"
          : "connectivity";
    throw failure;
  }
  return data.field as FirstFieldSummary;
}

export function FirstFieldSuccessView({ field }: { field: FirstFieldSummary }) {
  const createdDate = new Date(field.createdAt).toLocaleDateString("tr-TR");
  return (
    <View style={styles.success}>
      <Text accessibilityRole="header" style={styles.successTitle}>Tarla kaydedildi</Text>
      <Text style={styles.successName}>{field.name}</Text>
      <Text style={styles.successDate}>Kaydedilme tarihi: {createdDate}</Text>
      {field.boundary?.verificationStatus === "unverified" ? (
        <Text style={styles.successNote}>Tarla sınırı henüz doğrulanmadı.</Text>
      ) : null}
    </View>
  );
}

/** First-field entry screen; completion appears only after the API returns its summary. */
export function FirstFieldScreen({
  client,
  accountId,
  onComplete,
}: {
  client: ApiClient;
  accountId: string;
  onComplete?: (field: FirstFieldSummary) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<LocationMode>("point");
  const [location, setLocation] = useState<MapLocation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveryState, setRecoveryState] = useState<OnboardingRecoveryState | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [failedAttempt, setFailedAttempt] = useState<FirstFieldAttempt | null>(null);
  const [savedField, setSavedField] = useState<FirstFieldSummary | null>(null);
  const editRevision = useRef(0);
  const draftBinding = useMemo(() => createFirstFieldDraftBinding({
    accountId,
    store: defaultDraftStore,
    lifecycle: defaultDraftLifecycle,
  }), [accountId]);

  useEffect(() => {
    let active = true;
    const revisionBeforeRestore = editRevision.current;
    void draftBinding.restore().then(
      (draft) => {
        if (!active || editRevision.current !== revisionBeforeRestore) return;
        setName(draft.name);
        setLocation(draft.location);
        setMode(draft.mode);
        setRecoveredDraft(draft.hasDraft);
      },
      () => {
        if (!active || editRevision.current !== revisionBeforeRestore) return;
        setName("");
        setLocation(null);
        setMode("point");
        setRecoveredDraft(false);
      },
    );
    return () => { active = false; };
  }, [accountId, draftBinding]);

  async function submitAttempt(attempt: FirstFieldAttempt) {
    setSubmitting(true);
    setErrorMessage(null);
    setRecoveryState(null);
    try {
      const field = await draftBinding.submit(() => submitFirstField(client, attempt));
      setSavedField(field);
      setFailedAttempt(null);
      onComplete?.(field);
    } catch (error) {
      setFailedAttempt(attempt);
      setRecoveryState(error instanceof Error && "recoveryState" in error
        ? error.recoveryState as OnboardingRecoveryState
        : "connectivity");
    } finally {
      setSubmitting(false);
    }
  }

  function clearFailedAttempt() {
    setFailedAttempt(null);
    setErrorMessage(null);
    setRecoveryState(null);
  }

  function handleSubmit() {
    if (!location || submitting) return;
    const attempt = createFirstFieldAttempt(name, location, createIdempotencyKey());
    void submitAttempt(attempt);
  }

  if (savedField) return <FirstFieldSuccessView field={savedField} />;
  if (recoveredDraft) {
    return (
      <OnboardingRecovery
        state="draft-restored"
        onContinue={() => setRecoveredDraft(false)}
        onDiscard={async () => {
          try {
            await draftBinding.cancel();
          } catch {
            return;
          }
          setName("");
          setLocation(null);
          setMode("point");
          setRecoveredDraft(false);
        }}
      />
    );
  }
  return (
    <FirstFieldControls
      name={name}
      mode={mode}
      locationSelected={location !== null}
      submitting={submitting}
      errorMessage={errorMessage}
      recoveryState={recoveryState}
      onNameChange={(nextName) => {
        editRevision.current += 1;
        setName(nextName);
        void draftBinding.persist(nextName, location).catch(() => {});
        clearFailedAttempt();
      }}
      onModeChange={(nextMode) => {
        editRevision.current += 1;
        setMode(nextMode);
        setLocation(null);
        void draftBinding.persist(name, null).catch(() => {});
        clearFailedAttempt();
      }}
      onLocationChange={(nextLocation) => {
        editRevision.current += 1;
        setLocation(nextLocation);
        void draftBinding.persist(name, nextLocation).catch(() => {});
        clearFailedAttempt();
      }}
      onSubmit={handleSubmit}
      onRetry={() => {
        if (failedAttempt && !submitting) void submitAttempt(failedAttempt);
      }}
    />
  );
}

function createIdempotencyKey(): string {
  return `first-field-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const styles = StyleSheet.create({
  success: { flex: 1, gap: 12, justifyContent: "center", padding: 24 },
  successTitle: { color: "#245b35", fontSize: 24, fontWeight: "700" },
  successName: { color: "#202820", fontSize: 20, fontWeight: "600" },
  successDate: { color: "#333333", fontSize: 15 },
  successNote: { color: "#333333", fontSize: 15 },
});
