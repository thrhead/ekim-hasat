import { useEffect, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { createMobileAuthBootstrap } from "./src/auth/bootstrap";
import { createAppComposition, type ProductionAppState } from "./src/app-composition";
import { FirstFieldScreen } from "./src/features/onboarding/first-field-screen";
import { OnboardingEntryView } from "./src/features/onboarding/onboarding-entry-view";

export default function App() {
  const [state, setState] = useState<ProductionAppState>({
    auth: { status: "loading" },
    entry: "loading",
    client: null,
    accountId: null,
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
