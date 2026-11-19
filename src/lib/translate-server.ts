import { createHash } from "node:crypto";
import { db } from "@/db";
import { translationCache } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { LanguageCode } from "@/lib/i18n";

// MyMemory (https://mymemory.translated.net) is a free, keyless machine
// translation API - good enough for UI chrome, no account/billing needed.
// Chinese needs the regional "zh-CN" pair code; everything else matches our
// own language codes.
const MYMEMORY_LANGPAIR: Partial<Record<LanguageCode, string>> = {
  en: "en", es: "es", de: "de", fr: "fr", it: "it", pt: "pt", ar: "ar", hi: "hi", zh: "zh-CN", ru: "ru",
};

const hashOf = (text: string) => createHash("sha256").update(text).digest("hex");

async function translateOne(text: string, language: LanguageCode): Promise<string | null> {
  const targetLanguage = MYMEMORY_LANGPAIR[language];
  // MyMemory's `rm` code is listed for Balkan Romani, not Romansh. Leave
  // Romansh text in English until a provider with genuine Romansh support is configured.
  if (!targetLanguage) return null;
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${targetLanguage}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.responseData?.translatedText;
    if (typeof translated !== "string" || !translated.trim()) return null;
    // MyMemory sometimes echoes an error string as a "successful" translation
    // (e.g. hitting an anonymous daily quota) - detect and treat as a miss
    // rather than caching garbage.
    if (/MYMEMORY WARNING|QUOTA/i.test(translated)) return null;
    // MyMemory's translation-memory lookups occasionally surface raw markup
    // or HTML entities baked into a fuzzy-matched corpus entry (e.g.
    // "<g id=\"1\">...</g>" or a stray "&#10;") instead of plain text. Strip
    // these so the UI never shows raw markup, and treat a translation that
    // becomes empty as a miss.
    const cleaned = translated
      .replace(/<\/?[a-z][^>]*>/gi, "")
      .replace(/&#\d+;|&#x[0-9a-f]+;|&[a-z]+;/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (!cleaned) return null;
    return cleaned;
  } catch {
    return null;
  }
}

// Translates a batch of English source strings into `language`, using a
// persistent DB cache so the API is only ever called once per unique string
// per language, across every user/session forever. Returns an array aligned
// 1:1 with `texts`; any string that fails to translate falls back to the
// original English text rather than breaking the UI.
export async function translateBatch(texts: string[], language: LanguageCode): Promise<string[]> {
  const unique = Array.from(new Set(texts.filter((t) => t && t.trim())));
  if (language === "en" || unique.length === 0) return texts;

  const hashes = unique.map(hashOf);
  const cached = await db.select().from(translationCache)
    .where(and(eq(translationCache.language, language), inArray(translationCache.sourceHash, hashes)));
  const byHash = new Map(cached.map((row) => [row.sourceHash, row.translatedText]));

  const missing = unique.filter((t) => !byHash.has(hashOf(t)));

  // Light concurrency cap so we don't hammer a free public API in a burst.
  const CONCURRENCY = 6;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((t) => translateOne(t, language)));
    const rows = chunk.map((t, idx) => ({ text: t, translated: results[idx] })).filter((r) => r.translated);
    if (rows.length) {
      await db.insert(translationCache)
        .values(rows.map((r) => ({ language, sourceHash: hashOf(r.text), sourceText: r.text, translatedText: r.translated! })))
        .onConflictDoNothing();
      for (const r of rows) byHash.set(hashOf(r.text), r.translated!);
    }
  }

  return texts.map((t) => byHash.get(hashOf(t)) ?? t);
}
