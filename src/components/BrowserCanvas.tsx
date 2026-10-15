import React from "react"
import type { AppThemeConfig } from "../domain/models"
import type { CanvasElement } from "../domain/canvas"

interface BrowserCanvasProps {
  readonly elements: readonly CanvasElement[]
  readonly theme: AppThemeConfig
  readonly url: string
  readonly onRemoveElement: (id: string) => void
}

function elementTitle(tag: CanvasElement["tag"]): string {
  switch (tag) {
    case "h1":
      return "H1"
    case "h2":
      return "H2"
    case "h3":
      return "H3"
    case "p":
    case "text":
      return "¶"
    case "button":
      return "▣"
    case "badge":
      return "✦"
    case "card":
      return "▦"
    case "image":
      return "🖼"
    case "divider":
      return "―"
    case "code":
      return "</>"
  }
}

function CanvasNode({ element, theme }: { element: CanvasElement; theme: AppThemeConfig }) {
  const style = element.style ?? {}
  const ink = style.color ?? "#111827"
  const muted = "#6b7280"

  switch (element.tag) {
    case "h1":
      return (
        <div style={{ display: "flex", flexDirection: "row", gap: 10, alignItems: "center" }}>
          {element.glyph ? <text style={{ color: ink, fontSize: 28 }}>{element.glyph}</text> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <text style={{ color: ink, fontSize: style.fontSize ?? 26, fontWeight: "bold" }}>
              {element.text}
            </text>
            {element.subtitle ? (
              <text style={{ color: muted, fontSize: 13 }}>{element.subtitle}</text>
            ) : null}
          </div>
        </div>
      )
    case "h2":
      return (
        <text style={{ color: ink, fontSize: style.fontSize ?? 20, fontWeight: "bold" }}>
          {element.glyph ? `${element.glyph} ` : ""}{element.text}
        </text>
      )
    case "h3":
      return (
        <text style={{ color: ink, fontSize: style.fontSize ?? 16, fontWeight: "bold" }}>
          {element.glyph ? `${element.glyph} ` : ""}{element.text}
        </text>
      )
    case "button":
      return (
        <div
          style={{
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 16,
            paddingRight: 16,
            borderRadius: style.borderRadius ?? 8,
            backgroundColor: style.background ?? "#2563eb",
          }}
        >
          <text style={{ color: style.color ?? "#ffffff", fontSize: style.fontSize ?? 13, fontWeight: "bold" }}>
            {element.text}
          </text>
        </div>
      )
    case "badge":
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
            paddingTop: 4,
            paddingBottom: 4,
            paddingLeft: 10,
            paddingRight: 10,
            borderRadius: style.borderRadius ?? 999,
            backgroundColor: style.background ?? "#f3f4f6",
          }}
        >
          {element.glyph ? (
            <text style={{ color: style.color ?? ink, fontSize: 12 }}>{element.glyph}</text>
          ) : null}
          <text style={{ color: style.color ?? ink, fontSize: style.fontSize ?? 12, fontWeight: "bold" }}>
            {element.text}
          </text>
          {element.subtitle ? (
            <text style={{ color: style.color ?? muted, fontSize: 11 }}>{element.subtitle}</text>
          ) : null}
        </div>
      )
    case "card":
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            backgroundColor: style.background ?? "#f9fafb",
            borderRadius: style.borderRadius ?? 10,
            borderWidth: style.borderWidth ?? 1,
            borderColor: style.borderColor ?? "#e5e7eb",
            padding: style.padding ?? 12,
          }}
        >
          <div style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "center" }}>
            {element.glyph ? <text style={{ color: ink, fontSize: 18 }}>{element.glyph}</text> : null}
            <text style={{ color: ink, fontSize: style.fontSize ?? 14, fontWeight: "bold" }}>
              {element.text}
            </text>
          </div>
          {element.subtitle ? <text style={{ color: muted, fontSize: 12 }}>{element.subtitle}</text> : null}
        </div>
      )
    case "image":
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            alignItems: "center",
            backgroundColor: style.background ?? "#f3f4f6",
            borderRadius: style.borderRadius ?? 10,
            padding: style.padding ?? 18,
          }}
        >
          <text style={{ color: ink, fontSize: 32 }}>{element.glyph ?? "🖼"}</text>
          <text style={{ color: ink, fontSize: style.fontSize ?? 13, fontWeight: "bold" }}>
            {element.text}
          </text>
          {element.subtitle ? <text style={{ color: muted, fontSize: 11 }}>{element.subtitle}</text> : null}
        </div>
      )
    case "divider":
      return (
        <div style={{ height: 1, backgroundColor: style.background ?? "#e5e7eb", width: "100%" }} />
      )
    case "code":
      return (
        <div
          style={{
            backgroundColor: style.background ?? "#111827",
            borderRadius: style.borderRadius ?? 8,
            padding: style.padding ?? 10,
          }}
        >
          <text style={{ color: style.color ?? "#e5e7eb", fontSize: style.fontSize ?? 12 }}>
            {element.text}
          </text>
        </div>
      )
    case "p":
    case "text":
    default:
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <text style={{ color: ink, fontSize: style.fontSize ?? 13 }}>
            {element.glyph ? `${element.glyph} ` : ""}{element.text}
          </text>
          {element.subtitle ? <text style={{ color: muted, fontSize: 12 }}>{element.subtitle}</text> : null}
        </div>
      )
  }
}

