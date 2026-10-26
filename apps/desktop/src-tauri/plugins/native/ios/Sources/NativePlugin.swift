import SurfaceCore
import Tauri
import UIKit
import WebKit

struct UrlArgs: Decodable {
  let url: String
}

struct SurfaceArgs: Decodable {
  let op: String
  let id: String
  let kind: String?
  let path: String?
  let x: Double?
  let y: Double?
  let width: Double?
  let height: Double?
  let visible: Bool?
  /// A Zen switch's phase for this surface (`beginSurfaceEase`): `hold`
  /// takes the frame and keeps the content where it was, `play` eases it,
  /// `end` puts it where it belongs.
  let ease: String?
  let rgb: [Double]?
  let query: String?
  let caseSensitive: Bool?
  let wholeWord: Bool?
  let direction: Int?
  let page: Int?
  let ink: Bool?
  let on: Bool?
}

struct HostArgs: Decodable {
  struct Rect: Decodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
  }
  let op: String
  let modal: Bool?
  let rects: [Rect]?
  let rgb: [Double]?
  let path: String?
  let template: String?
  let menus: [NativeMenu.Menu]?
  let on: Bool?
  let scratchOut: Bool?
  let darkPaper: Bool?
  /// For `ink`: the theme's ground (`--background`) dark paper is painted with.
  let paper: [Double]?
  let paths: [String]?
  let html: String?
  let page: PageSpec?
  let anchor: Rect?
  let kind: String?
  /// For `tool`: the slot in hand (`toNative` in `lib/ink/toolbox.ts`).
  let tool: ToolSpec?
  /// For `insert`: what (`InsertItem` in `lib/ink/insert.ts`), and which shape.
  let item: String?
  let shape: String?
  /// For the page sheet: a page, a thumbnail's width, the pages' new order.
  let index: Int?
  let width: Double?
  let order: [Int]?
  /// For `alert`: what it says and its buttons.
  let title: String?
  let message: String?
  let actions: [AlertAction]?
  /// For `pickDate`: the date to start on.
  let date: DateParts?
  /// For `tabBar`: its items, which is selected, and whether it shows.
  let items: [TabBarItemSpec]?
  let selected: String?
  let hidden: Bool?
  /// For `tabBar`: a web sheet or menu is over it, and takes its touches.
  let covered: Bool?
  /// For `spotlight`: a workspace's notes, which replace those indexed for it.
  let notes: [Launch.Note]?
  let workspace: String?
}

class NativePlugin: Plugin {
  let auth = AuthenticationSheet()
  private var host: SurfaceHost?
  private var fit: WebviewFit?
  private var pencilTaps: PencilTaps?
  private weak var webview: WKWebView?

  override func load(webview: WKWebView) {
    self.webview = webview
    DispatchQueue.main.async {
      self.host = SurfaceHost.install(under: webview)
      self.fit = WebviewFit(webview, plugin: self)
      self.pencilTaps = PencilTaps(webview) { [weak self] at in
        guard let self, let webview = self.webview, let point = self.cssPoint(at, from: webview) else { return }
        self.trigger("pencilTap", data: ["x": Double(point.x), "y": Double(point.y)])
      }
      Ink.shared.plugin = self
      TabBar.shared.plugin = self
      Launch.plugin = self
      Launch.setQuickActions()
      Launch.hookConnected()
      AccessibilityStatus.follow { [weak self] status in
        self?.trigger("accessibility", data: status.mapValues { $0 as JSValue })
      }
      if let parent = webview.superview { Ink.shared.listen(in: parent) }
    }
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(leaving), name: UIApplication.willResignActiveNotification, object: nil)
    center.addObserver(
      self, selector: #selector(memoryWarning), name: UIApplication.didReceiveMemoryWarningNotification, object: nil)
  }

