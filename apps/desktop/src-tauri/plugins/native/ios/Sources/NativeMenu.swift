import ObjectiveC
import Tauri
import UIKit

/// The iPad's menu bar (and the shortcuts overlay you get by holding ⌘), from
/// the same menus the Mac's menu bar is built from (`get_menu_layout`, sent
/// by the webview). An item runs its command in the webview, as a menu click
/// does on the Mac.
enum NativeMenu {
  struct Menu: Decodable {
    let title: String
    let entries: [Entry]
  }

  enum Entry: Decodable {
    case command(id: String, label: String, accelerator: String?)
    case submenu(title: String, entries: [Entry])
    case separator
    case other

    private struct Command: Decodable {
      let id: String
      let label: String
      let accelerator: String?
    }
    private struct Submenu: Decodable {
      let title: String
      let entries: [Entry]
    }
    private enum Key: String, CodingKey { case Command, Submenu }

    init(from decoder: Decoder) throws {
      if let text = try? decoder.singleValueContainer().decode(String.self) {
        self = text == "Separator" ? .separator : .other
        return
      }
      let container = try decoder.container(keyedBy: Key.self)
      if let command = try container.decodeIfPresent(Command.self, forKey: .Command) {
        self = .command(id: command.id, label: command.label, accelerator: command.accelerator)
      } else if let submenu = try container.decodeIfPresent(Submenu.self, forKey: .Submenu) {
        self = .submenu(title: submenu.title, entries: submenu.entries)
      } else {
        // Undo, Copy and the like: iPadOS's own Edit menu has them.
        self = .other
      }
    }
  }

  private static var menus: [Menu] = []
  private static weak var plugin: NativePlugin?
  private static var installed = false

  static func set(_ menus: [Menu], plugin: NativePlugin) {
    self.menus = menus
    self.plugin = plugin
    install()
    UIMenuSystem.main.setNeedsRebuild()
  }

  /// Teaches the app to build the menu and run its items. UIKit asks
  /// UIApplication (and a delegate that's a responder, which tao's isn't), so
  /// the application's class adds ours to the menu and gets the method its
  /// items call. On its class, never by changing it (`MethodHooks.swift`).
  private static func install() {
    guard !installed else { return }
    installed = true
    install(on: UIApplication.shared)
  }

  /// `install`, on any responder (a test's stand-in for the application).
  static func install(on app: UIResponder) {
    let cls = realClass(of: app)
    let selector = #selector(UIResponder.buildMenu(with:))
    replaceMethod(of: cls, selector) { original in
      typealias Build = @convention(c) (AnyObject, Selector, UIMenuBuilder) -> Void
      let build = unsafeBitCast(original, to: Build.self)
      let block: @convention(block) (AnyObject, UIMenuBuilder) -> Void = { this, builder in
        build(this, selector, builder)
        NativeMenu.build(builder)
      }
      return block
    }
    let run: @convention(block) (AnyObject, UICommand) -> Void = { _, command in
      guard let id = command.propertyList as? String else { return }
      NativeMenu.plugin?.trigger("menu", data: ["id": id])
    }
    class_addMethod(cls, action, imp_implementationWithBlock(run), "v@:@")
  }

  private static let action = NSSelectorFromString("solsticeMenuCommand:")

  private static func build(_ builder: UIMenuBuilder) {
    guard builder.system == .main else { return }
    let standard: [String: UIMenu.Identifier] = [
      "File": .file, "Edit": .edit, "Format": .format, "View": .view, "Window": .window, "Help": .help,
    ]
    // iPadOS's menus have shortcuts of their own (Find ⌘F, Bold ⌘B, Open ⌘O
    // and so on), and a second command with the same keys is an exception
    // that ends the app. Where ours does the same job, the system's goes.
    var taken: [Shortcut: UIKeyCommand] = [:]
    if let root = builder.menu(for: .root) { collect(root, into: &taken) }
    var used = Set<Shortcut>()
    let shortcut = { (command: UIKeyCommand) -> Bool in
      guard let input = command.input else { return false }
      let key = Shortcut(input: input, flags: command.modifierFlags)
      if let system = taken.removeValue(forKey: key) {
        guard let action = system.action else { return false }
        builder.remove(command: action, propertyList: system.propertyList)
      }
      return used.insert(key).inserted
    }

    var after: UIMenu.Identifier = .view
    for menu in menus {
      let children = elements(menu.entries, shortcut: shortcut)
      guard !children.isEmpty else { continue }
      if let id = standard[menu.title], builder.menu(for: id) != nil {
        // Ours first, then what iPadOS puts there itself.
        builder.replaceChildren(ofMenu: id) { existing in
          [UIMenu(options: .displayInline, children: children)] + existing
        }
      } else {
        let id = UIMenu.Identifier("com.sunstead.solstice.\(menu.title)")
        builder.remove(menu: id)
        builder.insertSibling(UIMenu(title: menu.title, identifier: id, children: children), afterMenu: after)
        after = id
      }
    }
  }

