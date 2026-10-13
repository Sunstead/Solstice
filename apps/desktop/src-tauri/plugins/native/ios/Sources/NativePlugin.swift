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
  let query: String?
  let caseSensitive: Bool?
  let wholeWord: Bool?
  let direction: Int?
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
}

class NativePlugin: Plugin {
  let auth = AuthenticationSheet()
  private var host: SurfaceHost?
  private weak var webview: WKWebView?

  override func load(webview: WKWebView) {
    self.webview = webview
    DispatchQueue.main.async {
      self.host = SurfaceHost.install(under: webview)
    }
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(leaving), name: UIApplication.willResignActiveNotification, object: nil)
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
        default: return invoke.reject("No such surface: \(args.kind ?? "")")
        }
      case "frame":
        guard let surface = host.surfaces[args.id] else { break }
        surface.frame = self.hostRect(
          x: args.x ?? 0, y: args.y ?? 0, width: args.width ?? 0, height: args.height ?? 0)
        surface.isHidden = !(args.visible ?? false)
      case "reload":
        host.surfaces[args.id]?.reload()
      case "edit":
        host.surfaces[args.id]?.setEditing(args.on ?? false)
      case "find":
        let count =
          host.surfaces[args.id]?.find(
            args.query ?? "", caseSensitive: args.caseSensitive ?? false,
            wholeWord: args.wholeWord ?? false) ?? 0
        return invoke.resolve(["count": count, "active": count > 0 ? 0 : -1])
      case "findStep":
        let active = host.surfaces[args.id]?.findStep(args.direction ?? 1) ?? -1
        return invoke.resolve(["active": active])
      case "close":
        host.remove(args.id)
      default:
        return invoke.reject("No such operation: \(args.op)")
      }
      invoke.resolve()
    }
  }

  @objc public func host(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(HostArgs.self)
    DispatchQueue.main.async {
      guard let host = self.host else { return invoke.resolve() }
      switch args.op {
      case "overlays":
        host.webModal = args.modal ?? false
        host.webRects = (args.rects ?? []).map {
          self.hostRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height)
        }
      case "notebook":
        guard let path = args.path else { return invoke.reject("No path.") }
        do {
          try Notebook.create(at: URL(fileURLWithPath: path), template: args.template ?? "blank")
        } catch {
          return invoke.reject("Couldn't make the notebook: \(error.localizedDescription)")
        }
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
