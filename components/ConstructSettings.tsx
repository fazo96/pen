"use client";

import { useEffect, useState } from "react";
import { type ModelSettings, type ModelUse, modelRef, parseModel } from "@/lib/construct/models";
import { useModels } from "@/lib/useModels";
import { IconConstruct } from "./icons";

const USE_LABELS: { use: ModelUse; label: string; hint: string }[] = [
  { use: "chat", label: "New chats", hint: "The model a new Construct chat starts on; each chat can change its own." },
  { use: "transcribe", label: "Transcribing notes", hint: "Reads photos of handwritten notes into the Codex. It needs a model that sees images." },
  { use: "quick", label: "Quick actions", hint: "Synonyms, Meaning and Ask Construct from the grammar check, answered in a popover." },
];

/** Which model Construct uses for chats, transcriptions and the look-up buttons (the whole library). */
export default function ConstructSettings() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { agents, error: listError, refresh } = useModels();

  useEffect(() => {
    fetch("/api/construct/settings", { cache: "no-store" })
      .then(async (res) => (res.ok ? setSettings((await res.json()) as ModelSettings) : setError("Couldn’t load the settings.")))
      .catch(() => setError("Couldn’t reach pen."));
  }, []);

  const save = async (use: ModelUse, value: string) => {
    setError(null);
    const prev = settings;
    setSettings((s) => ({ ...s, [use]: value || undefined }));
    try {
      const res = await fetch("/api/construct/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [use]: value }),
      });
      if (!res.ok) throw new Error();
      setSettings((await res.json()) as ModelSettings);
    } catch {
      setSettings(prev);
      setError("Couldn’t save that.");
    }
  };

  const failed = agents?.filter((a) => a.error) ?? [];

  return (
    <section className="lock" aria-labelledby="construct-title">
      <div className="lock-head">
        <IconConstruct />
        <h2 id="construct-title" className="label">
          Construct
        </h2>
      </div>
      <p className="lock-text">
        Construct runs on Claude Code, or on pi with the models set up in pi (self-hosted ones included) when pi is
        installed on the server. These defaults are shared by every book.
      </p>
      {!agents && !listError && <p className="lock-hint">Asking the agents for their models…</p>}
      {listError && <p className="lock-hint">{listError}</p>}
      {failed.map((a) => (
        <p key={a.agent} className="lock-hint" role="alert">
          Couldn’t ask {a.name} for its models: {a.error}
        </p>
      ))}
      {error && (
        <p className="lock-hint" role="alert">
          {error}
        </p>
      )}

      {settings &&
        USE_LABELS.map(({ use, label, hint }) => {
          const current = settings[use] ?? "";
          const { agent, model } = parseModel(current || undefined);
          const known = !current || !!agents?.some((a) => a.agent === agent && (!model || a.models.some((m) => m.value === model)));
          return (
            <label key={use} className="field book-settings-field grammar-field construct-field">
              <span className="label">{label}</span>
              <select value={current} onChange={(e) => void save(use, e.target.value)} disabled={!agents}>
                <option value="">Claude Code’s default</option>
                {!known && <option value={current}>{model ?? agent} (not available now)</option>}
                {agents?.map((a) => (
                  <optgroup key={a.agent} label={a.name}>
                    {a.agent !== "claude" && <option value={a.agent}>{a.name}’s default</option>}
                    {a.models
                      .filter((m) => m.value !== "default")
                      .map((m) => (
                        <option key={m.value} value={modelRef(a.agent, m.value)}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <span className="lock-hint">{hint}</span>
            </label>
          );
        })}
      <div className="lock-actions">
        <button type="button" className="btn btn-quiet" onClick={refresh} disabled={!agents && !listError}>
          Look for models again
        </button>
      </div>
    </section>
  );
}
