function normalizedHex(value: string) {
  const hex = value.replace("#", "");
  if (hex.length === 3) {
    return hex
      .split("")
      .map((character) => character.repeat(2))
      .join("");
  }
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`Invalid hexadecimal color: ${value}`);
  }
  return hex;
}

function relativeLuminance(color: string) {
  const hex = normalizedHex(color);
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWcagAa(foreground: string, background: string, largeText = false) {
  return contrastRatio(foreground, background) >= (largeText ? 3 : 4.5);
}
