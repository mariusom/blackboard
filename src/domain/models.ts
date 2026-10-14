import { Schema } from "effect"

declare const GreetingErrorBrand: unique symbol
export class GreetingError extends Schema.TaggedError<
  GreetingError,
  { readonly brand: typeof GreetingErrorBrand }
>()("GreetingError", {
  message: Schema.String,
  index: Schema.optional(Schema.Finite),
}) {}

declare const CounterErrorBrand: unique symbol
export class CounterError extends Schema.TaggedError<
  CounterError,
  { readonly brand: typeof CounterErrorBrand }
>()("CounterError", {
  message: Schema.String,
  current: Schema.Finite,
}) {}

export interface GreetingItem {
  readonly id: string
  readonly language: string
  readonly greeting: string
  readonly subtitle: string
  readonly flag: string
  readonly accentColor: string
}

export interface TelemetryEvent {
  readonly id: number
  readonly timestamp: string
  readonly action: string
  readonly details: string
  readonly level: "info" | "success" | "warn"
}

export interface AppThemeConfig {
  readonly id: "charcoal" | "midnight" | "slate"
  readonly name: string
  readonly background: string
  readonly cardBg: string
  readonly cardBorder: string
  readonly textPrimary: string
  readonly textSecondary: string
  readonly buttonBg: string
}

export const APP_THEMES: Record<AppThemeConfig["id"], AppThemeConfig> = {
  charcoal: {
    id: "charcoal",
    name: "Charcoal Dark",
    background: "#18181b",
    cardBg: "#27272a",
    cardBorder: "#3f3f46",
    textPrimary: "#fafafa",
    textSecondary: "#a1a1aa",
    buttonBg: "#3f3f46",
  },
  midnight: {
    id: "midnight",
    name: "Midnight Blue",
    background: "#0f172a",
    cardBg: "#1e293b",
    cardBorder: "#334155",
    textPrimary: "#f8fafc",
    textSecondary: "#94a3b8",
    buttonBg: "#334155",
  },
  slate: {
    id: "slate",
    name: "Deep Slate",
    background: "#09090b",
    cardBg: "#18181b",
    cardBorder: "#27272a",
    textPrimary: "#ffffff",
    textSecondary: "#71717a",
    buttonBg: "#27272a",
  },
}

export const INITIAL_GREETINGS: readonly GreetingItem[] = [
  {
    id: "en",
    language: "English",
    greeting: "Hello, World!",
    subtitle: "Built with GPUIX, Bun, TypeScript 7 & Effect v4",
    flag: "🇺🇸",
    accentColor: "#38bdf8",
  },
  {
    id: "es",
    language: "Español",
    greeting: "¡Hola, Mundo!",
    subtitle: "Aplicación de escritorio nativa acelerada por GPU",
    flag: "🇪🇸",
    accentColor: "#f59e0b",
  },
  {
    id: "fr",
    language: "Français",
    greeting: "Bonjour le Monde!",
    subtitle: "Expérience fluide avec Effect v4 et le typage strict",
    flag: "🇫🇷",
    accentColor: "#ec4899",
  },
  {
    id: "ja",
    language: "日本語",
    greeting: "こんにちは、世界！",
    subtitle: "BunとEffect v4による超高速デスクトップ体験",
    flag: "🇯🇵",
    accentColor: "#ef4444",
  },
  {
    id: "de",
    language: "Deutsch",
    greeting: "Hallo, Welt!",
    subtitle: "Moderne native Desktop-Architektur mit GPUIX",
    flag: "🇩🇪",
    accentColor: "#10b981",
  },
  {
    id: "it",
    language: "Italiano",
    greeting: "Ciao, Mondo!",
    subtitle: "Prestazioni elevate e programmazione funzionale pura",
    flag: "🇮🇹",
    accentColor: "#8b5cf6",
  },
  {
    id: "sv",
    language: "Svenska",
    greeting: "Hej Värld!",
    subtitle: "Kompakt och blixtsnabb skrivbordsapplikation",
    flag: "🇸🇪",
    accentColor: "#06b6d4",
  },
]
