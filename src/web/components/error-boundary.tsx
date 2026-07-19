import { Component, type CSSProperties, type ReactNode } from "react";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: unknown };

// Inline styles on purpose: the boundary must render even when the app's
// stylesheet or theme code is what crashed. Colors mirror app.css tokens
// (Floodlight Black / Stadium White / Rush Lime).
const containerStyle: CSSProperties = {
  minHeight: "100dvh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "16px",
  padding: "24px",
  background: "#07120D",
  color: "#F4FFE8",
  fontFamily: "Manrope, system-ui, sans-serif",
  textAlign: "center",
};

const buttonStyle: CSSProperties = {
  padding: "12px 24px",
  borderRadius: "9999px",
  border: "none",
  background: "#D7FF3F",
  color: "#07120D",
  fontWeight: 700,
  fontSize: "15px",
  cursor: "pointer",
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error("render error caught by ErrorBoundary", error);
  }

  render() {
    if (this.state.error !== null) {
      return (
        <div style={containerStyle} role="alert">
          <p style={{ margin: 0, fontSize: "17px" }}>
            Something broke. Reload to continue.
          </p>
          <button type="button" style={buttonStyle} onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
