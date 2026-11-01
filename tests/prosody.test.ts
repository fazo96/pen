import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compactCmu } from "../lib/cmudictBuild.ts";
import { analyze, type Dict, parseCompact } from "../lib/prosody/index.ts";
import { applyProsodyPatch, emptyProsody, sanitizeProsody, sanitizeProsodyPatch } from "../lib/prosody/own.ts";
import { rhymeOf, soundName, syllables } from "../lib/prosody/phones.ts";
import { wordsOf } from "../lib/prosody/words.ts";

const table = parseCompact(compactCmu(readFileSync(new URL("./fixtures/cmudict-mini.dict", import.meta.url), "utf8")));
const dict = (own: Dict["own"] = {}): Dict => ({ lookup: (k) => table.get(k), own });
const stresses = (text: string, d = dict()) => wordsOf(text, d).map((w) => w.stress).join(" ");

test("compactCmu gathers a word's pronunciations and drops comments", () => {
  const compact = compactCmu("abbe AE1 B IY0\nabbe(2) AE0 B EY1 # french\n\nzurich Z UH1 R IH0 K # place\n");
  assert.equal(compact, "abbe\tAE1 B IY0|AE0 B EY1\nzurich\tZ UH1 R IH0 K");
  assert.deepEqual(parseCompact(compact).get("abbe"), ["AE1 B IY0", "AE0 B EY1"]);
});

test("syllables split consonants between vowels as English starts syllables", () => {
  const split = (p: string) => syllables(p.split(" ")).map((s) => [...s.onset, s.vowel, "|", ...s.coda].join(" "));
  assert.deepEqual(split("S AY1 L AH0 N S"), ["S AY |", "L AH | N S"]);
  assert.deepEqual(split("EH1 K S T R AH0"), ["EH | K", "S T R AH |"], "the longest onset English allows");
  assert.deepEqual(split("S IH1 NG ER0"), ["S IH | NG", "ER |"], "no syllable starts with NG");
  assert.equal(rhymeOf("B R AY1 T".split(" ")), "AY T");
  assert.equal(rhymeOf("S AY1 L AH0 N S".split(" ")), "AY L AH N S");
  assert.equal(soundName("AY"), "eye (night)");
  assert.equal(soundName("S"), "s");
  assert.equal(soundName("AY T"), "eye-t");
});

test("words take their stress in context: function words light, other one-syllable words stressed", () => {
  assert.equal(stresses("The river ran beneath the broken stone."), "x /x / x/ x /x /");
  const of = wordsOf("of", dict())[0];
  assert.equal(of.stress, "x", "the dictionary stresses 'of'; running speech doesn't");
  assert.ok(of.light);
});

test("words the dictionary lacks are built from ones it has, or guessed", () => {
  const [way, ways, smiths, guessed, name] = wordsOf("waystone waystones Smith’s lanterned Denna", dict());
  assert.deepEqual([way.source, way.stress], ["compound", "/\\"]);
  assert.deepEqual([ways.source, ways.stress, ways.phones?.at(-1)], ["compound", "/\\", "Z"]);
  assert.deepEqual([smiths.key, smiths.source, smiths.phones?.slice(-2)], ["smith's", "ending", ["TH", "S"]]);
  assert.deepEqual([guessed.source, guessed.stress, guessed.phones?.at(-1)], ["ending", "/x", "D"]);
  assert.equal(wordsOf("walled", dict())[0].stress, "/", "-ed adds a syllable only after t or d");
  assert.equal(wordsOf("parted", dict())[0].stress, "/x");
  assert.equal(wordsOf("silenter", dict())[0].stress, "/xx");
  assert.deepEqual([name.source, name.stress, name.phones], ["guess", "/x", null]);
  assert.equal(wordsOf("Kvothe", dict())[0].stress, "/", "a silent final e");
  assert.equal(wordsOf("42", dict())[0].stress, "?");
});

test("a word the dictionary says two ways offers the other", () => {
  const [record] = wordsOf("record", dict());
  assert.equal(record.stress, "x/");
  assert.deepEqual(record.alternatives, ["/x"]);
});

test("the writer's pronunciation wins, with the sounds of the words it's like", () => {
  const own = { kvothe: { stress: "/", like: "quoth" }, denna: { stress: "/x" }, river: { stress: "x/" } };
  const [k, ks, d, r] = wordsOf("Kvothe Kvothe's Denna river", dict(own));
  assert.deepEqual([k.source, k.stress, k.phones], ["yours", "/", ["K", "W", "OW1", "TH"]]);
  assert.deepEqual([ks.source, ks.phones?.at(-1)], ["ending", "S"]);
  assert.deepEqual([d.source, d.stress, d.phones], ["yours", "/x", null]);
  assert.equal(r.stress, "x/", "over the dictionary's");
  const [w] = wordsOf("Waystone", dict({ waystone: { like: "way stone" } }));
  assert.deepEqual([w.source, w.stress], ["yours", "/\\"], "one word of a 'sounds like' leads");
});

