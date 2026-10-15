import { Layer, Logger } from "effect"
import { NodeRuntime, NodeStdio } from "@effect/platform-node"
import { CanvasMcpStdioLive } from "./mcp/server"

// Logs must go to stderr — stdout is the MCP protocol channel.
const MainLive = CanvasMcpStdioLive.pipe(
  Layer.provide(NodeStdio.layer),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
)

Layer.launch(MainLive).pipe(NodeRuntime.runMain)
