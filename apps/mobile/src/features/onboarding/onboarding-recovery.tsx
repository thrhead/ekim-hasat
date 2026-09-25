import { Pressable, StyleSheet, Text, View } from "react-native";

export type OnboardingRecoveryState =
  | "draft-restored"
  | "connectivity"
  | "map-unavailable"
  | "invalid-geometry"
  | "session-expired"
  | "uncertain-save";

const messages: Record<Exclude<OnboardingRecoveryState, "draft-restored">, string> = {
  connectivity: "Bağlantı kurulamadı. Bağlantınızı kontrol edip yeniden deneyin.",
  "map-unavailable": "Harita şu anda açılamıyor. Konumunuzu haritaya dokunarak seçmeyi deneyin.",
  "invalid-geometry": "Tarla konumu geçerli değil. Haritada konumu veya sınırı düzeltin.",
  "session-expired": "Oturumunuz sona erdi. Yeniden giriş yaptıktan sonra devam edin.",
  "uncertain-save": "Tarla kaydedilmiş olabilir; henüz onay alamadık. Aynı kaydı yeniden deneyin.",
};

type OnboardingRecoveryProps = Readonly<{
  state: OnboardingRecoveryState;
  onContinue?: () => void;
  onDiscard?: () => void;
  onRetry?: () => void;
}>;

/** Farmer-facing recovery copy and actions; draft storage and lifecycle stay outside this view. */
export function OnboardingRecovery({ state, onContinue, onDiscard, onRetry }: OnboardingRecoveryProps) {
  if (state === "draft-restored") {
    return (
      <View style={styles.container}>
        <Text accessibilityRole="header" allowFontScaling style={styles.title}>Bilgileriniz hazır</Text>
        <Text allowFontScaling style={styles.message}>Tarla bilgilerinizi kaldığınız yerden sürdürebilirsiniz.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Devam et" onPress={onContinue} style={styles.primaryButton}>
          <Text allowFontScaling style={styles.primaryText}>Devam et</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Taslağı sil" onPress={onDiscard} style={styles.secondaryButton}>
          <Text allowFontScaling style={styles.secondaryText}>Taslağı sil</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text accessibilityRole="alert" allowFontScaling style={styles.message}>{messages[state]}</Text>
      {(state === "connectivity" || state === "uncertain-save") && onRetry ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Tekrar dene" onPress={onRetry} style={styles.primaryButton}>
          <Text allowFontScaling style={styles.primaryText}>Tekrar dene</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  title: { color: "#202820", fontSize: 22, fontWeight: "700" },
  message: { color: "#333333", fontSize: 16, lineHeight: 23 },
  primaryButton: { alignItems: "center", backgroundColor: "#245b35", borderRadius: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  primaryText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  secondaryButton: { alignItems: "center", borderColor: "#595959", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 16 },
  secondaryText: { color: "#202820", fontSize: 16, fontWeight: "600" },
});