export function BrowserCanvas({ elements, theme, url, onRemoveElement }: BrowserCanvasProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
        backgroundColor: theme.cardBg,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.cardBorder,
        overflow: "hidden",
      }}
    >
      {/* Browser chrome */}
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 10,
          borderBottomWidth: 1,
          borderColor: theme.cardBorder,
          backgroundColor: theme.background,
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#ef4444" }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#f59e0b" }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#10b981" }} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            flexGrow: 1,
            backgroundColor: theme.cardBg,
            borderRadius: 7,
            borderWidth: 1,
            borderColor: theme.cardBorder,
            paddingTop: 5,
            paddingBottom: 5,
            paddingLeft: 10,
            paddingRight: 10,
            gap: 6,
          }}
        >
          <text style={{ color: "#10b981", fontSize: 11 }}>●</text>
          <text style={{ color: theme.textSecondary, fontSize: 11 }}>{url}</text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", gap: 6, alignItems: "center" }}>
          <text style={{ color: theme.textSecondary, fontSize: 11 }}>
            {elements.length} {elements.length === 1 ? "node" : "nodes"}
          </text>
        </div>
      </div>

      {/* Viewport — the canvas page itself (light document surface) */}
      <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, overflow: "scroll" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            backgroundColor: "#ffffff",
            padding: 20,
            margin: 12,
            borderRadius: 10,
            minHeight: 320,
          }}
        >
          {elements.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", paddingTop: 40 }}>
              <text style={{ color: "#9ca3af", fontSize: 36 }}>◌</text>
              <text style={{ color: "#111827", fontSize: 15, fontWeight: "bold" }}>
                Blank canvas
              </text>
              <text style={{ color: "#6b7280", fontSize: 12 }}>
                Populate via MCP: canvas_set_page or canvas_create_element
              </text>
              <text style={{ color: "#9ca3af", fontSize: 11 }}>
                {"bun src/mcp-main.ts · canvas://blackboard/elements"}
              </text>
            </div>
          ) : (
            elements.map((element) => (
              <div key={element.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <text style={{ color: "#9ca3af", fontSize: 10, fontWeight: "bold" }}>
                    {elementTitle(element.tag)} · {element.id}
                  </text>
                  <div onClick={() => onRemoveElement(element.id)} style={{ cursor: "pointer" }}>
                    <text style={{ color: "#d1d5db", fontSize: 10 }}>✕ remove</text>
                  </div>
                </div>
                <CanvasNode element={element} theme={theme} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
