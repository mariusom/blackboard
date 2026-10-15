import { Schema } from "effect"
import pkg from "../../package.json"

export const APP_VERSION: string = pkg.version

export const GITHUB_REPO = "mariusom/blackboard"

// Replaced at compile time. Update trust must not come from the downloaded feed.
declare const BLACKBOARD_UPDATER_PUBLIC_KEY: string
export const UPDATER_PUBLIC_KEY = typeof BLACKBOARD_UPDATER_PUBLIC_KEY === "undefined"
  ? ""
  : BLACKBOARD_UPDATER_PUBLIC_KEY

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

declare const UpdateErrorBrand: unique symbol
export class UpdateError extends Schema.TaggedError<
  UpdateError,
  { readonly brand: typeof UpdateErrorBrand }
>()("UpdateError", {
  message: Schema.String,
  cause: Schema.optional(Schema.String),
}) {}

export const SemVer = Schema.Struct({
  major: Schema.Finite,
  minor: Schema.Finite,
  patch: Schema.Finite,
})
export type SemVer = typeof SemVer.Type

export const ReleaseAsset = Schema.Struct({
  name: Schema.String,
  browser_download_url: Schema.String,
  size: Schema.Finite,
})
export type ReleaseAsset = typeof ReleaseAsset.Type

export const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
  assets: Schema.Array(ReleaseAsset),
})
export type GitHubRelease = typeof GitHubRelease.Type

export const UpdateStatus = Schema.Literals([
  "idle",
  "checking",
  "available",
  "up-to-date",
  "downloading",
  "installing",
  "ready-to-restart",
  "error",
])
export type UpdateStatus = typeof UpdateStatus.Type

export const UpdateInfo = Schema.Struct({
  currentVersion: Schema.String,
  latestVersion: Schema.String,
  hasUpdate: Schema.Boolean,
  downloadUrl: Schema.NullOr(Schema.String),
  releaseUrl: Schema.String,
  status: UpdateStatus,
  errorMessage: Schema.NullOr(Schema.String),
})
export type UpdateInfo = typeof UpdateInfo.Type

export function parseSemVer(versionStr: string): SemVer | null {
  const normalized = versionStr.trim().replace(/^[vV]/, "")
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(normalized)
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function isNewerVersion(currentVersion: string, candidateVersion: string): boolean {
  const current = parseSemVer(currentVersion)
  const candidate = parseSemVer(candidateVersion)
  if (!current || !candidate) {
    return false
  }
  if (candidate.major !== current.major) {
    return candidate.major > current.major
  }
  if (candidate.minor !== current.minor) {
    return candidate.minor > current.minor
  }
  return candidate.patch > current.patch
}

export function resolveTargetAppBundlePath(execPath: string): string {
  const marker = ".app/Contents/MacOS/"
  const markerIndex = execPath.indexOf(marker)
  if (markerIndex !== -1 && !execPath.includes("/Volumes/")) {
    return execPath.slice(0, markerIndex + ".app".length)
  }
  return "/Applications/Blackboard.app"
}

export const GreetingItem = Schema.Struct({
  id: Schema.String,
  language: Schema.String,
  greeting: Schema.String,
  subtitle: Schema.String,
  flag: Schema.String,
  accentColor: Schema.String,
})
export type GreetingItem = typeof GreetingItem.Type

export const TelemetryEvent = Schema.Struct({
  id: Schema.Finite,
  timestamp: Schema.String,
  action: Schema.String,
  details: Schema.String,
  level: Schema.Literals(["info", "success", "warn"]),
})
export type TelemetryEvent = typeof TelemetryEvent.Type

export const AppThemeConfig = Schema.Struct({
  id: Schema.Literals(["charcoal", "midnight", "slate"]),
  name: Schema.String,
  background: Schema.String,
  cardBg: Schema.String,
  cardBorder: Schema.String,
  textPrimary: Schema.String,
  textSecondary: Schema.String,
  buttonBg: Schema.String,
})
export type AppThemeConfig = typeof AppThemeConfig.Type

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
