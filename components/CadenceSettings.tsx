"use client";

import { cadence, useCadence } from "@/lib/cadenceClient";
import SettingsHead from "./SettingsHead";
import { IconCadence, IconClose } from "./icons";

/** Cadence's pronunciations of the writer's words, shared by every book. */
export default function CadenceSettings() {
  const { own } = useCadence({ ownOnly: true });
  const words = own ? Object.entries(own.words).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <section className="settings-section" aria-labelledby="cadence-title">
      <SettingsHead icon={<IconCadence />} title="Cadence" id="cadence-title" />
      <p className="settings-text">
        Cadence shows how a paragraph sounds: the stress of each word, the rhythm they make, the sounds that echo. Words
        the dictionary doesn’t know (names, invented words) can be said your way from its panel; they’re kept here, for every
        book.
      </p>
      <p className="settings-hint">
        Pronunciations from the{" "}
        <a href="https://github.com/cmusphinx/cmudict" target="_blank" rel="noreferrer">
          CMU Pronouncing Dictionary
        </a>{" "}
        (BSD license; American English).
      </p>
      {own && (
        <div className="grammar-field">
          <span className="label">Your pronunciations · {words.length.toLocaleString("en-US")}</span>
          {words.length ? (
            <ul className="grammar-words">
              {words.map(([w, p]) => (
                <li key={w} title={p.like ? `Sounds like “${p.like}”` : undefined}>
                  {w}
                  {p.stress && <span className="cadence-settings-stress">{p.stress}</span>}
                  <button type="button" onClick={() => void cadence.removeWord(w)} aria-label={`Forget how you say ${w}`}>
                    <IconClose />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-hint">Words you say your way in Cadence show up here.</p>
          )}
        </div>
      )}
    </section>
  );
}
