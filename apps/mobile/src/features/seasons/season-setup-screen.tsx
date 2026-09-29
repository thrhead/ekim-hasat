import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { ApiClient, SeasonComponents } from "../../api/onboarding-client";
import { createSeasonCreateCommandCoordinator, createSeasonCreateCommandStore } from "./season-create-command-store";
import type { SeasonCreateCommand } from "./season-create-command-store";

type CropChoice = SeasonComponents["schemas"]["CropChoice"];
type Options = Readonly<{ crops: CropChoice[]; customCropAllowed: true; fieldId: string }>;
type CreateRequest = SeasonComponents["schemas"]["CreateSeasonDraftRequest"];
type Season = SeasonComponents["schemas"]["SeasonDraft"] | SeasonComponents["schemas"]["ActiveSeason"];

export type SeasonSetupResult = Readonly<{ season: Season; planSource: "VALIDATED_TEMPLATE" | "MANUAL" }>;

export function createSeasonSetupFlow(client: ApiClient, store = createSeasonCreateCommandStore()) {
  const coordinator = createSeasonCreateCommandCoordinator({
    store,
    newIdempotencyKey: () => `season-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    async create(command: SeasonCreateCommand) {
      const { data, error, response } = await client.POST("/fields/{fieldId}/seasons", {
        params: {
          path: { fieldId: command.fieldId },
          header: { "Idempotency-Key": command.idempotencyKey },
        },
        body: command.request,
      });
      if (!response.ok || error !== undefined || data === undefined) {
        const code = error && "error" in error ? error.error.code : null;
        const message = code === "MANUAL_PLAN_CHOICE_REQUIRED"
          ? "Bu ürün için doğrulanmış plan kullanılamıyor. MANUAL planı seçip yeniden deneyin."
          : response.status === 409
            ? "Sezon bilgileri çakıştı. Seçimlerinizi kontrol edip yeniden deneyin."
            : "Sezon taslağı oluşturulamadı. Bilgileriniz korunuyor; aynı işlem güvenle yeniden denenebilir.";
        throw new Error(message);
      }
      return data as Season;
    },
  });
  return {
    createOrRetry(accountId: string, fieldId: string, request: CreateRequest) {
      return coordinator.createOrRetry(accountId, fieldId, request).then((season) => ({
        season,
        planSource: season.plan.source.kind,
      }));
    },
    recover(accountId: string) {
      return store.readUnresolved(accountId);
    },
    readLastSuccess(accountId: string) {
      return store.readLastSuccess(accountId);
    },
    dismissLastSuccess(accountId: string, idempotencyKey: string) {
      return store.clearLastSuccess(accountId, idempotencyKey);
    },
  };
}

export async function loadSeasonSetupOptions(client: ApiClient, fieldId: string): Promise<Options> {
  const { data, error, response } = await client.GET("/fields/{fieldId}/season-setup-options", {
    params: { path: { fieldId } },
  });
  if (!response.ok || error !== undefined || data === undefined) {
    throw new Error("Ekim seçenekleri yüklenemedi. İnternet bağlantınızı kontrol edip yeniden deneyin.");
  }
  return data;
}

export function validatePlantingDate(value: string, today = localCalendarDate()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Tarihi YYYY-AA-GG biçiminde girin.";
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays[month - 1]) {
    return "Bu takvim tarihi geçerli değil.";
  }
  if (value > today) return "Ekim tarihi bugün veya geçmiş bir gün olmalı.";
  return null;
}

export function getManualPlanExplanation(crop: CropChoice | null, customCrop: boolean): string {
  if (customCrop) return "Bu özel ürün için kullanılabilir doğrulanmış plan yok. İsterseniz MANUAL plan seçerek devam edin.";
  if (crop?.templateAvailability === "EMPTY_TASK_DEFINITIONS") {
    return "Uygun doğrulanmış plan şu anda kullanılamıyor; yayınlanan planda görev yok. Devam etmek için MANUAL planı açıkça seçin.";
  }
  return "Bu ürün için uygun doğrulanmış plan yok. Devam etmek için MANUAL planı açıkça seçin.";
}

export function buildSeasonCreateRequest(
  crop: CropChoice | null,
  customCropName: string,
  plantingDate: string,
  manualConfirmed: boolean,
): CreateRequest | null {
  const normalizedCustomCropName = customCropName.trim();
  const needsManual = normalizedCustomCropName.length > 0 || Boolean(crop?.manualPlanAllowed);
  if ((!crop && !normalizedCustomCropName) || (needsManual && !manualConfirmed)) return null;
  return {
    crop: crop ? { centralCropId: crop.id } : { customCropName: normalizedCustomCropName },
    sowingPlantingDate: plantingDate.trim(),
    ...(needsManual ? { planSource: "MANUAL" } : {}),
  };
}

function localCalendarDate(): string {
  const now = new Date();
  return `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
}

export function SeasonSetupScreen({
  client,
  fieldId,
  initialRequest,
  initialResult,
  onCreated,
  onBack,
}: {
  client: ApiClient;
  fieldId: string;
  initialRequest?: CreateRequest;
  initialResult?: SeasonSetupResult;
  onCreated: (request: CreateRequest) => Promise<SeasonSetupResult>;
  onBack?: () => void;
}) {
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedCropId, setSelectedCropId] = useState<string | null>(initialRequest?.crop && "centralCropId" in initialRequest.crop ? initialRequest.crop.centralCropId : null);
  const [customCropName, setCustomCropName] = useState(initialRequest?.crop && "customCropName" in initialRequest.crop ? initialRequest.crop.customCropName : "");
  const [plantingDate, setPlantingDate] = useState(initialRequest?.sowingPlantingDate ?? "");
  const [manualConfirmed, setManualConfirmed] = useState(initialRequest?.planSource === "MANUAL");
  const [dateError, setDateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SeasonSetupResult | null>(initialResult ?? null);
  const replayingSavedCommand = initialRequest !== undefined;

  const reloadOptions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await loadSeasonSetupOptions(client, fieldId);
      setOptions(loaded);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Ekim seçenekleri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  }, [client, fieldId]);

  useEffect(() => { void reloadOptions(); }, [client, fieldId]);

  const selectedCrop = options?.crops.find((crop) => crop.id === selectedCropId) ?? null;
  const hasCustomCrop = customCropName.trim().length > 0;
  const manualChoiceRequired = hasCustomCrop || Boolean(selectedCrop?.manualPlanAllowed);
  const canSubmit = Boolean(options && (selectedCrop || hasCustomCrop) && plantingDate.trim() && (!manualChoiceRequired || manualConfirmed));

  async function createDraft() {
    const validationMessage = validatePlantingDate(plantingDate.trim());
    setDateError(validationMessage);
    setActionError(null);
    if (validationMessage || !options) return;
    const request = buildSeasonCreateRequest(selectedCrop, customCropName, plantingDate, manualConfirmed);
    if (!request) {
      setActionError("Bu ürün için MANUAL plan seçimini onaylayın.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await onCreated(request);
      setResult(created);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Sezon oluşturulamadı. Bilgileriniz korunuyor; yeniden deneyin.");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>{result.season.status === "ACTIVE" ? "Bu sezon zaten etkin" : "Sezon taslağı hazır"}</Text>
        <Text style={styles.body}>{result.planSource === "VALIDATED_TEMPLATE" ? "Plan kaynağı: VALIDATED_TEMPLATE — merkezi olarak doğrulanmış." : "Plan kaynağı: MANUAL — elle hazırlanacak."}</Text>
        <Text style={styles.body}>{result.season.cropDisplayName} · Ekim tarihi: {result.season.sowingPlantingDate}</Text>
        {onBack ? <SeasonSetupActionButton label="Devam et" onPress={onBack} /> : null}
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {onBack ? <SeasonSetupActionButton label="Geri" onPress={onBack} /> : null}
      <Text accessibilityRole="header" style={styles.title}>İlk sezonunuzu kurun</Text>
      <Text style={styles.body}>Tarlanıza ektiğiniz ürünü ve gerçek ekim tarihini seçin.</Text>
      <SeasonSetupStatus loading={loading} error={loadError} onRetry={() => void reloadOptions()} />
      {!loading && options && options.crops.length === 0 ? (
        <Text style={styles.body}>Merkezi ürün seçenekleri bulunamadı. Ürününüzü kendiniz yazarak MANUAL plan seçebilirsiniz.</Text>
      ) : null}
      {replayingSavedCommand ? (
        <Text accessibilityLiveRegion="polite" style={styles.body}>
          Kaydedilmiş sezon isteğiniz güvenle yeniden gönderilecek. Bu işlemdeki ürün ve tarih değiştirilemez.
        </Text>
      ) : null}
      {!loading && options?.crops.map((crop: CropChoice) => (
        <SeasonSetupActionButton
          key={crop.id}
          label={`${crop.displayName}${crop.templateAvailability === "AVAILABLE" ? " · VALIDATED_TEMPLATE" : " · MANUAL plan seçimi gerekir"}`}
          selected={selectedCropId === crop.id}
          disabled={replayingSavedCommand || submitting}
          onPress={() => {
            setSelectedCropId(crop.id);
            setCustomCropName("");
            setManualConfirmed(false);
          }}
        />
      ))}
      {!loading && options ? (
        <>
          <Text style={styles.label}>Listede yoksa ürün adını yazın</Text>
          <TextInput
            accessibilityLabel="Özel ürün adı"
            accessibilityRole="text"
            editable={!replayingSavedCommand && !submitting}
            autoCapitalize="sentences"
            onChangeText={(value) => {
              setCustomCropName(value);
              if (value.length > 0) setSelectedCropId(null);
              setManualConfirmed(false);
            }}
            placeholder="Ürün adı"
            placeholderTextColor="#52616b"
            style={styles.input}
            value={customCropName}
          />
        </>
      ) : null}
      <Text style={styles.label}>Gerçek ekim tarihi (YYYY-AA-GG)</Text>
      <TextInput
        accessibilityLabel="Gerçek ekim tarihi, yıl ay gün"
        accessibilityHint="Bugünün tarihi veya geçmiş bir takvim günü girin"
        accessibilityRole="text"
        editable={!replayingSavedCommand && !submitting}
        onChangeText={(value) => { setPlantingDate(value); setDateError(null); }}
        placeholder="2026-04-15"
        placeholderTextColor="#52616b"
        style={styles.input}
        value={plantingDate}
        keyboardType="numbers-and-punctuation"
      />
      {dateError ? <Text accessibilityRole="alert" style={styles.error}>{dateError}</Text> : null}
      {manualChoiceRequired ? (
        <>
          <Text accessibilityLiveRegion="polite" style={styles.body}>{getManualPlanExplanation(selectedCrop, hasCustomCrop)}</Text>
          <SeasonSetupActionButton
            label="MANUAL planı seçiyorum"
            selected={manualConfirmed}
            disabled={replayingSavedCommand || submitting}
            onPress={() => setManualConfirmed((current) => !current)}
          />
        </>
      ) : selectedCrop ? <Text style={styles.sourceCue}>Plan kaynağı: VALIDATED_TEMPLATE</Text> : null}
      {actionError ? <Text accessibilityRole="alert" style={styles.error}>{actionError}</Text> : null}
      {options && !loading && !loadError ? (
        <SeasonSetupActionButton
          label={submitting ? "Sezon oluşturuluyor…" : replayingSavedCommand ? "Kaydedilmiş sezon isteğini yeniden dene" : "Sezon taslağı oluştur"}
          disabled={!canSubmit || submitting}
          onPress={() => void createDraft()}
        />
      ) : null}
    </ScrollView>
  );
}

export function SeasonSetupStatus({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) {
    return <Text accessibilityRole="progressbar" accessibilityLabel="Ekim seçenekleri yükleniyor" style={styles.body}>Ekim seçenekleri yükleniyor…</Text>;
  }
  if (!error) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      <SeasonSetupActionButton label="Yeniden dene" onPress={onRetry} />
    </View>
  );
}

export function SeasonSetupActionButton({
  label,
  onPress,
  disabled = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, selected && styles.buttonSelected, pressed && !disabled && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      <Text allowFontScaling style={[styles.buttonText, disabled && styles.disabledText]}>{selected ? `✓ ${label}` : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: 12, padding: 20, paddingBottom: 32 },
  title: { color: "#142b1f", fontSize: 26, fontWeight: "700", marginBottom: 4 },
  body: { color: "#263a30", fontSize: 17, lineHeight: 26 },
  label: { color: "#142b1f", fontSize: 17, fontWeight: "600", marginTop: 8 },
  input: { backgroundColor: "#ffffff", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, color: "#142b1f", fontSize: 18, minHeight: 52, paddingHorizontal: 12 },
  button: { backgroundColor: "#ffffff", borderColor: "#52616b", borderRadius: 8, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
  buttonSelected: { backgroundColor: "#e5f2e9", borderColor: "#174d2d", borderWidth: 2 },
  buttonPressed: { opacity: 0.75 },
  buttonDisabled: { backgroundColor: "#e5e8e6", borderColor: "#68746d" },
  buttonText: { color: "#142b1f", fontSize: 17, lineHeight: 24 },
  disabledText: { color: "#4a5750" },
  sourceCue: { color: "#174d2d", fontSize: 16, fontWeight: "600" },
  error: { color: "#8b1d1d", fontSize: 16, lineHeight: 24 },
});