  /// A key and its modifiers, as UIKit compares them.
  private struct Shortcut: Hashable {
    let input: String
    let flags: Int

    init(input: String, flags: UIKeyModifierFlags) {
      self.input = input.lowercased()
      self.flags = flags.rawValue
    }
  }

  private static func collect(_ menu: UIMenu, into shortcuts: inout [Shortcut: UIKeyCommand]) {
    for child in menu.children {
      if let command = child as? UIKeyCommand, let input = command.input {
        shortcuts[Shortcut(input: input, flags: command.modifierFlags)] = command
      } else if let submenu = child as? UIMenu {
        collect(submenu, into: &shortcuts)
      }
    }
  }

  /// Separators become inline groups, as iPadOS draws them. `shortcut` says
  /// whether a key command may keep its keys.
  private static func elements(_ entries: [Entry], shortcut: (UIKeyCommand) -> Bool) -> [UIMenuElement] {
    var groups: [[UIMenuElement]] = [[]]
    for entry in entries {
      switch entry {
      case .command(let id, let label, let accelerator):
        var element = command(id: id, label: label, accelerator: accelerator)
        if let key = element as? UIKeyCommand, !shortcut(key) {
          element = UICommand(title: label, action: action, propertyList: id)
        }
        groups[groups.count - 1].append(element)
      case .submenu(let title, let entries):
        let children = elements(entries, shortcut: shortcut)
        if !children.isEmpty { groups[groups.count - 1].append(UIMenu(title: title, children: children)) }
      case .separator:
        if !groups[groups.count - 1].isEmpty { groups.append([]) }
      case .other:
        break
      }
    }
    let filled = groups.filter { !$0.isEmpty }
    if filled.count == 1 { return filled[0] }
    return filled.map { UIMenu(options: .displayInline, children: $0) }
  }

  private static func command(id: String, label: String, accelerator: String?) -> UIMenuElement {
    // A board's keys (N, F) are plain letters: as menu shortcuts they'd be
    // taken from every text field.
    if !id.hasPrefix("canvas."), let accelerator, let (input, flags) = parse(accelerator) {
      return UIKeyCommand(title: label, action: action, input: input, modifierFlags: flags, propertyList: id)
    }
    return UICommand(title: label, action: action, propertyList: id)
  }

  /// "CmdOrCtrl+Shift+E" as UIKit's key and modifiers.
  static func parse(_ accelerator: String) -> (String, UIKeyModifierFlags)? {
    var parts = accelerator.split(separator: "+").map(String.init)
    guard let key = parts.popLast() else { return nil }
    var flags: UIKeyModifierFlags = []
    for part in parts {
      switch part.lowercased() {
      case "cmdorctrl", "cmd", "command", "super", "meta": flags.insert(.command)
      case "ctrl", "control": flags.insert(.control)
      case "alt", "option": flags.insert(.alternate)
      case "shift": flags.insert(.shift)
      default: return nil
      }
    }
    let named: [String: String] = [
      "arrowleft": UIKeyCommand.inputLeftArrow, "arrowright": UIKeyCommand.inputRightArrow,
      "arrowup": UIKeyCommand.inputUpArrow, "arrowdown": UIKeyCommand.inputDownArrow,
      "escape": UIKeyCommand.inputEscape, "enter": "\r", "return": "\r", "tab": "\t",
      "space": " ", "backspace": "\u{8}", "delete": UIKeyCommand.inputDelete,
      "pageup": UIKeyCommand.inputPageUp, "pagedown": UIKeyCommand.inputPageDown,
      "home": UIKeyCommand.inputHome, "end": UIKeyCommand.inputEnd,
    ]
    if let input = named[key.lowercased()] { return (input, flags) }
    guard key.count == 1 else { return nil }
    return (key.lowercased(), flags)
  }
}
