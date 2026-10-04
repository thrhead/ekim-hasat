import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";

/** One polite screen-level live region, deduplicated by logical transition key. */
export function FieldStatusAnnouncement({
  transitionKey,
  message,
}: Readonly<{ transitionKey: string | null; message: string | null }>) {
  const seen = useRef(new Set<string>());
  const [current, setCurrent] = useState<{ key: string; message: string } | null>(() => {
    if (!transitionKey || !message) return null;
    seen.current.add(transitionKey);
    return { key: transitionKey, message };
  });

  useEffect(() => {
    if (!transitionKey || !message) {
      seen.current.clear();
      setCurrent(null);
      return;
    }
    if (seen.current.has(transitionKey)) return;
    seen.current.add(transitionKey);
    setCurrent({ key: transitionKey, message });
  }, [transitionKey, message]);

  if (!current) return null;
  return (
    <Text key={current.key} accessibilityRole="text" accessibilityLiveRegion="polite" allowFontScaling>
      {current.message}
    </Text>
  );
}
