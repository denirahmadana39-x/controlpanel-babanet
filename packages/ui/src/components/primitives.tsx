import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:outline-indigo-600 disabled:hover:bg-indigo-600",
  secondary:
    "bg-slate-800 text-slate-200 hover:bg-slate-700 focus-visible:outline-slate-500 disabled:hover:bg-slate-800",
  danger:
    "bg-red-600 text-white hover:bg-red-500 focus-visible:outline-red-600 disabled:hover:bg-red-600",
  ghost: "text-slate-400 hover:bg-slate-800 hover:text-slate-200 focus-visible:outline-slate-500",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  loading,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type={type}
      disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${buttonVariants[variant]} ${className ?? ""}`}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : null}
      {rest.children}
    </button>
  );
}

export function Input({
  className,
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
        invalid
          ? "border-red-500/70 focus:ring-red-500/40"
          : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/40"
      } ${className ?? ""}`}
      {...rest}
    />
  );
}

export function Textarea({
  className,
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`w-full rounded-lg border bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 ${
        invalid
          ? "border-red-500/70 focus:ring-red-500/40"
          : "border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/40"
      } ${className ?? ""}`}
      {...rest}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-300">{label}</span>
      {children}
      {hint && !error ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      {error ? <span className="block text-xs text-red-400">{error}</span> : null}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-xl border border-slate-800 bg-slate-900/60 shadow-sm ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
      <div className="space-y-0.5">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        {description ? <p className="text-xs text-slate-400">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`px-5 py-4 ${className ?? ""}`}>{children}</div>;
}

export type BadgeTone = "gray" | "green" | "red" | "amber" | "indigo";

const badgeTones: Record<BadgeTone, string> = {
  gray: "bg-slate-800 text-slate-300",
  green: "bg-emerald-500/15 text-emerald-400",
  red: "bg-red-500/15 text-red-400",
  amber: "bg-amber-500/15 text-amber-400",
  indigo: "bg-indigo-500/15 text-indigo-300",
};

export function Badge({ tone = "gray", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Spinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dimension = size === "sm" ? "h-4 w-4" : size === "lg" ? "h-8 w-8" : "h-5 w-5";
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-spin rounded-full border-2 border-slate-700 border-t-indigo-400 ${dimension}`}
    />
  );
}

export type AlertTone = "error" | "success" | "info";

const alertTones: Record<AlertTone, string> = {
  error: "border-red-500/40 bg-red-500/10 text-red-300",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  info: "border-indigo-500/40 bg-indigo-500/10 text-indigo-300",
};

export function Alert({
  tone = "error",
  title,
  children,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${alertTones[tone]}`}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={title ? "mt-1 opacity-90" : ""}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-slate-600">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-xs text-slate-400">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  const bounded = Math.min(100, Math.max(0, percent));
  const color = bounded >= 90 ? "bg-red-500" : bounded >= 70 ? "bg-amber-500" : "bg-indigo-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${bounded}%` }} />
    </div>
  );
}
