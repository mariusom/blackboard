import { Layer, ManagedRuntime } from "effect"
import { GreetingService } from "./GreetingService"
import { CounterService } from "./CounterService"
import { ActivityService } from "./ActivityService"
import { ThemeService } from "./ThemeService"

export const AppLiveLayer = Layer.mergeAll(
  GreetingService.layer,
  CounterService.layer,
  ActivityService.layer,
  ThemeService.layer
)

export type AppServices =
  | GreetingService
  | CounterService
  | ActivityService
  | ThemeService

export const appRuntime = ManagedRuntime.make(AppLiveLayer)
