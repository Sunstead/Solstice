import CoreSpotlight
import ObjectiveC
import Tauri
import UIKit
import UniformTypeIdentifiers

/// What iOS asks the app to do from outside it: a Home Screen quick action
/// (New Note, Search) or a note chosen in Spotlight. Kept until the web side
/// asks (`launchActions`), since a cold launch's arrives before the page is
/// up; later ones are sent as `launch` events too.
@MainActor
enum Launch {
  static weak var plugin: NativePlugin?
  private static var pending: [[String: String]] = []
  /// The web side has asked once, so it's listening from here on.
  private static var listening = false

  static func deliver(_ action: [String: String]) {
    if listening, let plugin {
      plugin.trigger("launch", data: action.mapValues { $0 as JSValue })
    } else {
      pending.append(action)
    }
  }

  /// What came before the web side was listening, once.
  static func take() -> [[String: String]] {
    listening = true
    defer { pending = [] }
    return pending
  }

  // -- Quick actions ---------------------------------------------------------

  /// New Note and Search on the app's icon, as Notes has.
  static func setQuickActions() {
    UIApplication.shared.shortcutItems = [
      UIApplicationShortcutItem(
        type: "new-note", localizedTitle: "New Note", localizedSubtitle: nil,
        icon: UIApplicationShortcutIcon(systemImageName: "square.and.pencil")),
      UIApplicationShortcutItem(
        type: "search", localizedTitle: "Search", localizedSubtitle: nil,
        icon: UIApplicationShortcutIcon(systemImageName: "magnifyingglass")),
    ]
  }

  static func shortcut(_ item: UIApplicationShortcutItem) {
    deliver(["type": "shortcut", "id": item.type])
  }

  // -- Spotlight -------------------------------------------------------------

  /// A note to show in Spotlight: its file, its name, the folder it's in.
  struct Note: Decodable {
    let path: String
    let title: String
    let folder: String
  }

  /// The notes of `workspace`, in place of those indexed before for it.
  static func index(_ notes: [Note], workspace: String) {
    let items = notes.map { note in
      let attributes = CSSearchableItemAttributeSet(contentType: .text)
      attributes.title = note.title
      attributes.contentDescription = note.folder
      return CSSearchableItem(uniqueIdentifier: note.path, domainIdentifier: workspace, attributeSet: attributes)
    }
    let index = CSSearchableIndex.default()
    index.deleteSearchableItems(withDomainIdentifiers: [workspace]) { _ in
      index.indexSearchableItems(items) { error in
        if let error { surfaceLog.error("spotlight: \(error.localizedDescription, privacy: .public)") }
      }
    }
  }

  /// A Spotlight result was chosen: its note opens.
  static func continued(_ activity: NSUserActivity) -> Bool {
    guard activity.activityType == CSSearchableItemActionType,
      let path = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String
    else { return false }
    deliver(["type": "open", "path": path])
    return true
  }

  // -- Hooks -----------------------------------------------------------------

