import * as React from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  isLoading?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "#2563eb", color: "#ffffff", border: "1px solid #2563eb" },
  secondary: { background: "#ffffff", color: "#111827", border: "1px solid #d1d5db" },
  danger: { background: "#dc2626", color: "#ffffff", border: "1px solid #dc2626" },
  ghost: { background: "transparent", color: "#111827", border: "1px solid transparent" }
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", isLoading = false, disabled, style, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        style={{
          padding: "8px 16px",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          cursor: disabled || isLoading ? "not-allowed" : "pointer",
          opacity: disabled || isLoading ? 0.6 : 1,
          ...VARIANT_STYLES[variant],
          ...style
        }}
        {...rest}
      >
        {isLoading ? "Working..." : children}
      </button>
    );
  }
);

Button.displayName = "Button";
