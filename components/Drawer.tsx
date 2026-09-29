"use client";

import { IconClose } from "./icons";

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  head: React.ReactNode;
  foot?: React.ReactNode;
  children: React.ReactNode;
};

/** Slide-in panel on phones, permanent left rail on wide screens. */
export default function Drawer({ open, onClose, label, head, foot, children }: Props) {
  return (
    <>
      <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden />
      <nav className={`outline ${open ? "is-open" : ""}`} aria-label={label}>
        <div className="outline-head">
          {head}
          <button type="button" className="icon-btn outline-close" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </div>
        <div className="outline-body">{children}</div>
        {foot && <div className="outline-foot label">{foot}</div>}
      </nav>
    </>
  );
}
