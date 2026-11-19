// Supported UI languages. Kept deliberately small and curated rather than
// "every language MyMemory supports" so the selector stays a clean dropdown.
// Add more here any time - no other code needs to change, the translation
// cache/API picks up new languages automatically.
export type LanguageCode = "en" | "es" | "de" | "fr" | "it" | "rm" | "pt" | "ar" | "hi" | "zh" | "ru";

export type LanguageInfo = { code: LanguageCode; label: string; nativeLabel: string; flag: string; rtl?: boolean };

export const LANGUAGES: LanguageInfo[] = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇺🇸" },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸" },
  { code: "de", label: "German", nativeLabel: "Deutsch", flag: "🇩🇪" },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "🇫🇷" },
  { code: "it", label: "Italian", nativeLabel: "Italiano", flag: "🇮🇹" },
  { code: "rm", label: "Romansh", nativeLabel: "Rumantsch", flag: "🇨🇭" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", flag: "🇵🇹" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", flag: "🇸🇦", rtl: true },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", flag: "🇮🇳" },
  { code: "zh", label: "Chinese (Simplified)", nativeLabel: "中文", flag: "🇨🇳" },
  { code: "ru", label: "Russian", nativeLabel: "Русский", flag: "🇷🇺" },
];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

export function isLanguageCode(value: string | null | undefined): value is LanguageCode {
  return !!value && LANGUAGES.some((l) => l.code === value);
}

export function languageInfo(code: string | null | undefined): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
