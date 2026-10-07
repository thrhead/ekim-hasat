import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { AuthOperationResult, SignupOutcome } from "../../auth/auth-port";

type Props = Readonly<{
  onSignIn(email: string, password: string): Promise<AuthOperationResult<void>>;
  onSignUp(email: string, password: string): Promise<AuthOperationResult<SignupOutcome>>;
}>;

type Mode = "sign-in" | "sign-up";

export function AuthScreen({ onSignIn, onSignUp }: Props) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const inFlight = useRef(false);
  const emailInput = useRef<TextInput>(null);
  const passwordInput = useRef<TextInput>(null);
  const passwordValue = useRef("");

  useEffect(() => () => { passwordValue.current = ""; }, []);

  const updatePassword = (value: string) => {
    passwordValue.current = value;
    setPassword(value);
  };

  const switchMode = (nextMode: Mode) => {
    if (pending) return;
    setMode(nextMode);
    setErrorMessage(null);
    setConfirmationRequired(false);
    updatePassword("");
  };

  const submit = async () => {
    if (inFlight.current) return;
    setErrorMessage(null);
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !passwordValue.current) {
      setErrorMessage("E-posta adresinizi ve şifrenizi girin.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setErrorMessage("Geçerli bir e-posta adresi girin.");
      return;
    }

    inFlight.current = true;
    setPending(true);
    try {
      if (mode === "sign-in") {
        const result = await onSignIn(normalizedEmail, passwordValue.current);
        if (!result.ok) {
          setErrorMessage(result.error === "INVALID_CREDENTIALS"
            ? "E-posta veya şifre hatalı. Bilgilerinizi kontrol edip yeniden deneyin."
            : result.error === "UNAVAILABLE"
              ? "Şu anda giriş yapılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
              : "Giriş yapılamadı. Bilgilerinizi kontrol edip yeniden deneyin.");
          updatePassword("");
          return;
        }
        updatePassword("");
      } else {
        const result = await onSignUp(normalizedEmail, passwordValue.current);
        if (!result.ok) {
          setErrorMessage("Hesap oluşturulamadı. Bilgilerinizi kontrol edip yeniden deneyin.");
          updatePassword("");
          return;
        }
        updatePassword("");
        if (result.value === "confirmation-required") setConfirmationRequired(true);
      }
    } catch {
      updatePassword("");
      setErrorMessage(mode === "sign-up"
        ? "Hesap oluşturulamadı. Bilgilerinizi kontrol edip yeniden deneyin."
        : "Şu anda giriş yapılamıyor. Bağlantınızı kontrol edip yeniden deneyin.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  const submitLabel = mode === "sign-in" ? "Giriş yap" : "Hesap oluştur";

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headingBlock}>
          <Text accessibilityRole="header" allowFontScaling style={styles.title}>{confirmationRequired ? "E-postanızı doğrulayın" : submitLabel}</Text>
          {!confirmationRequired && <Text allowFontScaling style={styles.description}>Devam etmek için e-posta adresinizi ve şifrenizi girin.</Text>}
        </View>

        {confirmationRequired ? (
          <View>
            <Text accessibilityRole="text" accessibilityLiveRegion="polite" allowFontScaling style={styles.status}>
              Hesabınız oluşturuldu. E-posta adresinizi doğrulayın, ardından giriş yapın.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Giriş yap"
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={() => switchMode("sign-in")}
              style={styles.secondaryButton}
            ><Text allowFontScaling style={styles.secondaryButtonText}>Giriş yap</Text></Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.field}>
              <Text allowFontScaling style={styles.label}>E-posta</Text>
              <TextInput
                ref={emailInput}
                accessibilityRole="text"
                accessibilityLabel="E-posta adresi"
                allowFontScaling
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!pending}
                keyboardType="email-address"
                onChangeText={setEmail}
                onSubmitEditing={() => passwordInput.current?.focus()}
                returnKeyType="next"
                selectionColor="#245b35"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
              />
            </View>
            <View style={styles.field}>
              <Text allowFontScaling style={styles.label}>Şifre</Text>
              <TextInput
                ref={passwordInput}
                accessibilityRole="text"
                accessibilityLabel="Şifre"
                allowFontScaling
                autoCapitalize="none"
                autoComplete={mode === "sign-up" ? "new-password" : "password"}
                editable={!pending}
                onChangeText={updatePassword}
                onSubmitEditing={() => { void submit(); }}
                returnKeyType="go"
                secureTextEntry
                selectionColor="#245b35"
                style={styles.input}
                textContentType={mode === "sign-up" ? "newPassword" : "password"}
                value={password}
              />
            </View>

            {errorMessage && <Text accessibilityRole="alert" allowFontScaling style={styles.error}>{errorMessage}</Text>}
            <View accessibilityLiveRegion="polite" style={styles.pendingRegion}>
              {pending && <>
                <ActivityIndicator accessible={false} color="#245b35" />
                <Text accessibilityRole="progressbar" accessibilityLabel="Kimlik doğrulama sürüyor" allowFontScaling style={styles.pendingText}>İşleminiz yapılıyor…</Text>
              </>}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={submitLabel}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              onPress={() => { void submit(); }}
              style={[styles.primaryButton, pending && styles.buttonDisabled]}
            ><Text allowFontScaling style={styles.primaryButtonText}>{submitLabel}</Text></Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mode === "sign-in" ? "Hesap oluştur" : "Giriş yap"}
              accessibilityState={{ disabled: pending }}
              disabled={pending}
              onPress={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
              style={styles.secondaryButton}
            ><Text allowFontScaling style={styles.secondaryButtonText}>{mode === "sign-in" ? "Hesabınız yok mu? Hesap oluştur" : "Zaten hesabınız var mı? Giriş yap"}</Text></Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#ffffff" },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 32 },
  headingBlock: { marginBottom: 24 },
  title: { color: "#202820", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#333333", fontSize: 16, lineHeight: 23, marginTop: 8 },
  form: { gap: 18 },
  field: { gap: 8 },
  label: { color: "#202820", fontSize: 16, fontWeight: "600" },
  input: { minHeight: 52, borderWidth: 1, borderColor: "#595959", borderRadius: 8, paddingHorizontal: 12, color: "#202820", backgroundColor: "#ffffff", fontSize: 16 },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#245b35", paddingHorizontal: 20, marginTop: 4 },
  buttonDisabled: { opacity: 0.65 },
  primaryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  secondaryButtonText: { color: "#245b35", fontSize: 15, fontWeight: "600", textAlign: "center" },
  error: { color: "#8b1515", fontSize: 16, lineHeight: 22 },
  pendingRegion: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 8 },
  pendingText: { color: "#33483a", fontSize: 14 },
  status: { color: "#202820", fontSize: 16, lineHeight: 24, marginBottom: 20 },
});
