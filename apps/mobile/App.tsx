import { useEffect, useRef, useState } from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { createMobileAuthBootstrap } from "./src/auth/bootstrap";
import { createAppComposition, type ProductionAppState } from "./src/app-composition";
import { FirstFieldScreen } from "./src/features/onboarding/first-field-screen";
import { OnboardingEntryView } from "./src/features/onboarding/onboarding-entry-view";
import { SeasonSetupScreen } from "./src/features/seasons/season-setup-screen";
import { TodayScreen } from "./src/features/seasons/today-screen";
import { TaskCompletionHistoryScreen } from "./src/features/tasks/task-completion-history-screen";
import { APP_PRIMARY_NAVIGATION } from "./src/app-composition";
import { FieldsScreen, FieldDetailScreen } from "./src/features/fields/fields-screen";
import { FieldCreateScreen } from "./src/features/fields/field-create-screen";
import { FieldEditScreen } from "./src/features/fields/field-edit-screen";

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
    historyFieldId: null,
    historySeasonId: null,
    editingField: null,
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
        onActivated={() => compositionRef.current?.showToday()}
      />
    );
  }

  if (state.entry === "today" && state.client && state.accountId) return <View style={styles.appScreen}>
    <TodayScreen key={state.accountId} client={state.client} accountId={state.accountId}
      store={compositionRef.current?.taskCompletionStore}
      coordinator={compositionRef.current?.getTaskCompletionCoordinator()}
      onOpenHistory={(fieldId, seasonId) => compositionRef.current?.showHistory(fieldId, seasonId)} />
    <PrimaryNavigation entry={state.entry} onNavigate={navigate} />
  </View>;
  if (state.entry === "history" && state.client && state.accountId && state.historyFieldId) return <View style={styles.appScreen}>
    <TaskCompletionHistoryScreen
      key={`${state.auth.status === "authenticated" ? state.auth.accountId : ""}:${state.historyFieldId}:${state.historySeasonId ?? "all"}`}
      client={state.client} accountId={state.accountId} fieldId={state.historyFieldId} initialSeasonId={state.historySeasonId ?? undefined}
      onBack={() => compositionRef.current?.showToday()} />
    <PrimaryNavigation entry={state.entry} onNavigate={navigate} />
  </View>;
  if (state.client && state.entry === "fields-list") return <View style={styles.appScreen}>
    <FieldsScreen client={state.client} onOpenField={(fieldId) => compositionRef.current?.openField(fieldId)} onCreate={() => compositionRef.current?.startFieldCreate()} />
    <PrimaryNavigation entry={state.entry} onNavigate={navigate} />
  </View>;
  if (state.client && state.entry === "field-detail" && state.fieldId) return <View style={styles.appScreen}>
    <FieldDetailScreen client={state.client} fieldId={state.fieldId} onBack={() => compositionRef.current?.showFields()} onEdit={(field) => compositionRef.current?.editField(field)} />
    <PrimaryNavigation entry={state.entry} onNavigate={navigate} />
  </View>;
  if (state.client && state.entry === "field-create") return <View style={styles.appScreen}>
    <FieldCreateScreen client={state.client} onCreated={() => compositionRef.current?.showFields()} />
    <PrimaryNavigation entry={state.entry} onNavigate={navigate} />
  </View>;
  if (state.client && state.entry === "field-edit" && state.editingField) return <View style={styles.appScreen}>
    <FieldEditScreen client={state.client} field={state.editingField} onSaved={() => compositionRef.current?.openField(state.editingField!.id)} />
    <PrimaryNavigation entry={state.entry} onNavigate={navigate} />
  </View>;

  return <AppShell />;

  function navigate(item: typeof APP_PRIMARY_NAVIGATION[number]["id"]) {
    if (item === "today") compositionRef.current?.showToday();
    if (item === "fields") compositionRef.current?.showFields();
    if (item === "create") compositionRef.current?.startFieldCreate();
  }
}

function PrimaryNavigation({ entry, onNavigate }: { entry: string; onNavigate: (item: typeof APP_PRIMARY_NAVIGATION[number]["id"]) => void }) {
  return <View accessibilityLabel="Navigazione principale" style={styles.navigation}>
    {APP_PRIMARY_NAVIGATION.map((item) => {
      const disabled = item.id === "calendar" || item.id === "more";
      const selected = (item.id === "today" && entry === "today") || (item.id === "fields" && entry.startsWith("field"));
      return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected, disabled }} disabled={disabled} onPress={() => onNavigate(item.id)} style={styles.navigationItem}>
        <Text style={selected ? styles.navigationSelected : styles.navigationLabel}>{item.label}</Text>
      </Pressable>;
    })}
  </View>;
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
  appScreen: { flex: 1 },
  navigation: { minHeight: 56, flexDirection: "row", justifyContent: "space-around", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#9a9a9a" },
  navigationItem: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center" },
  navigationLabel: { color: "#3f3f3f" },
  navigationSelected: { color: "#365c32", fontWeight: "700" },
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
