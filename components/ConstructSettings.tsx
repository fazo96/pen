"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { type ModelSettings, type ModelUse, modelRef, parseModel } from "@/lib/construct/models";
import { useModels } from "@/lib/useModels";
import { IconConstruct } from "./icons";

const USE_LABELS: { use: ModelUse; label: string; hint: string }[] = [
  { use: "chat", label: "New chats", hint: "The model a new Construct chat starts on; each chat can change its own." },
  { use: "transcribe", label: "Transcribing notes", hint: "Reads photos of handwritten notes into the Codex. It needs a model that sees images." },
  { use: "quick", label: "Quick actions", hint: "Synonyms, Meaning and Ask Construct from the grammar check, answered in a popover." },
];

type Props = {
  /** The agents found on the server (their names); none means AI is off. */
  agents: string[];
  /** Turned off with PEN_AI=off, whatever is installed. */
  switchedOff: boolean;
};

/** Construct's section: the default models, or, with no agent on the server, how to turn AI on. */
export default function ConstructSettings({ agents, switchedOff }: Props) {
  return (
    <section className="lock" aria-labelledby="construct-title">
      <div className="lock-head">
        <IconConstruct />
        <h2 id="construct-title" className="label">
          Construct
        </h2>
      </div>
      {agents.length ? <Models found={agents} /> : <Off switchedOff={switchedOff} />}
    </section>
  );
}

function Off({ switchedOff }: { switchedOff: boolean }) {
  if (switchedOff) {
    return (
      <p className="lock-text">
        AI features are turned off on this server (<code>PEN_AI=off</code>): Construct, the Synonyms, Meaning and Ask
        buttons, and transcribing photos of handwritten notes. Unset it and restart pen to turn them on.
      </p>
    );
  }
  return (
    <>
      <p className="lock-text">
        AI features are off: Construct, the Synonyms, Meaning and Ask buttons, and transcribing photos of handwritten
        notes. They need an AI agent installed on the server running pen, and none was found. Everything else (the
        editor, Look up, grammar check) works without one.
      </p>
      <ul className="lock-text construct-off-list">
        <li>
          <a href="https://claude.com/claude-code" target="_blank" rel="noreferrer">
            Claude Code
          </a>
          : install it and sign in once with <code>claude</code>, or set <code>CLAUDE_CODE_OAUTH_TOKEN</code> (made with{" "}
          <code>claude setup-token</code>) or <code>ANTHROPIC_API_KEY</code>, as you would in Docker.
        </li>
        <li>
          <a href="https://github.com/badlogic/pi-mono" target="_blank" rel="noreferrer">
            pi
          </a>
          : install it so <code>pi</code> runs on the server (or point <code>PEN_PI</code> at it), with your models set up in
          pi.
        </li>
      </ul>
      <p className="lock-hint">pen looks for them when it starts: restart it after installing one.</p>
    </>
  );
}

/** Which model Construct uses for chats, transcriptions and the look-up buttons (the whole library). */
function Models({ found }: { found: string[] }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { agents, error: listError, refresh } = useModels();

  useEffect(() => {
    api<ModelSettings>("/api/construct/settings").then(setSettings, (e) =>
      setError(e instanceof ApiError ? "Couldn’t load the settings." : "Couldn’t reach pen."),
    );
  }, []);

  const save = async (use: ModelUse, value: string) => {
    setError(null);
    const prev = settings;
    setSettings((s) => ({ ...s, [use]: value || undefined }));
    try {
      setSettings(await api<ModelSettings>("/api/construct/settings", { method: "PATCH", json: { [use]: value } }));
    } catch {
      setSettings(prev);
      setError("Couldn’t save that.");
    }
  };

  const failed = agents?.filter((a) => a.error) ?? [];

  return (
    <>
      <p className="lock-text">
        Construct runs on Claude Code, or on pi with the models set up in pi (self-hosted ones included). Found on this
        server: {found.join(" and ")}. These defaults are shared by every book.
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
                {/* Unset is the first agent found (Claude Code when it's there). */}
                <option value="">{found[0]}’s default</option>
                {!known && <option value={current}>{model ?? agent} (not available now)</option>}
                {agents?.map((a) => (
                  <optgroup key={a.agent} label={a.name}>
                    {a.name !== found[0] && <option value={a.agent}>{a.name}’s default</option>}
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
    </>
  );
}
