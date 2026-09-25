import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

type OnboardingEntryViewProps =
  | { state: "loading" }
  | { state: "authentication-failed"; onRetry: () => void };

/** Farmer-facing progress and recovery UI while the authenticated entry is resolved. */
export function OnboardingEntryView(props: OnboardingEntryViewProps) {
  if (props.state === "loading") {
    return (
      <View style={styles.container}>
        <ActivityIndicator accessibilityLabel="Girişiniz kontrol ediliyor" color="#245b35" />
        <Text accessibilityRole="text" style={styles.message}>
          Girişiniz kontrol ediliyor…
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="alert" style={styles.message}>
        Giriş yapılamadı. Yeniden deneyin.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yeniden dene"
        onPress={props.onRetry}
        style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
      >
        <Text style={styles.retryLabel}>Yeniden dene</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 16,
  },
  message: {
    color: "#202820",
    fontSize: 18,
    lineHeight: 26,
    textAlign: "center",
  },
  retryButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: "#245b35",
  },
  retryButtonPressed: {
    opacity: 0.8,
  },
  retryLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