  /// Before any scene connects (from the app's `run`, through Rust): a cold
  /// launch's quick action or Spotlight result is only ever in the
  /// connection options, which the scene delegate (tao's) gets and drops.
  /// So whichever class becomes a scene's delegate gets ours around its own.
  static func installHooks() {
    // UIKit makes the delegate from the configuration's class, and may set
    // it without the setter: the class is taken as it's read.
    replaceMethod(of: UISceneConfiguration.self, #selector(getter: UISceneConfiguration.delegateClass)) { original in
      typealias Get = @convention(c) (UISceneConfiguration, Selector) -> AnyClass?
      let get = unsafeBitCast(original, to: Get.self)
      let block: @convention(block) (UISceneConfiguration) -> AnyClass? = { configuration in
        let cls = get(configuration, #selector(getter: UISceneConfiguration.delegateClass))
        if let cls { MainActor.assumeIsolated { hook(cls) } }
        return cls
      }
      return block
    }
    replaceMethod(of: UIScene.self, #selector(setter: UIScene.delegate)) { original in
      typealias Set = @convention(c) (UIScene, Selector, UISceneDelegate?) -> Void
      let set = unsafeBitCast(original, to: Set.self)
      let block: @convention(block) (UIScene, UISceneDelegate?) -> Void = { scene, delegate in
        if let delegate { MainActor.assumeIsolated { hook(realClass(of: delegate)) } }
        set(scene, #selector(setter: UIScene.delegate), delegate)
      }
      return block
    }
  }

  private static var hooked: Set<ObjectIdentifier> = []

  /// The scenes already connected (the plugin loaded after a hook could
  /// catch their delegate's class): a warm launch's actions still arrive.
  static func hookConnected() {
    for scene in UIApplication.shared.connectedScenes {
      if let delegate = scene.delegate { hook(realClass(of: delegate)) }
    }
  }

  private static func hook(_ cls: AnyClass) {
    // The app's own (tao's), never UIKit's private ones (the keyboard's scene).
    guard !NSStringFromClass(cls).hasPrefix("_UI"), !hooked.contains(ObjectIdentifier(cls)) else { return }
    hooked.insert(ObjectIdentifier(cls))
    surfaceLog.info("launch hooks on \(NSStringFromClass(cls), privacy: .public)")

    let connect = #selector(UISceneDelegate.scene(_:willConnectTo:options:))
    replaceMethod(of: cls, connect) { original in
      typealias Connect = @convention(c) (AnyObject, Selector, UIScene, UISceneSession, UIScene.ConnectionOptions) -> Void
      let call = unsafeBitCast(original, to: Connect.self)
      let block: @convention(block) (AnyObject, UIScene, UISceneSession, UIScene.ConnectionOptions) -> Void = {
        delegate, scene, session, options in
        MainActor.assumeIsolated {
          if let item = options.shortcutItem { shortcut(item) }
          for activity in options.userActivities { _ = continued(activity) }
        }
        call(delegate, connect, scene, session, options)
      }
      return block
    }

    let resume = #selector(UISceneDelegate.scene(_:continue:))
    replaceMethod(of: cls, resume) { original in
      typealias Resume = @convention(c) (AnyObject, Selector, UIScene, NSUserActivity) -> Void
      let call = unsafeBitCast(original, to: Resume.self)
      let block: @convention(block) (AnyObject, UIScene, NSUserActivity) -> Void = { delegate, scene, activity in
        let ours = MainActor.assumeIsolated { continued(activity) }
        if !ours { call(delegate, resume, scene, activity) }
      }
      return block
    }

    // tao's delegate has none of its own: added, not replaced.
    let quick = #selector(UIWindowSceneDelegate.windowScene(_:performActionFor:completionHandler:))
    let perform: @convention(block) (AnyObject, UIWindowScene, UIApplicationShortcutItem, @escaping (Bool) -> Void) -> Void = {
      _, _, item, done in
      MainActor.assumeIsolated { shortcut(item) }
      done(true)
    }
    class_addMethod(cls, quick, imp_implementationWithBlock(perform), "v@:@@@?")
  }
}

/// Called from the app's `run` before UIKit starts (`tauri_plugin_solstice_native::early`).
@_cdecl("solstice_native_early")
func solsticeNativeEarly() {
  MainActor.assumeIsolated { Launch.installHooks() }
}

/// The system's accessibility settings the page can't read for itself
/// (WebKit has no `prefers-reduced-transparency`), sent now and on change.
@MainActor
enum AccessibilityStatus {
  static func current() -> [String: Bool] {
    [
      "reduceTransparency": UIAccessibility.isReduceTransparencyEnabled,
      "increaseContrast": UIAccessibility.isDarkerSystemColorsEnabled,
      "reduceMotion": UIAccessibility.isReduceMotionEnabled,
    ]
  }

  static func follow(_ send: @escaping ([String: Bool]) -> Void) {
    let names = [
      UIAccessibility.reduceTransparencyStatusDidChangeNotification,
      UIAccessibility.darkerSystemColorsStatusDidChangeNotification,
      UIAccessibility.reduceMotionStatusDidChangeNotification,
    ]
    for name in names {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
        MainActor.assumeIsolated { send(current()) }
      }
    }
  }
}
