"use client";

import { grammar, useGrammarConfig, useGrammarEnabled } from "@/lib/grammarClient";
import { DIALECTS, PEN_RULES, ruleLabel, ruleOn, type Dialect } from "@/lib/grammarConfig";
import SettingsHead from "./SettingsHead";
import { IconClose, IconGrammar } from "./icons";

const DIALECT_LABEL: Record<Dialect, string> = {
  american: "American",
  british: "British",
  australian: "Australian",
  canadian: "Canadian",
  indian: "Indian",
};

/** The grammar checker's switch (this device), dialect, dictionary and rules (the whole library). */
export default function GrammarSettings() {
  const enabled = useGrammarEnabled();
  const config = useGrammarConfig();
  // pen's quieter defaults, then whatever else was switched from the editor.
  const rules = config ? [...new Set([...Object.keys(PEN_RULES), ...Object.keys(config.rules)])].sort() : [];

  return (
    <section className="lock" aria-labelledby="grammar-title">
      <SettingsHead icon={<IconGrammar />} title="Grammar" id="grammar-title">
        <span className="lock-state">{enabled ? "On" : "Off"} here</span>

      </SettingsHead>
      <p className="lock-text">
        Spelling and grammar are checked in your browser by Harper; the text never leaves the device. Tap an underlined
        word in the editor for fixes. The dictionary and rules below are shared by every book.
      </p>
      <p className="lock-hint">
        Look up uses{" "}
        <a href="https://en-word.net" target="_blank" rel="noreferrer">
          Open English WordNet
        </a>{" "}
        (CC BY 4.0).
      </p>
      <div className="lock-actions">
        <button type="button" className="btn" onClick={() => grammar.setEnabled(!enabled)}>
          {enabled ? "Turn off here" : "Turn on here"}
        </button>
      </div>

      {config && (
        <>
          <label className="field book-settings-field grammar-field">
            <span className="label">English</span>
            <select value={config.dialect} onChange={(e) => void grammar.update({ dialect: e.target.value as Dialect })}>
              {DIALECTS.map((d) => (
                <option key={d} value={d}>
                  {DIALECT_LABEL[d]}
                </option>
              ))}
            </select>
          </label>

          <div className="grammar-field">
            <span className="label">Dictionary · {config.words.length.toLocaleString("en-US")}</span>
            {config.words.length ? (
              <ul className="grammar-words">
                {[...config.words]
                  .sort((a, b) => a.localeCompare(b))
                  .map((w) => (
                    <li key={w}>
                      {w}
                      <button
                        type="button"
                        onClick={() => void grammar.update({ removeWord: w })}
                        aria-label={`Remove ${w} from the dictionary`}
                      >
                        <IconClose />
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="lock-hint">Words you add from the editor (names, places, invented words) show up here.</p>
            )}
          </div>

          <div className="grammar-field">
            <span className="label">Rules</span>
            <ul className="grammar-rules">
              {rules.map((r) => {
                const on = ruleOn(config, r);
                const changed = r in config.rules;
                return (
                  <li key={r}>
                    <span>
                      {ruleLabel(r)}
                      {!changed && r in PEN_RULES && <em> · off by default in pen</em>}
                    </span>
                    <button
                      type="button"
                      className={`btn btn-quiet ${on ? "is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => void grammar.update({ rule: { name: r, on: !on === (PEN_RULES[r] ?? true) ? null : !on } })}
                    >
                      {on ? "On" : "Off"}
                    </button>
                  </li>
                );
              })}
            </ul>
            {config.ignored.length > 0 && (
              <div className="lock-actions">
                <button type="button" className="btn btn-quiet" onClick={() => void grammar.update({ clearIgnored: true })}>
                  Bring back {config.ignored.length.toLocaleString("en-US")} ignored{" "}
                  {config.ignored.length === 1 ? "flag" : "flags"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
