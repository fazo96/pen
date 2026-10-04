"use client";

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { useRef, useState } from "react";
import { useDismiss } from "@/lib/useDismiss";
import { agentName, DEFAULT_AGENT } from "@/lib/construct/agentInfo";
import type { AgentModels } from "@/lib/construct/models";
import { IconDown } from "./icons";

/**
 * The model and effort pickers, folded behind one button: "Opus 5.5 · High".
 * The model list has every agent's models; another agent's starts a new chat.
 */
export default function ConstructModelMenu({
  config,
  agent,
  agents,
  disabled,
  onChange,
  onSwitch,
}: {
  config: SessionConfigOption[];
  agent: string;
  agents: AgentModels[] | null;
  disabled: boolean;
  onChange: (configId: string, value: string) => void;
  onSwitch: (agent: string, model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useDismiss(open, root, () => setOpen(false));

  const selects = config.flatMap((o) => (o.type === "select" ? [o] : []));
  const flat = (o: (typeof selects)[number]) => o.options.flatMap((opt) => ("group" in opt ? opt.options : [opt]));
  // Only what's been changed ("Opus 5.5 · High"); all defaults is "Default model".
  const summary =
    selects
      .map((o) => flat(o).find((opt) => opt.value === o.currentValue)?.name ?? String(o.currentValue))
      .filter((name) => !/^default\b/i.test(name))
      .join(" · ") || "Default model";
  const others = (agents ?? []).filter((a) => a.agent !== agent && a.models.length);
  const name = agentName(agent);

  return (
    <div className="construct-model" ref={root}>
      <button
        type="button"
        className="construct-model-btn"
        onClick={() => setOpen((x) => !x)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Model and effort"
      >
        <span>
          {agent !== DEFAULT_AGENT && `${name} · `}
          {summary}
        </span>
        <IconDown />
      </button>
      {open && (
        <div className="popover-menu construct-model-menu" role="dialog" aria-label="Model and effort">
          {selects.map((o) =>
            o.category === "model" && others.length ? (
              <label key={o.id} className="construct-select">
                <span className="label">{o.name}</span>
                <select
                  value={`${agent}\u0000${o.currentValue}`}
                  disabled={disabled}
                  onChange={(e) => {
                    const [a, value] = e.target.value.split("\u0000");
                    if (a === agent) onChange(o.id, value);
                    else {
                      setOpen(false);
                      onSwitch(a, value);
                    }
                  }}
                >
                  <optgroup label={name}>
                    {flat(o).map((opt) => (
                      <option key={opt.value} value={`${agent}\u0000${opt.value}`}>
                        {opt.name}
                      </option>
                    ))}
                  </optgroup>
                  {others.map((a) => (
                    <optgroup key={a.agent} label={`${a.name} · new chat`}>
                      {a.models.map((m) => (
                        <option key={m.value} value={`${a.agent}\u0000${m.value}`}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label key={o.id} className="construct-select">
                <span className="label">{o.name}</span>
                <select value={o.currentValue} disabled={disabled} onChange={(e) => onChange(o.id, e.target.value)}>
                  {flat(o).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </label>
            ),
          )}
          {others.length > 0 && <p className="construct-model-hint">A model of another agent starts a new chat.</p>}
        </div>
      )}
    </div>
  );
}
