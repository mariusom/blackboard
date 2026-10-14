import { Context, Effect, Layer, Ref } from "effect"
import { APP_THEMES, type AppThemeConfig } from "../domain/models"

export interface ThemeServiceShape {
  readonly getTheme: Effect.Effect<AppThemeConfig>
  readonly cycleTheme: Effect.Effect<AppThemeConfig>
  readonly setTheme: (id: AppThemeConfig["id"]) => Effect.Effect<AppThemeConfig>
}

const themeOrder: readonly AppThemeConfig["id"][] = ["charcoal", "midnight", "slate"]

export class ThemeService extends Context.Service<
  ThemeService,
  ThemeServiceShape
>()("blackboard/ThemeService") {
  static readonly layer = Layer.effect(
    ThemeService,
    Effect.gen(function* () {
      const activeThemeRef = yield* Ref.make<AppThemeConfig["id"]>("charcoal")

      const getTheme = Effect.gen(function* () {
        const id = yield* Ref.get(activeThemeRef)
        return APP_THEMES[id]
      })

      const cycleTheme = Effect.gen(function* () {
        const currentId = yield* Ref.get(activeThemeRef)
        const currentIndex = themeOrder.indexOf(currentId)
        const nextId = themeOrder[(currentIndex + 1) % themeOrder.length]
        yield* Ref.set(activeThemeRef, nextId)
        return APP_THEMES[nextId]
      })

      const setTheme = Effect.fn("ThemeService.setTheme")(function* (id: AppThemeConfig["id"]) {
        yield* Ref.set(activeThemeRef, id)
        return APP_THEMES[id]
      })

      return ThemeService.of({
        getTheme,
        cycleTheme,
        setTheme,
      })
    })
  )
}
