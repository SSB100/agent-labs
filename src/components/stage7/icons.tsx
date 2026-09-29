import type { ReactNode, SVGProps } from "react";

export type CoreIconName =
  | "accounts"
  | "activity"
  | "artifacts"
  | "browser"
  | "building"
  | "dashboard"
  | "history"
  | "lab"
  | "metrics"
  | "needs-you"
  | "products"
  | "settings"
  | "workflow";

type CoreIconProps = SVGProps<SVGSVGElement> & {
  name: CoreIconName;
};

export function CoreIcon({ name, ...props }: CoreIconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
  };

  const paths: Record<CoreIconName, ReactNode> = {
    accounts: (
      <>
        <path d="M5 7.5h14v10H5z" />
        <path d="M8 5h8M8 20h8M8.5 11h7M8.5 14h4" />
      </>
    ),
    activity: (
      <>
        <path d="M3.5 12h4l2-5 4.5 10 2-5h4.5" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    artifacts: (
      <>
        <path d="M6 3.5h8l4 4V20H6z" />
        <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
      </>
    ),
    browser: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M3.5 9h17M7 6.75h.01M10 6.75h.01" />
      </>
    ),
    building: (
      <>
        <path d="M5 20V5h9v15M14 9h5v11M8 8h3M8 11h3M8 14h3M8 17h3M16.5 12h.01M16.5 15h.01" />
      </>
    ),
    dashboard: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
        <rect x="13.5" y="11" width="7" height="9.5" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    history: (
      <>
        <path d="M4 7v5h5" />
        <path d="M5.2 16.5A8 8 0 1 0 4.5 8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    lab: (
      <>
        <path d="M9 3.5h6M10 3.5v5l-5 9a2 2 0 0 0 1.75 3h10.5A2 2 0 0 0 19 17.5l-5-9v-5" />
        <path d="M7.5 14h9" />
      </>
    ),
    metrics: (
      <>
        <path d="M4 20V10M10 20V5M16 20v-7M22 20V8" />
        <path d="M3 20h19" />
      </>
    ),
    "needs-you": (
      <>
        <path d="M12 3.5 21 20H3z" />
        <path d="M12 9v4M12 16.5h.01" />
      </>
    ),
    products: (
      <>
        <path d="m4 7 8-4 8 4-8 4z" />
        <path d="m4 7v10l8 4 8-4V7M12 11v10" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .35 1.9l.05.05-2.83 2.83-.05-.05A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.08A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.9.35l-.05.05-2.83-2.83.05-.05A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.08A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.35-1.9l-.05-.05 2.83-2.83.05.05A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.08A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.9-.35l.05-.05 2.83 2.83-.05.05A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.08v4h-.08a1.7 1.7 0 0 0-1.7 1z" />
      </>
    ),
    workflow: (
      <>
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <path d="M8.5 6h5A4.5 4.5 0 0 1 18 10.5V15M15.5 18h-5A4.5 4.5 0 0 1 6 13.5V9" />
      </>
    ),
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...common} {...props}>
      {paths[name]}
    </svg>
  );
}
