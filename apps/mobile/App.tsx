import { useEffect, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { createMobileAuthBootstrap } from "./src/auth/bootstrap";
import { createAppComposition, type ProductionAppState } from "./src/app-composition";
import { FirstFieldScreen } from "./src/features/onboarding/first-field-screen";
import { OnboardingEntryView } from "./src/features/onboarding/onboarding-entry-view";
import { SeasonSetupScreen } from "./src/features/seasons/season-setup-screen";

export default function App() {
  const [state, setState] = useState<ProductionAppState>({
    auth: { status: "loading" },
    entry: "loading",
    client: null,
    accountId: null,
    fieldId: null,
    seasonRequest: null,
    seasonResult: null,
    seasonDraft: null,
  });
  const compositionRef = useRef<ReturnType<typeof createAppComposition> | null>(null);

  useEffect(() => {
    const bootstrap = createMobileAuthBootstrap();
    const composition = createAppComposition(bootstrap.controller);
    compositionRef.current = composition;
    const unsubscribe = composition.subscribe(setState);
    return () => {
      unsubscribe();
      composition.dispose();
      compositionRef.current = null;
      bootstrap.dispose();
    };
  }, []);

  if (state.auth.status === "loading") {
    return <OnboardingEntryView state="loading" />;
  }

  if (state.auth.status === "signed-out") {
    return <AppShell />;
  }

  if (state.entry === "status-error") {
    return <OnboardingEntryView state="authentication-failed" onRetry={() => compositionRef.current?.retryStatus()} />;
  }

  if (state.entry === "loading" || !state.client) {
    return <OnboardingEntryView state="loading" />;
  }

  if (state.entry === "first-field-onboarding") {
    if (!state.accountId) return <OnboardingEntryView state="loading" />;
    return (
      <FirstFieldScreen
        key={state.accountId}
        client={state.client}
        accountId={state.accountId}
        onComplete={(field) => compositionRef.current?.completeFirstField(field)}
      />
    );
  }

  if (state.entry === "season-setup" || state.entry === "season-created" || state.entry === "season-review") {
    if (!state.accountId || !state.client || !state.fieldId) return <OnboardingEntryView state="loading" />;
    return (
      <SeasonSetupScreen
        key={`${state.accountId}:${state.fieldId}:${state.entry === "season-review" ? "season-created" : state.entry}`}
        client={state.client}
        fieldId={state.fieldId}
        initialRequest={state.seasonRequest ?? undefined}
        initialResult={state.seasonResult ?? undefined}
        initialDraft={state.entry === "season-review" ? state.seasonDraft ?? undefined : undefined}
        onCreated={(request) => compositionRef.current!.createSeason(state.fieldId!, request)}
        onReview={(draft) => compositionRef.current?.reviewSeason(draft)}
        onExitReview={() => compositionRef.current?.exitSeasonReview()}
        onBack={state.entry === "season-created" ? () => compositionRef.current?.continueAfterSeason() : undefined}
      />
    );
  }

  return <AppShell />;
}

function AppShell() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Ekim Hasat</Text>
      <StatusBar barStyle="default" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
  },
});
