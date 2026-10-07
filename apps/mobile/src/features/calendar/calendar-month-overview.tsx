import { Pressable, StyleSheet, Text, View } from "react-native";

export type CalendarMonthIndicator = Readonly<{ date: string; hasWork: boolean }>;

export function CalendarMonthOverview({
  monthStart,
  indicators,
  selectedDate,
  onSelectDate,
  onChangeMonth,
}: {
  monthStart: string;
  indicators: readonly CalendarMonthIndicator[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  onChangeMonth: (offset: -1 | 1) => void;
}) {
  const firstWeekday = (new Date(`${monthStart}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  const cells: Array<CalendarMonthIndicator | null> = [...Array.from({ length: firstWeekday }, () => null), ...indicators];
  while (cells.length % 7 !== 0) cells.push(null);
  const monthLabel = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${monthStart}T00:00:00.000Z`));

  return <View accessibilityRole="summary" accessibilityLabel="Aylık iş görünümü" style={styles.container}>
    <View style={styles.heading}>
      <Pressable accessibilityRole="button" accessibilityLabel="Önceki ay" onPress={() => onChangeMonth(-1)} style={styles.monthButton}>
        <Text style={styles.monthButtonText}>Önceki</Text>
      </Pressable>
      <Text accessibilityRole="header" style={styles.monthTitle}>{monthLabel}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Sonraki ay" onPress={() => onChangeMonth(1)} style={styles.monthButton}>
        <Text style={styles.monthButtonText}>Sonraki</Text>
      </Pressable>
    </View>
    <View style={styles.grid}>
      {(["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"] as const).map((day) =>
        <Text key={day} accessibilityLabel={day} style={styles.weekday}>{day}</Text>)}
      {cells.map((indicator, index) => indicator
        ? <Pressable key={indicator.date} accessibilityRole="button"
          accessibilityLabel={`Tarihi seç: ${formatCalendarDate(indicator.date)}`}
          accessibilityHint={indicator.hasWork ? "Bu günde planlanmış iş var" : "Bu günde iş göstergesi yok"}
          accessibilityState={{ selected: indicator.date === selectedDate }}
          onPress={() => onSelectDate(indicator.date)} style={styles.day}>
          <Text style={indicator.date === selectedDate ? styles.selectedDayText : styles.dayText}>{Number(indicator.date.slice(-2))}</Text>
          {indicator.hasWork ? <View accessibilityLabel="Planlanmış iş var" style={styles.workDot} /> : <View style={styles.dotSpace} />}
        </Pressable>
        : <View key={`blank-${index}`} style={styles.day} />)}
    </View>
    <Text accessibilityLabel="İş göstergesi açıklaması" style={styles.legend}>Nokta, bu günde planlanmış iş olduğunu gösterir.</Text>
  </View>;
}

function formatCalendarDate(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

const styles = StyleSheet.create({
  container: { marginBottom: 20, paddingVertical: 8 },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  monthTitle: { color: "#17261c", fontSize: 17, fontWeight: "700", textTransform: "capitalize" },
  monthButton: { minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  monthButtonText: { color: "#285c3d", fontSize: 14, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.2857%", minHeight: 32, textAlign: "center", textAlignVertical: "center", color: "#526057", fontSize: 13, fontWeight: "600" },
  day: { width: "14.2857%", minHeight: 48, alignItems: "center", justifyContent: "center" },
  dayText: { color: "#17261c", fontSize: 15 },
  selectedDayText: { color: "#285c3d", fontSize: 15, fontWeight: "700" },
  workDot: { width: 6, height: 6, borderRadius: 3, marginTop: 2, backgroundColor: "#a74421" },
  dotSpace: { width: 6, height: 6, marginTop: 2 },
  legend: { color: "#526057", fontSize: 13, marginTop: 8 },
});
