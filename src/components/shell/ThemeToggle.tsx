"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "mandate-theme";
const current = (): "light" | "dark" => {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

/** Follows the system until the user picks; the pick is remembered in this browser. */
export default function ThemeToggle({ withLabel = false, className = "" }: { withLabel?: boolean; className?: string }) {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    setTheme(current());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setTheme(current());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const flip = () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice lasts for this page */ }
    setTheme(next);
  };
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button type="button" onClick={flip} className={`btn btn-quiet ${withLabel ? "" : "btn-sm !px-2"} ${className}`} aria-label={withLabel ? undefined : label} title={withLabel ? undefined : label}>
      {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
      {withLabel && (theme === "dark" ? "Light theme" : "Dark theme")}
    </button>
  );
}
