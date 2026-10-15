import { expect, it } from "@effect/vitest"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { collect, spawnProcess } from "./helpers/process"

// Exercise the actual packaging script with deterministic Apple-service failures.
// Signing tools are fakes; this suite verifies orchestration and failure handling.
const toolFixture = `#!/usr/bin/env python3
import base64, json, os, pathlib, shutil, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
state_file = pathlib.Path(os.environ['RELEASE_TEST_STATE'])
state = json.loads(state_file.read_text()) if state_file.exists() else {'calls': [], 'attempts': {}}
key = ''
if name == 'xcrun' and args[:1] == ['stapler']:
    key = args[1] + ':' + args[-1]
    state['attempts'][key] = state['attempts'].get(key, 0) + 1
state['calls'].append([name, *(args[:2] if name == 'xcrun' else args[:1])])
state_file.write_text(json.dumps(state))
if name == 'cargo':
    if args[:3] == ['packager', 'signer', 'sign']:
        pathlib.Path(args[-1] + '.sig').write_bytes(base64.b64encode(b'test signature'))
    else:
        app = pathlib.Path('bundle/Blackboard.app/Contents/MacOS')
        app.mkdir(parents=True)
        (app / 'blackboard').write_text('fixture executable')
        (app / 'blackboard-webkit').write_text('fixture WebKit host')
        if os.environ.get('RELEASE_TEST_DMG_SPACE') == '1':
            with (app / 'blackboard').open('wb') as output:
                output.truncate(100 * 1024 * 1024)
elif name == 'ditto':
    if args[0] == '-c': pathlib.Path(args[-1]).touch()
    else: shutil.copytree(args[0], args[1])
elif name == 'hdiutil':
    if os.environ.get('RELEASE_TEST_DMG_SPACE') == '1':
        if '-size' not in args or '-fs' not in args or args[args.index('-fs') + 1] != 'HFS+':
            print('hdiutil: create failed - No space left on device', file=sys.stderr)
            sys.exit(28)
        capacity = int(args[args.index('-size') + 1].removesuffix('m')) * 1024 * 1024
        source = pathlib.Path(args[args.index('-srcfolder') + 1])
        payload = sum(file.stat().st_size for file in source.rglob('*') if file.is_file() and not file.is_symlink())
        if capacity < payload + 64 * 1024 * 1024:
            print('hdiutil: image has insufficient space for payload and filesystem metadata', file=sys.stderr)
            sys.exit(28)
    pathlib.Path(args[-1]).touch()
elif name == 'xcrun':
    if args[:2] == ['notarytool', 'submit']:
        print(json.dumps({'status': 'Accepted', 'id': 'test-submission'}))
    elif key:
        if args[1] == os.environ['RELEASE_TEST_ACTION'] and args[-1].endswith(os.environ['RELEASE_TEST_TARGET']) and state['attempts'][key] <= int(os.environ['RELEASE_TEST_FAILURES']):
            if os.environ['RELEASE_TEST_KIND'] == 'network':
                print('error is Error Domain=NSURLErrorDomain Code=-1005 "The network connection was lost."', file=sys.stderr)
            else:
                print('The stapled ticket is invalid.', file=sys.stderr)
            print('The ' + args[1] + ' action failed! Error 68.', file=sys.stderr)
            sys.exit(68)
        print('The ' + args[1] + ' action worked!')
`

interface Scenario {
  readonly action?: "validate" | "staple"
  readonly target?: ".app" | ".dmg"
  readonly kind?: "network" | "invalid"
  readonly failures?: number
  readonly requireDmgSpace?: boolean
}
interface ToolState {
  readonly calls: string[][]
  readonly attempts: Record<string, number>
}

