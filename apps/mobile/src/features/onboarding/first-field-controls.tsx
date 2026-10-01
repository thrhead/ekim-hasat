import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { MapAdapter, type MapLocation } from "./map/map-adapter";
import { OnboardingRecovery, type OnboardingRecoveryState } from "./onboarding-recovery";

export type LocationMode = "point" | "polygon";

type FirstFieldControlsProps = Readonly<{
  name: string;
  mode: LocationMode;
  locationSelected: boolean;
  submitting: boolean;
  errorMessage: string | null;
  recoveryState?: OnboardingRecoveryState | null;
  onNameChange: (name: string) => void;
  onModeChange: (mode: LocationMode) => void;
  onLocationChange: (location: MapLocation) => void;
  onSubmit: () => void;
  onRetry: () => void;
}>;

/** Stateless farmer-facing controls surface; map SDK details stay in MapAdapter. */
export function FirstFieldControls(props: FirstFieldControlsProps) {
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" allowFontScaling style={styles.title}>İlk tarlanızı ekleyin</Text>
      <Text allowFontScaling style={styles.description}>
        Tarlanızı haritada işaretleyin. Tarla adı isteğe bağlıdır.
      </Text>

      <View style={styles.nameGroup}>
        <Text accessibilityRole="text" allowFontScaling style={styles.label}>Tarla adı (isteğe bağlı)</Text>
        <TextInput
          accessibilityRole="text"
          accessibilityLabel="Tarla adı (isteğe bağlı)"
          autoCapitalize="sentences"
          onChangeText={props.onNameChange}
          placeholder="Örneğin, Bahçe"
          returnKeyType="done"
          allowFontScaling
          style={styles.input}
          value={props.name}
        />
      </View>

      <View style={styles.modeGroup}>
        <Text accessibilityRole="text" allowFontScaling style={styles.label}>Konum seçimi</Text>
        <View style={styles.modeButtons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Haritadan nokta seç"
            accessibilityState={{ selected: props.mode === "point" }}
            disabled={props.submitting}
            onPress={() => props.onModeChange("point")}
            style={[styles.modeButton, props.mode === "point" && styles.selectedModeButton]}
            hitSlop={4}
          >
            <Text allowFontScaling style={[styles.modeButtonText, props.mode === "point" && styles.selectedModeText]}>Nokta seç</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tarla sınırı çiz"
            accessibilityState={{ selected: props.mode === "polygon" }}
            disabled={props.submitting}
            onPress={() => props.onModeChange("polygon")}
            style={[styles.modeButton, props.mode === "polygon" && styles.selectedModeButton]}
            hitSlop={4}
          >
            <Text allowFontScaling style={[styles.modeButtonText, props.mode === "polygon" && styles.selectedModeText]}>Sınır çiz</Text>
          </Pressable>
        </View>
      </View>

      <View pointerEvents={props.submitting ? "none" : "auto"}>
        <MapAdapter key={props.mode} mode={props.mode} onLocationChange={props.onLocationChange} />
      </View>
      <Text accessibilityRole="text" allowFontScaling style={styles.selectionStatus}>
        {props.locationSelected ? "Konum seçildi" : "Devam etmek için haritada konum seçin."}
      </Text>

      {props.recoveryState ? (
        <OnboardingRecovery state={props.recoveryState} onRetry={props.onRetry} />
      ) : props.errorMessage ? (
        <Text accessibilityRole="alert" allowFontScaling style={styles.error}>
          {props.errorMessage}
        </Text>
      ) : null}

      {props.submitting ? (
        <View accessibilityLiveRegion="polite" style={styles.progress}>
          <ActivityIndicator color="#245b35" />
          <Text allowFontScaling style={styles.progressText}>Tarla kaydediliyor…</Text>
        </View>
      ) : props.errorMessage && !props.recoveryState ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tekrar dene"
          hitSlop={4}
          onPress={props.onRetry}
          style={styles.primaryButton}
        >
          <Text allowFontScaling style={styles.primaryButtonText}>Tekrar dene</Text>
        </Pressable>
      ) : !props.recoveryState ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tarlayı kaydet"
          accessibilityState={{ disabled: !props.locationSelected }}
          disabled={!props.locationSelected}
          onPress={props.onSubmit}
          style={[styles.primaryButton, !props.locationSelected && styles.disabledButton]}
        >
          <Text allowFontScaling style={styles.primaryButtonText}>Tarlayı kaydet</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, padding: 20, paddingBottom: 32 },
  title: { color: "#202820", fontSize: 24, fontWeight: "700", flexShrink: 1 },
  description: { color: "#333333", fontSize: 16, lineHeight: 23, flexShrink: 1 },
  nameGroup: { gap: 6 },
  label: { color: "#202820", fontSize: 16, fontWeight: "600" },
  input: { borderColor: "#595959", borderRadius: 8, borderWidth: 1, fontSize: 16, minHeight: 48, paddingHorizontal: 12, color: "#202820", backgroundColor: "#ffffff" },
  modeGroup: { gap: 8 },
  modeButtons: { flexDirection: "row", gap: 8 },
  modeButton: { alignItems: "center", borderColor: "#245b35", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 16, flexShrink: 1 },
  selectedModeButton: { backgroundColor: "#245b35" },
  modeButtonText: { color: "#245b35", fontSize: 16, flexShrink: 1 },
  selectedModeText: { color: "#ffffff" },
  selectionStatus: { color: "#333333", fontSize: 15, flexShrink: 1 },
  error: { color: "#8b1515", fontSize: 16, flexShrink: 1 },
  progress: { alignItems: "center", flexDirection: "row", gap: 10, minHeight: 48 },
  progressText: { color: "#202820", fontSize: 16, flexShrink: 1 },
  primaryButton: { alignItems: "center", backgroundColor: "#245b35", borderRadius: 8, justifyContent: "center", minHeight: 48, paddingHorizontal: 20, alignSelf: "stretch" },
  disabledButton: { opacity: 0.5 },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "600", flexShrink: 1 },
});
