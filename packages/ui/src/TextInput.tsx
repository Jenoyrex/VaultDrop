import * as React from "react";

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  errorMessage?: string;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ label, errorMessage, id, style, ...rest }, ref) => {
    const inputId = id ?? rest.name;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
        {label !== undefined && (
          <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: errorMessage ? "1px solid #dc2626" : "1px solid #d1d5db",
            fontSize: 14,
            outline: "none",
            ...style
          }}
          {...rest}
        />
        {errorMessage !== undefined && (
          <span style={{ fontSize: 12, color: "#dc2626" }}>{errorMessage}</span>
        )}
      </div>
    );
  }
);

TextInput.displayName = "TextInput";