test("words know where sentences and clauses end", () => {
  const ws = wordsOf('Mr. Smith said, "Why?" he asked. It fell', dict());
  assert.deepEqual(
    ws.map((w) => `${w.text}:${w.pause || "-"}:${w.sentence}`),
    ["Mr:-:0", "Smith:-:0", "said:clause:0", "Why:clause:0", "he:-:0", "asked:sentence:0", "It:-:1", "fell:sentence:1"],
  );
});

test("rhythmic runs: stresses one or two light syllables apart", () => {
  const iambs = analyze("The river ran beneath the broken stone.", dict());
  assert.deepEqual(iambs.runs, [{ from: 0, to: 9, feet: 5, kind: "iambic", steady: false }]);

  const anapests = analyze("In the dark of the night and the cold of the stone.", dict());
  assert.deepEqual(anapests.runs, [{ from: 0, to: 11, feet: 4, kind: "anapestic", steady: false }]);

  const falling = analyze("Silver, broken, silent river.", dict());
  assert.equal(falling.runs[0].kind, "trochaic");

  // Two stresses together ("stone wall") end one run; a short run isn't one.
  const clash = analyze("The river ran beneath the stone wall.", dict());
  assert.deepEqual(clash.runs.map((r) => [r.from, r.to, r.feet]), [[0, 7, 4]]);

  const steady = analyze("The river ran beneath the broken stone, the river ran beneath the broken stone.", dict());
  assert.equal(steady.runs[0].feet, 10);
  assert.ok(steady.runs[0].steady, "ten iambs sound like verse");

  const flipped = analyze("The river ran beneath the broken stone.", dict(), { 2: "x" });
  assert.notDeepEqual(flipped.runs, iambs.runs, "a what-if flip reads again");
});

test("a run doesn't cross a sentence or a word whose stress isn't known", () => {
  const a = analyze("The river ran beneath. The broken stone fell.", dict());
  assert.ok(a.runs.every((r) => a.words[a.syllables[r.from].word].sentence === a.words[a.syllables[r.to].word].sentence));
});

test("sounds: alliteration, assonance and rhyme among nearby words, by phoneme", () => {
  const kinds = (text: string) => analyze(text, dict()).sounds.map((g) => `${g.kind}:${g.sound}:${g.words.join(",")}${g.atEnds ? ":ends" : ""}`);
  assert.deepEqual(kinds("silver stone"), ["alliteration:S:0,1"]);
  assert.deepEqual(kinds("the night was bright"), ["rhyme:AY T:1,3"]);
  assert.deepEqual(kinds("The light was low, the night was deep."), ["alliteration:L:1,3", "rhyme:AY T:1,5"]);
  assert.deepEqual(kinds("though tough"), [], "spelled alike, said differently");
  assert.deepEqual(kinds("stone, stone, stone"), [], "a word repeated isn't an echo");
});

test("a rhyme at the ends of clauses is pointed out", () => {
  const g = analyze("It burned in the night, and the moon was bright.", dict()).sounds.find((s) => s.kind === "rhyme");
  assert.deepEqual([g?.sound, g?.atEnds], ["AY T", true]);
});

test("sentences end firm, falling, or on two stresses; openings repeat", () => {
  const a = analyze("The river ran. The night was silent. It fell in three parts. The river was still.", dict());
  assert.deepEqual(a.sentences.map((s) => s.ending), ["firm", "falling", "double", "firm"]);
  assert.deepEqual(a.sentences.map((s) => s.syllables), [4, 5, 5, 5]);
  assert.deepEqual(a.openings, [{ text: "The river", sentences: [0, 3] }]);
  assert.deepEqual(analyze("The night fell. The stone fell.", dict()).openings, [], "'The' alone is no anaphora");
});

test("the writer's pronunciations: sanitized and patched", () => {
  assert.deepEqual(sanitizeProsody({ words: { Kvothe: { stress: "/" }, "two words": { stress: "/" }, bad: { stress: "!" }, x: 1 } }), {
    words: { kvothe: { stress: "/" } },
  });
  assert.equal(sanitizeProsodyPatch({ set: { word: "Kvothe" } }), null, "a word needs a stress or a sounds-like");
  assert.deepEqual(sanitizeProsodyPatch({ set: { word: "Kvothe’s", like: "  Quoth  " } }), { set: { word: "kvothe's", like: "quoth" } });
  let c = applyProsodyPatch(emptyProsody(), { set: { word: "denna", stress: "/x" } });
  c = applyProsodyPatch(c, { set: { word: "kvothe", stress: "/" } });
  c = applyProsodyPatch(c, { set: { word: "denna", stress: "x/" } });
  assert.deepEqual(Object.keys(c.words), ["kvothe", "denna"], "a word set again goes last");
  assert.deepEqual(applyProsodyPatch(c, { remove: "kvothe" }).words, { denna: { stress: "x/" } });
});
