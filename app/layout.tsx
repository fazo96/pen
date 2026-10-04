import type { Metadata, Viewport } from "next";
// Fonts from npm (@fontsource-variable) rather than next/font/google, so a build
// never has to reach Google; the families are named in styles/base.css.
import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
// pen's styles, one file per part of the app. Order matters (later rules win
// ties), so keep it: base, then the shared buttons and menus, then the rest in
// the order they were written in.
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/editor.css";
import "./styles/library.css";
import "./styles/drawer.css";
import "./styles/lock.css";
import "./styles/page-states.css";
import "./styles/construct.css";
import "./styles/settings.css";
import "./styles/tools.css";

export const metadata: Metadata = {
  title: "pen",
  description: "A quiet place to write.",
  appleWebApp: { capable: true, title: "pen", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android Chrome: shrink the layout when the keyboard opens so the toolbar stays visible.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3ead3" },
    { media: "(prefers-color-scheme: dark)", color: "#16130f" },
  ],
};

// Runs before paint so a stored theme, focus mode or steady chrome never flashes the wrong UI.
const themeScript = `try{var d=document.documentElement,t=localStorage.getItem("pen:theme");if(t==="light"||t==="dark")d.dataset.theme=t;if(localStorage.getItem("pen:focus"))d.dataset.focus="";if(localStorage.getItem("pen:steady"))d.dataset.steady=""}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a constant script of ours, run before paint so the theme doesn't flash */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