async function runRelease(scenario: Scenario = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blackboard-release-test-"))
  try {
    const bin = path.join(root, "bin")
    const runnerTemp = path.join(root, "runner")
    const stateFile = path.join(root, "state.json")
    await fs.mkdir(bin)
    await fs.mkdir(runnerTemp)
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ version: "0.0.5" }))
    const fixture = path.join(bin, "release-tool")
    await fs.writeFile(fixture, toolFixture, { mode: 0o755 })
    for (const tool of ["cargo", "codesign", "spctl", "ditto", "hdiutil", "xcrun", "minisign", "sleep"]) {
      await fs.symlink(fixture, path.join(bin, tool))
    }
    const child = spawnProcess("/bin/bash", [path.resolve("scripts/package-macos-release.sh")], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: runnerTemp,
        APPLE_SIGNING_IDENTITY: "fixture-identity",
        APPLE_TEAM_ID: "AAAAAAAAAA",
        APPLE_ID: "fixture@example.com",
        APPLE_APP_SPECIFIC_PASSWORD: "fixture-password",
        CARGO_PACKAGER_SIGN_PRIVATE_KEY: "fixture-key",
        CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD: "fixture-password",
        UPDATER_PUBLIC_KEY: Buffer.from("fixture-public-key").toString("base64"),
        RELEASE_TEST_STATE: stateFile,
        RELEASE_TEST_ACTION: scenario.action ?? "validate",
        RELEASE_TEST_TARGET: scenario.target ?? ".app",
        RELEASE_TEST_KIND: scenario.kind ?? "network",
        RELEASE_TEST_FAILURES: String(scenario.failures ?? 2),
        RELEASE_TEST_DMG_SPACE: scenario.requireDmgSpace ? "1" : "0",
      },
    })
    const { code, stdout, stderr } = await collect(child)
    const state: ToolState = JSON.parse(await fs.readFile(stateFile, "utf8"))
    return { code, stdout, stderr, state }
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

it("recovers from the Apple CloudKit connection loss seen after app stapling", async () => {
  const result = await runRelease()
  expect(result.code, result.stderr).toBe(0)
  expect(result.state.attempts["validate:bundle/Blackboard.app"]).toBe(3)
  expect(result.state.calls.filter((call) => call.join(" ") === "xcrun notarytool submit")).toHaveLength(2)
  expect(result.state.calls.some((call) => call[0] === "minisign")).toBe(true)
})

it("also retries transient connection loss when stapling the DMG", async () => {
  const result = await runRelease({ action: "staple", target: ".dmg" })
  expect(result.code, result.stderr).toBe(0)
  expect(result.state.attempts["staple:bundle/Blackboard-0.0.5-aarch64.dmg"]).toBe(3)
})

it("stops immediately for an invalid ticket even when stapler returns error 68", async () => {
  const result = await runRelease({ kind: "invalid" })
  expect(result.code).toBe(68)
  expect(result.state.attempts["validate:bundle/Blackboard.app"]).toBe(1)
  expect(result.state.calls.some((call) => call[0] === "sleep")).toBe(false)
  expect(result.state.calls.some((call) => call[0] === "minisign")).toBe(false)
})

it("stops after bounded retries when Apple remains unreachable", async () => {
  const result = await runRelease({ failures: 20 })
  expect(result.code).toBe(68)
  expect(result.state.attempts["validate:bundle/Blackboard.app"]).toBe(5)
  expect(result.state.calls.filter((call) => call[0] === "sleep").map((call) => call[1])).toEqual(["5", "10", "20", "40"])
  expect(result.state.calls.some((call) => call[0] === "minisign")).toBe(false)
})

it("does not delay a release when Apple succeeds on the first attempt", async () => {
  const result = await runRelease({ failures: 0 })
  expect(result.code, result.stderr).toBe(0)
  expect(result.state.calls.some((call) => call[0] === "sleep")).toBe(false)
})

it("reserves DMG filesystem space beyond the full uncompressed app payload", async () => {
  const result = await runRelease({ failures: 0, requireDmgSpace: true })
  expect(result.code, result.stderr).toBe(0)
  expect(result.state.calls.some(call => call[0] === "minisign")).toBe(true)
})
