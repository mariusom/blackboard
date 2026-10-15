import AppKit
import WebKit
import UniformTypeIdentifiers

// The host gives the canvas system WebKit rendering. Signing and verified
// updates stay in the Bun process; board frames have no native bridge access.
final class BlackboardHost: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    let address: URL
    var closing = false
    init(address: URL) { self.address = address; super.init() }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "blackboard")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 940),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Blackboard"
        window.titleVisibility = .visible
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(calibratedRed: 0.984, green: 0.984, blue: 0.976, alpha: 1)
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 900, height: 620)
        window.delegate = self
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("BlackboardWorkspace")
        installMenu()
        webView.load(URLRequest(url: address))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func installMenu() {
        let menu = NSMenu()
        let app = NSMenuItem(); menu.addItem(app)
        let appMenu = NSMenu(); app.submenu = appMenu
        appMenu.addItem(withTitle: "Quit Blackboard", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem(); menu.addItem(edit)
        let editMenu = NSMenu(title: "Edit"); edit.submenu = editMenu
        for (title, selector, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"), ("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: Selector(selector), keyEquivalent: key)
        }
        let windowItem = NSMenuItem(); menu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window"); windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        NSApp.mainMenu = menu
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if navigationAction.targetFrame?.isMainFrame == true {
            decisionHandler(url.scheme == address.scheme && url.host == address.host && url.port == address.port ? .allow : .cancel)
        } else { decisionHandler(url.scheme == "about" ? .allow : .cancel) }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == address.host,
              message.frameInfo.securityOrigin.port == address.port,
              let body = message.body as? [String: Any], body["type"] as? String == "export",
              let html = body["html"] as? String, html.utf8.count <= 2_100_000,
              let filename = body["filename"] as? String else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = String(filename.prefix(100))
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let url = panel.url else { return }
            do { try html.write(to: url, atomically: true, encoding: .utf8) }
            catch { let alert = NSAlert(error: error); alert.beginSheetModal(for: self.window) }
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard frame.isMainFrame else { completionHandler(false); return }
        let alert = NSAlert(); alert.messageText = message
        alert.addButton(withTitle: "Discard draft"); alert.addButton(withTitle: "Keep editing")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if closing { return true }
        webView.evaluateJavaScript("Boolean(window.blackboardHasUnsavedChanges?.())") { value, error in
            if value as? Bool == true {
                let alert = NSAlert(); alert.messageText = "Keep your unsaved canvas draft?"
                alert.informativeText = "Save your changes before closing Blackboard."
                alert.addButton(withTitle: "Keep editing"); alert.addButton(withTitle: "Discard and quit")
                alert.beginSheetModal(for: self.window) { response in
                    if response == .alertSecondButtonReturn { self.closing = true; self.window.close() }
                }
            } else { self.closing = true; self.window.close() }
        }
        return false
    }
    func windowWillClose(_ notification: Notification) { closing = true; NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if closing { return .terminateNow }
        window.performClose(nil); return .terminateCancel
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

guard CommandLine.arguments.count == 2, let address = URL(string: CommandLine.arguments[1]),
      address.scheme == "http", address.host == "127.0.0.1" else { exit(64) }
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let host = BlackboardHost(address: address)
application.delegate = host
application.run()