  /// PencilKit and PDFKit let their drawn tiles go on one: canvases blink
  /// as they draw again. Logged, so a blink can be told from other causes.
  @objc private func memoryWarning() {
    surfaceLog.warning("memory warning, \(self.host?.surfaces.count ?? 0) surfaces open")
  }

  /// Saves what the surfaces hold before iOS can suspend the app.
  @objc private func leaving() {
    let app = UIApplication.shared
    var task = UIBackgroundTaskIdentifier.invalid
    task = app.beginBackgroundTask { app.endBackgroundTask(task) }
    guard let host else { return app.endBackgroundTask(task) }
    host.flushAll { app.endBackgroundTask(task) }
  }

  /// A rect in the webview's CSS pixels (from `getBoundingClientRect`), in
  /// the host's points: the viewport starts below the scroll view's insets,
  /// however far the page has scrolled.
  private func hostRect(x: Double, y: Double, width: Double, height: Double) -> CGRect {
    guard let webview, let host else { return .zero }
    let inset = webview.scrollView.adjustedContentInset
    let rect = CGRect(x: x + inset.left, y: y + inset.top, width: width, height: height)
    return webview.convert(rect, to: host)
  }

  /// A point in `view`, in the webview's CSS pixels: `hostRect`'s inverse.
  func cssPoint(_ point: CGPoint, from view: UIView) -> CGPoint? {
    guard let webview else { return nil }
    let inset = webview.scrollView.adjustedContentInset
    let local = view.convert(point, to: webview)
    return CGPoint(x: local.x - inset.left, y: local.y - inset.top)
  }

