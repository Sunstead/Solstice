import UIKit
import WebKit

/// One of the tab bar's items, as the web side names it (`nativeTabBar`).
struct TabBarItemSpec: Decodable, Equatable {
  let id: String
  let label: String
  /// SF Symbols, plain and selected. None: `initials` drawn as a disc.
  let symbol: String?
  let selectedSymbol: String?
  let initials: String?
  /// A dot for something waiting on you (a sync to sign in again).
  let badge: Bool?
}

/// The iPhone's tab bar: UIKit's own, in iOS 26's floating Liquid Glass,
/// over the webview (the only native view above it, so its touches are its
/// own). The web side says what's in it, which is selected and when it's
/// hidden (a note pushed, the keyboard up, a sheet open); taps go back as
/// `tabBar` events, and so does how much of the screen's bottom it takes.
@MainActor
final class TabBar: NSObject, UITabBarDelegate {
  static let shared = TabBar()
  weak var plugin: NativePlugin?

  private var bar: Bar?
  private var specs: [TabBarItemSpec] = []
  private var hidden = true

  func set(_ specs: [TabBarItemSpec], selected: String?, hidden: Bool, over webview: WKWebView) {
    guard let bar = bar ?? install(over: webview) else { return }
    if specs != self.specs {
      self.specs = specs
      bar.setItems(specs.enumerated().map { Self.item($1, tag: $0) }, animated: false)
    }
    bar.selectedItem = bar.items?.first { specs.indices.contains($0.tag) && specs[$0.tag].id == selected }
    show(!hidden)
  }

  private func install(over webview: WKWebView) -> Bar? {
    guard let parent = webview.superview else { return nil }
    let bar = Bar()
    bar.delegate = self
    bar.alpha = 0
    bar.isHidden = true
    bar.onHeight = { [weak self] inset in self?.plugin?.trigger("tabBar", data: ["type": "inset", "inset": inset]) }
    bar.translatesAutoresizingMaskIntoConstraints = false
    parent.insertSubview(bar, aboveSubview: webview)
    NSLayoutConstraint.activate([
      bar.leadingAnchor.constraint(equalTo: parent.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: parent.trailingAnchor),
      bar.bottomAnchor.constraint(equalTo: parent.bottomAnchor),
    ])
    self.bar = bar
    return bar
  }

  /// Fades and drops, as UIKit's bar leaves under a pushed page, and takes
  /// no touches meanwhile.
  private func show(_ on: Bool) {
    guard let bar, on == hidden else { return }
    hidden = !on
    bar.isUserInteractionEnabled = on
    if on { bar.isHidden = false }
    UIView.animate(springDuration: 0.3, bounce: 0, options: [.beginFromCurrentState]) {
      bar.alpha = on ? 1 : 0
      bar.transform = on ? .identity : CGAffineTransform(translationX: 0, y: 12)
    } completion: { _ in
      if self.hidden { bar.isHidden = true }
    }
  }

  /// Every tap, the selected item's too (the web side takes that to its
  /// root, or its top).
  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard specs.indices.contains(item.tag) else { return }
    Haptics.play("select")
    plugin?.trigger("tabBar", data: ["type": "select", "id": specs[item.tag].id])
  }

  private static func item(_ spec: TabBarItemSpec, tag: Int) -> UITabBarItem {
    let image: UIImage?
    let selected: UIImage?
    if let initials = spec.initials {
      image = disc(initials, ring: false)
      selected = disc(initials, ring: true)
    } else {
      image = spec.symbol.flatMap { UIImage(systemName: $0) }
      selected = (spec.selectedSymbol ?? spec.symbol).flatMap { UIImage(systemName: $0) }
    }
    let item = UITabBarItem(title: spec.label, image: image, selectedImage: selected)
    item.tag = tag
    item.accessibilityLabel = spec.label
    item.badgeValue = spec.badge == true ? "" : nil
    return item
  }

  /// Initials knocked out of a disc, as a template, so the bar tints it as
  /// it tints a symbol; the selected one ringed, as You's avatar is on the web.
  private static func disc(_ initials: String, ring: Bool) -> UIImage {
    let side: CGFloat = 26
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side)).image { context in
      let cg = context.cgContext
      let inset: CGFloat = ring ? 3.5 : 1
      UIColor.black.setFill()
      if ring {
        UIColor.black.setStroke()
        let outline = UIBezierPath(ovalIn: CGRect(x: 0.75, y: 0.75, width: side - 1.5, height: side - 1.5))
        outline.lineWidth = 1.5
        outline.stroke()
      }
      UIBezierPath(ovalIn: CGRect(x: inset, y: inset, width: side - 2 * inset, height: side - 2 * inset)).fill()
      cg.setBlendMode(.clear)
      let font = UIFont.systemFont(ofSize: ring ? 9.5 : 10.5, weight: .semibold)
      let text = NSAttributedString(string: initials, attributes: [.font: font, .foregroundColor: UIColor.black])
      let size = text.size()
      text.draw(at: CGPoint(x: (side - size.width) / 2, y: (side - size.height) / 2))
    }
    return image.withRenderingMode(.alwaysTemplate)
  }

  /// Says how tall it is (what it covers of the screen's bottom, the home
  /// indicator's room included) whenever that changes.
  final class Bar: UITabBar {
    var onHeight: ((Double) -> Void)?
    private var sent: Double = -1

    override func layoutSubviews() {
      super.layoutSubviews()
      // Pinned to the bottom: its height, not its frame, which the hiding
      // transform moves.
      let inset = Double(bounds.height)
      if abs(inset - sent) >= 0.5 {
        sent = inset
        onHeight?(inset)
      }
    }
  }
}
