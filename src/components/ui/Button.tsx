import { LoaderCircle } from "lucide-react";

type Variant = "primary" | "secondary" | "quiet" | "danger" | "danger-solid";
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: "sm" | "md" | "lg";
  /** Shows a spinner and blocks a second submit while a server action is running. */
  loading?: boolean; loadingText?: string; icon?: React.ReactNode;
};

export default function Button({ variant = "secondary", size = "md", loading = false, loadingText, icon, children, className = "", disabled, type = "button", ...rest }: Props) {
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""} ${className}`} {...rest}>
      {loading ? <LoaderCircle size={size === "sm" ? 13 : 15} className="spin shrink-0" aria-hidden /> : icon}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
