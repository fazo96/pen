// The grammar checker's settings, shared by the whole library and kept in
// PEN_DIR/.pen-grammar.json: dialect, dictionary, rule switches and ignored
// flags. Pure, so the server, the browser and tests can all use it.

import type { Flag } from "./grammarText";

export const DIALECTS = ["american", "british", "australian", "canadian", "indian"] as const;
export type Dialect = (typeof DIALECTS)[number];

export type GrammarConfig = {
  dialect: Dialect;
  /** Words the spell check accepts, as added. */
  words: string[];
  /** Rules switched away from pen's defaults (see PEN_RULES), by Harper's rule name. */
  rules: Record<string, boolean>;
  /** Flags dismissed one by one: Harper's context hash of each, as a decimal string. */
  ignored: string[];
};

/** One change, as sent to PATCH /api/grammar. */
export type GrammarPatch = {
  dialect?: Dialect;
  addWord?: string;
  removeWord?: string;
  /** `on: null` puts a rule back to pen's default. */
  rule?: { name: string; on: boolean | null };
  ignore?: string;
  /** Forget every ignored flag. */
  clearIgnored?: boolean;
};

// Harper's rules that are mostly noise in fiction, off unless switched on:
// fragments, dialogue, and invented words set them off.
export const PEN_RULES: Record<string, boolean> = {
  AvoidCurses: false,
  CompoundNouns: false,
  LongSentences: false,
  MissingPreposition: false,
  ModalBeAdjective: false,
  MultipleSequentialPronouns: false,
  OxfordComma: false,
  PronounVerbAgreement: false,
  SplitWords: false,
};

export const SPELLING_RULE = "SpellCheck";

const MAX_WORDS = 10000;
const MAX_IGNORED = 10000;
const WORD_RE = /^[^\s]{1,64}$/u;
const RULE_RE = /^[A-Za-z0-9]{1,80}$/;
const HASH_RE = /^[0-9]{1,40}$/;

export const emptyConfig = (): GrammarConfig => ({ dialect: "american", words: [], rules: {}, ignored: [] });

/** How dictionary words are matched: case and a possessive ’s don't matter. */
export function dictKey(word: string): string {
  return word.normalize("NFC").replace(/['’]s$/i, "").toLowerCase();
}

/** Whether a rule is on, given the user's switches over pen's defaults (Harper's rules are on unless listed). */
export function ruleOn(config: GrammarConfig, rule: string): boolean {
  return config.rules[rule] ?? PEN_RULES[rule] ?? true;
}

/** Pen's rule switches over its defaults, as Harper takes them. */
export function effectiveRules(c: GrammarConfig): Record<string, boolean> {
  return { ...PEN_RULES, ...c.rules };
}

/** "OxfordComma" → "Oxford comma". */
export function ruleLabel(rule: string): string {
  const words = rule.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  return words.charAt(0) + words.slice(1).toLowerCase();
}

function cleanWord(w: unknown): string | null {
  if (typeof w !== "string") return null;
  const word = w.normalize("NFC").trim().replace(/^['’]+|['’]+$/g, "");
  return WORD_RE.test(word) ? word : null;
}

/** A config from untrusted JSON; anything malformed is dropped. */
export function sanitizeConfig(raw: unknown): GrammarConfig {
  const out = emptyConfig();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (DIALECTS.includes(r.dialect as Dialect)) out.dialect = r.dialect as Dialect;
  if (Array.isArray(r.words)) {
    const seen = new Set<string>();
    for (const w of r.words) {
      const word = cleanWord(w);
      if (word && !seen.has(dictKey(word))) {
        seen.add(dictKey(word));
        out.words.push(word);
      }
    }
    out.words = out.words.slice(-MAX_WORDS);
  }
  if (r.rules && typeof r.rules === "object") {
    for (const [name, on] of Object.entries(r.rules as Record<string, unknown>)) {
      if (RULE_RE.test(name) && typeof on === "boolean" && on !== (PEN_RULES[name] ?? true)) out.rules[name] = on;
    }
  }
  if (Array.isArray(r.ignored)) {
    out.ignored = [...new Set(r.ignored.filter((h): h is string => typeof h === "string" && HASH_RE.test(h)))].slice(-MAX_IGNORED);
  }
  return out;
}

/** A patch from untrusted JSON, or null if it asks for nothing valid. */
export function sanitizePatch(raw: unknown): GrammarPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const p: GrammarPatch = {};
  if (DIALECTS.includes(r.dialect as Dialect)) p.dialect = r.dialect as Dialect;
  const add = cleanWord(r.addWord);
  if (add) p.addWord = add;
  const remove = cleanWord(r.removeWord);
  if (remove) p.removeWord = remove;
  const rule = r.rule as { name?: unknown; on?: unknown } | undefined;
  if (rule && typeof rule.name === "string" && RULE_RE.test(rule.name) && (typeof rule.on === "boolean" || rule.on === null)) {
    p.rule = { name: rule.name, on: rule.on };
  }
  if (typeof r.ignore === "string" && HASH_RE.test(r.ignore)) p.ignore = r.ignore;
  if (r.clearIgnored === true) p.clearIgnored = true;
  return Object.keys(p).length ? p : null;
}

/** The config with a patch applied. */
export function applyPatch(config: GrammarConfig, p: GrammarPatch): GrammarConfig {
  const next: GrammarConfig = {
    dialect: p.dialect ?? config.dialect,
    words: config.words,
    rules: { ...config.rules },
    ignored: p.clearIgnored ? [] : config.ignored,
  };
  if (p.removeWord) {
    const key = dictKey(p.removeWord);
    next.words = next.words.filter((w) => dictKey(w) !== key);
  }
  if (p.addWord) next.words = [...next.words, p.addWord];
  if (p.rule) {
    if (p.rule.on === null) delete next.rules[p.rule.name];
    else next.rules[p.rule.name] = p.rule.on;
  }
  if (p.ignore) next.ignored = [...next.ignored, p.ignore];
  return sanitizeConfig(next);
}

/** The flags still worth showing under these settings (`dictionary` holds dictKeys). */
export function visibleFlags(flags: Flag[], config: GrammarConfig, dictionary: Set<string>, ignored: Set<string>): Flag[] {
  return flags.filter(
    (f) =>
      ruleOn(config, f.rule) &&
      !ignored.has(f.hash) &&
      !(f.rule === SPELLING_RULE && dictionary.has(dictKey(f.problem))),
  );
}
