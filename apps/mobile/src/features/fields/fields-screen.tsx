import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { ApiClient, FieldComponents } from "../../../../../packages/api-client/src/index";
import { readField, readFields, type FieldReadError } from "./fields-client";
import { FieldRegionContextView } from "./field-region-context";
import { formatCurrentBoundary } from "./field-location-summary";

type FieldListItem = FieldComponents["schemas"]["FieldListItem"];
type FieldDetail = FieldComponents["schemas"]["FieldDetail"];

function RetryMessage({ error, onRetry, label }: { error: FieldReadError; onRetry: () => void; label: string }) {
  return <View accessibilityLiveRegion="polite">
    <Text>{error.message}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onRetry}>
      <Text>Tekrar dene</Text>
    </Pressable>
  </View>;
}

function FieldRow({ field, onOpen }: { field: FieldListItem; onOpen: (fieldId: string) => void }) {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${field.name} tarlasını aç`}
    onPress={() => onOpen(field.id)}
  >
    <View>
      <Text>{field.name}</Text>
      <Text>{field.hasCurrentBoundary ? "Sınır kaydı var" : "Sınır henüz eklenmedi"}</Text>
    </View>
  </Pressable>;
}

export function FieldsScreen({ client, onOpenField, onCreate }: { client: ApiClient; onOpenField?: (fieldId: string) => void; onCreate?: () => void }) {
  const [items, setItems] = useState<FieldListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FieldReadError | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<FieldReadError | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const requestNumber = useRef(0);
  const completedCursors = useRef(new Set<string>());

  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    completedCursors.current.clear();
    setLoading(true);
    setError(null);
    setMoreError(null);
    try {
      const page = await readFields(client, { limit: 50 });
      if (request !== requestNumber.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (failure) {
      if (request !== requestNumber.current) return;
      setError(failure as FieldReadError);
    } finally {
      if (request === requestNumber.current) { setLoading(false); setMoreLoading(false); }
    }
  }, [client]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor;
    if (!cursor || moreLoading || completedCursors.current.has(cursor)) return;
    const request = ++requestNumber.current;
    setMoreLoading(true);
    setMoreError(null);
    try {
      const page = await readFields(client, { limit: 50, cursor });
      if (request !== requestNumber.current) return;
      completedCursors.current.add(cursor);
      setItems((current) => {
        const rows = current ?? [];
        const ids = new Set(rows.map((item) => item.id));
        return [...rows, ...page.items.filter((item) => {
          if (ids.has(item.id)) return false;
          ids.add(item.id);
          return true;
        })];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      if (request !== requestNumber.current) return;
      setMoreError(failure as FieldReadError);
    } finally {
      if (request === requestNumber.current) setMoreLoading(false);
    }
  }, [client, moreLoading, nextCursor]);

  useEffect(() => {
    void load();
    return () => { requestNumber.current += 1; };
  }, [load]);

  return <ScrollView accessibilityLabel="Tarlalar ekranı">
    <Text accessibilityRole="header">Tarlalar</Text>
    {onCreate && <Pressable accessibilityRole="button" accessibilityLabel="Tarla ekle" onPress={onCreate}><Text>+ Tarla ekle</Text></Pressable>}
    {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Tarlalar yükleniyor">Yükleniyor…</Text>}
    {!loading && error && <RetryMessage error={error} onRetry={() => { void load(); }} label="Tarlaları yeniden yükle" />}
    {!loading && !error && items?.length === 0 && <Text>Henüz tarla yok.</Text>}
    {!loading && !error && items?.map((field) => (
      <FieldRow key={field.id} field={field} onOpen={onOpenField ?? (() => undefined)} />
    ))}
    {!loading && !error && moreLoading && <Text accessibilityRole="progressbar">Tarlaların kalanı yükleniyor…</Text>}
    {!loading && !error && moreError && <RetryMessage error={moreError} onRetry={() => { void loadMore(); }} label="Kalan tarlaları yeniden yükle" />}
    {!loading && !error && nextCursor && !moreLoading && !moreError && <Pressable accessibilityRole="button" accessibilityLabel="Daha fazla tarla yükle" onPress={() => { void loadMore(); }}><Text>Daha fazla tarla yükle</Text></Pressable>}
  </ScrollView>;
}

function formattedLocalDate(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function FieldDetailScreen({ client, fieldId, onBack, onEdit }: { client: ApiClient; fieldId: string; onBack?: () => void; onEdit?: (field: FieldDetail) => void }) {
  const [field, setField] = useState<FieldDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FieldReadError | null>(null);
  const requestNumber = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestNumber.current;
    setLoading(true);
    setError(null);
    try {
      const result = await readField(client, fieldId);
      if (request !== requestNumber.current) return;
      setField(result);
    } catch (failure) {
      if (request !== requestNumber.current) return;
      setField(null);
      setError(failure as FieldReadError);
    } finally {
      if (request === requestNumber.current) setLoading(false);
    }
  }, [client, fieldId]);

  useEffect(() => {
    void load();
    return () => { requestNumber.current += 1; };
  }, [load]);

  return <ScrollView accessibilityLabel="Tarla ayrıntısı">
    {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Tarlalara dön" onPress={onBack}><Text>Geri</Text></Pressable>}
    <Text accessibilityRole="header">Tarla</Text>
    {loading && <Text accessibilityRole="progressbar" accessibilityLabel="Tarla yükleniyor">Yükleniyor…</Text>}
    {!loading && error && <RetryMessage error={error} onRetry={() => { void load(); }} label="Tarlayı yeniden yükle" />}
    {!loading && !error && field && <View>
      <Text>{field.name}</Text>
      {onEdit && <Pressable accessibilityRole="button" accessibilityLabel="Tarla bilgilerini düzenle" onPress={() => onEdit(field)}><Text>Düzenle</Text></Pressable>}
      {field.representativePoint && <Text>Tarla konumu: {field.representativePoint.coordinates[1].toFixed(5)}, {field.representativePoint.coordinates[0].toFixed(5)}</Text>}
      <Text>{formatCurrentBoundary(field.boundary)}</Text>
      <FieldRegionContextView context={field.regionContext} />
      {field.activeSeason && <View>
        <Text accessibilityRole="header">Aktif sezon</Text>
        {field.activeSeason.cropLabel && <Text>{field.activeSeason.cropLabel}</Text>}
        {field.activeSeason.plantingDate && <Text>Ekim tarihi: {formattedLocalDate(field.activeSeason.plantingDate)}</Text>}
      </View>}
    </View>}
  </ScrollView>;
}
