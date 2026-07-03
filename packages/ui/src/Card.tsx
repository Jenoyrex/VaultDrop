import * as React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ style, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          background: "#ffffff",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: 24,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
          ...style
        }}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