  @objc public func surface(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SurfaceArgs.self)
    DispatchQueue.main.async {
      guard let host = self.host else {
        invoke.reject("Native views aren't available.")
        return
      }
      switch args.op {
      case "open":
        guard let path = args.path else { return invoke.reject("No path.") }
        switch args.kind {
        case "pdf": host.add(PdfSurface(id: args.id, path: path, plugin: self))
        case "drawing": host.add(DrawingSurface(id: args.id, path: path, plugin: self))
        case "image": host.add(ImageSurface(id: args.id, path: path, plugin: self))
        default: return invoke.reject("No such surface: \(args.kind ?? "")")
        }
      case "frame":
        guard let surface = host.surfaces[args.id] else { break }
        let rect = self.hostRect(
          x: args.x ?? 0, y: args.y ?? 0, width: args.width ?? 0, height: args.height ?? 0)
        if args.ease == "hold" { surface.easeHold(to: rect) } else { surface.place(rect) }
        surface.isHidden = !(args.visible ?? false)
        // What shows round the content (a PDF's margins): the pane's colour,
        // while the host behind the page may be the window's (Islands).
        if let rgb = args.rgb, rgb.count >= 3, !surface.paintsOwnGround {
          surface.backgroundColor = UIColor(
            red: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255, alpha: 1)
        }
      case "ease":
        guard let surface = host.surfaces[args.id] else { break }
        if args.ease == "play" { surface.easePlay() } else { surface.easeEnd() }
      case "reload":
        host.surfaces[args.id]?.reload()
      case "recentre":
        host.surfaces[args.id]?.recentre()
      case "find":
        // Reading handwriting takes a moment: answered when it's done.
        let surface = host.surfaces[args.id]
        Task { @MainActor in
          let count =
            await surface?.find(
              args.query ?? "", caseSensitive: args.caseSensitive ?? false,
              wholeWord: args.wholeWord ?? false) ?? 0
          invoke.resolve(["count": count, "active": count > 0 ? 0 : -1])
        }
        return
      case "findStep":
        let active = host.surfaces[args.id]?.findStep(args.direction ?? 1) ?? -1
        return invoke.resolve(["active": active])
      case "findPage":
        let active = host.surfaces[args.id]?.findPage(args.page ?? 0, ink: args.ink ?? false) ?? -1
        return invoke.resolve(["active": active])
      case "close":
        host.remove(args.id)
      default:
        return invoke.reject("No such operation: \(args.op)")
      }
      invoke.resolve()
    }
  }

  /// Where a share sheet points: the CSS rect it came from, in the webview's
  /// points, or the top middle when there's none.
  private func shareRect(_ anchor: HostArgs.Rect?, in webview: WKWebView) -> CGRect {
    let inset = webview.scrollView.adjustedContentInset
    guard let anchor else { return CGRect(x: webview.bounds.midX, y: inset.top, width: 1, height: 1) }
    return CGRect(x: anchor.x + inset.left, y: anchor.y + inset.top, width: anchor.width, height: anchor.height)
  }

  @objc public func host(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(HostArgs.self)
    // Kept for the next launch, whether or not the host is up yet.
    if args.op == "launchColour" {
      if let rgb = args.rgb, rgb.count >= 3 { SurfaceHost.launchColour = rgb }
      return invoke.resolve()
    }
    if args.op == "appearance" {
      SurfaceHost.launchDark = args.on
      DispatchQueue.main.async { SurfaceHost.applyAppearance(to: self.webview?.window) }
      return invoke.resolve()
    }
    DispatchQueue.main.async {
      guard let host = self.host else { return invoke.resolve() }
      switch args.op {
      case "share":
        guard let paths = args.paths, let webview = self.webview,
          let presenter = self.manager.viewController
        else { return invoke.reject("Nothing to share from.") }
        let rect = self.shareRect(args.anchor, in: webview)
        // A PDF open here sends with the marks just made.
        host.flushAll {
          Share.present(paths.map { URL(fileURLWithPath: $0) }, from: rect, in: webview, by: presenter) {
            invoke.resolve()
          }
        }
        return
      case "exportFiles":
        guard let paths = args.paths, let presenter = self.manager.viewController else {
          return invoke.reject("Nothing to save from.")
        }
        host.flushAll {
          Share.export(paths.map { URL(fileURLWithPath: $0) }, by: presenter) { saved in
            invoke.resolve(["saved": saved])
          }
        }
        return
      case "pdf":
        guard let html = args.html, let page = args.page, let path = args.path else {
          return invoke.reject("No page to print.")
        }
        Task { @MainActor in
          do {
            try await PdfPrinter.render(html: html, page: page, to: URL(fileURLWithPath: path))
            invoke.resolve()
          } catch {
            invoke.reject("Couldn't make the PDF: \(error.localizedDescription)")
          }
        }
        return
      case "overlays":
        host.webModal = args.modal ?? false
        host.webRects = (args.rects ?? []).map {
          self.hostRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
        }
      case "menu":
        NativeMenu.set(args.menus ?? [], plugin: self)
      case "webFocus":
        // Web text took focus (typing wins the tools), or lost it.
        Ink.shared.webFocus(args.on ?? false)
      case "haptic":
        // Feedback for a gesture the web drives; no `kind` only warms the engine.
        if let kind = args.kind { Haptics.play(kind) } else { Haptics.prepare() }
      case "expectTyping":
        // A finger tapped text to type: the keyboard, not Scribble's
        // seconds of waiting for the Pencil.
        UITextInputContext.current().isPencilInputExpected = false
      case "tool":
        // The ribbon's slot in hand, on every canvas.
        if let tool = args.tool { Ink.shared.setTool(tool) }
      case "ruler":
        Ink.shared.setRuler(args.on ?? false)
      case "fingerDraws":
        Ink.shared.setFingerDraws(args.on ?? false)
      case "undo":
        Ink.shared.undo()
      case "redo":
        Ink.shared.redo()
      case "undoState":
        Ink.shared.sendUndo(force: true)
      case "insert":
        // The ribbon's +: text, shapes, lines, a loupe, an image (Add Page in a PDF).
        Ink.shared.current?.insert(args.item ?? "", shape: args.shape)
      case "pages":
        // The page sheet: how many, and which is in view.
        let pages = Ink.shared.current?.pages ?? (count: 0, current: 0)
        return invoke.resolve(["count": pages.count, "current": pages.current])
      case "thumbnail":
        let surface = Ink.shared.current
        Task { @MainActor in
          let url = await surface?.thumbnail(args.index ?? 0, width: CGFloat(args.width ?? 160))
          invoke.resolve(["url": url ?? ""])
        }
        return
      case "goToPage":
        Ink.shared.current?.goToPage(args.index ?? 0)
      case "arrangePages":
        guard let surface = Ink.shared.current, let order = args.order else { break }
        Task { @MainActor in
          if let failure = await surface.arrangePages(order) {
            invoke.reject(failure)
          } else {
            invoke.resolve()
          }
        }
        return
      case "pickColor":
        guard let webview = self.webview, let presenter = self.manager.viewController else { break }
        Ink.shared.pickColor(from: self.shareRect(args.anchor, in: webview), in: webview, by: presenter)
      case "ink":
        if let scratchOut = args.scratchOut { Ink.shared.scratchOut = scratchOut }
        if let darkPaper = args.darkPaper { Ink.shared.setDarkPaper(darkPaper) }
        if let paper = args.paper { Ink.shared.setPaper(paper) }
      case "notebook":
        guard let path = args.path else { return invoke.reject("No path.") }
        do {
          try Notebook.create(at: URL(fileURLWithPath: path), template: args.template ?? "blank")
        } catch {
          return invoke.reject("Couldn't make the notebook: \(error.localizedDescription)")
        }
      case "alert":
        guard let presenter = self.manager.viewController else { return invoke.reject("Nothing to show it from.") }
        Pickers.alert(
          title: args.title ?? "", message: args.message, actions: args.actions ?? [], by: presenter
        ) { id in
          invoke.resolve(["id": id ?? ""])
        }
        return
      case "pickDate":
        guard let date = args.date, let webview = self.webview, let presenter = self.manager.viewController else {
          return invoke.reject("No date to pick.")
        }
        Pickers.date(date, from: self.shareRect(args.anchor, in: webview), in: webview, by: presenter) { parts in
          guard let parts else { return invoke.resolve(["picked": false]) }
          var answer: JSObject = ["picked": true, "year": parts.year, "month": parts.month, "day": parts.day]
          if let hour = parts.hour, let minute = parts.minute {
            answer["hour"] = hour
            answer["minute"] = minute
          }
          invoke.resolve(answer)
        }
        return
      case "pickPhotos", "pickDocuments":
        guard let presenter = self.manager.viewController else { return invoke.reject("Nothing to pick from.") }
        let done: ([String]) -> Void = { paths in invoke.resolve(["paths": paths]) }
        if args.op == "pickPhotos" {
          Pickers.photos(by: presenter, done: done)
        } else {
          Pickers.documents(by: presenter, done: done)
        }
        return
      case "launchActions":
        // What iOS asked of the app before the page was listening.
        return invoke.resolve(["actions": Launch.take().map { $0.mapValues { $0 as JSValue } }])
      case "accessibility":
        return invoke.resolve(AccessibilityStatus.current().mapValues { $0 as JSValue })
      case "spotlight":
        guard let workspace = args.workspace else { break }
        Launch.index(args.notes ?? [], workspace: workspace)
      case "tabBar":
        guard let webview = self.webview else { break }
        TabBar.shared.set(
          args.items ?? [], selected: args.selected, hidden: args.hidden ?? true, covered: args.covered ?? false,
          under: webview)
      case "background":
        if let rgb = args.rgb, rgb.count >= 3 {
          host.backgroundColor = UIColor(
            red: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255, alpha: 1)
        }

      default:
        return invoke.reject("No such operation: \(args.op)")
      }
      invoke.resolve()
    }
  }
}

@_cdecl("init_plugin_solstice_native")
func initPlugin() -> Plugin {
  return NativePlugin()
}
