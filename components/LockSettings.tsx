"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import SettingsHead from "./SettingsHead";
import { IconLock } from "./icons";

const MIN = 8;
type Mode = "idle" | "set" | "change" | "remove";

/** Null once done, else what went wrong. */
async function post(body: object): Promise<string | null> {
  try {
    await api("/api/auth", { method: "POST", json: body });
    return null;
  } catch (err) {
    return err instanceof ApiError ? err.message : "Can’t reach the desk. Check your connection.";
  }
}

/** The Lock setting on the home page: set, change or remove the instance password. */
export default function LockSettings({ locked }: { locked: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [insecure, setInsecure] = useState(false);

  useEffect(() => {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    setInsecure(location.protocol !== "https:" && !local);
  }, []);

  const open = (m: Mode) => {
    setMode(m);
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError(null);
    setNotice(null);
  };

  const needsNew = mode === "set" || mode === "change";
  const mismatch = needsNew && confirm.length > 0 && password !== confirm;
  const ready =
    (mode === "remove" && current.length > 0) ||
    (needsNew && password.length >= MIN && password === confirm && (mode === "set" || current.length > 0));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    const err = await post(
      mode === "set"
        ? { action: "set", password }
        : mode === "change"
          ? { action: "change", current, password }
          : { action: "remove", current },
    );
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    const done: Record<Mode, string> = {
      idle: "",
      set: "Locked. Other devices will need the password.",
      change: "Password changed. Other devices have been signed out.",
      remove: "Lock removed. Anyone who can reach this desk can use it.",
    };
    open("idle");
    setNotice(done[mode]);
    router.refresh();
  };

  const signOut = async () => {
    await post({ action: "signout" });
    window.location.assign("/unlock");
  };

  return (
    <section className="settings-section" id="lock" aria-labelledby="lock-title">
      <SettingsHead icon={<IconLock />} title="Lock" id="lock-title">
        <span className={`settings-state ${locked ? "is-locked" : ""}`}>{locked ? "On" : "Off"}</span>
      </SettingsHead>

      <p className="settings-text">
        {locked
          ? "This desk asks for a password on every new device."
          : "Anyone who can reach this desk can read and write. Set a password to require it."}
      </p>

      {mode === "idle" ? (
        <div className="settings-actions">
          {locked ? (
            <>
              <button type="button" className="btn" onClick={() => open("change")}>
                Change password
              </button>
              <button type="button" className="btn" onClick={() => open("remove")}>
                Remove lock
              </button>
              <button type="button" className="btn btn-quiet" onClick={signOut}>
                Sign out this device
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => open("set")}>
              <IconLock /> Lock this desk
            </button>
          )}
        </div>
      ) : (
        <form className="settings-form" onSubmit={submit}>
          {(mode === "change" || mode === "remove") && (
            <label className="field">
              <span className="label">Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
          )}
          {needsNew && (
            <>
              {/* Hidden username helps password managers file the entry. */}
              <input type="text" autoComplete="username" value="pen" readOnly hidden />
              <label className="field">
                <span className="label">{mode === "change" ? "New password" : "Password"}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  autoFocus={mode === "set"}
                  minLength={MIN}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="label">Repeat</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={mismatch}
                />
              </label>
              <p className="settings-hint">
                {mismatch
                  ? "The passwords don’t match."
                  : password.length > 0 && password.length < MIN
                    ? `At least ${MIN} characters.`
                    : mode === "change"
                      ? "Every other device will be signed out."
                      : `At least ${MIN} characters. This device stays signed in.`}
              </p>
            </>
          )}
          {mode === "remove" && <p className="settings-hint">The desk will open for anyone who can reach it.</p>}
          {insecure && needsNew && (
            <p className="settings-hint settings-warn">
              This page isn’t on HTTPS, so the password crosses the network readable. Fine over Tailscale; avoid
              shared Wi-Fi.
            </p>
          )}
          <div className="settings-actions">
            <button type="submit" className={`btn ${mode === "remove" ? "btn-danger" : "btn-primary"}`} disabled={!ready || busy}>
              {busy
                ? "Working…"
                : mode === "set"
                  ? "Lock"
                  : mode === "change"
                    ? "Change password"
                    : "Remove lock"}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => open("idle")} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="welcome-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
