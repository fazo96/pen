"use client";

import { useSyncExternalStore } from "react";
import { isMac, shortcutList } from "@/lib/shortcuts";
import { IconKeyboard } from "./icons";

const noop = () => () => {};

/** Every keyboard shortcut, from the same table the tooltips and the palette use. */
export default function KeySettings() {
  const mac = useSyncExternalStore(noop, isMac, () => false);
  return (
    <section className="lock key-settings" aria-labelledby="keys-title">
      <div className="lock-head">
        <IconKeyboard />
        <h2 id="keys-title" className="label">
          Keyboard
        </h2>
      </div>
      <p className="lock-text">
        Esc in Construct gives the cursor back to the text; Esc in the palette goes back to where you were.
      </p>
      {shortcutList(mac).map(({ group, rows }) => (
        <dl key={group} className="keys" aria-label={group}>
          <span className="keys-group label">{group}</span>
          {rows.map(({ what, keys }) => (
            <div key={what}>
              <dt>{what}</dt>
              <dd>
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && " or "}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ))}
    </section>
  );
}
