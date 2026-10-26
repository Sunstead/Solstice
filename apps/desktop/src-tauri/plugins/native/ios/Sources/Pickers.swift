import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// One button of an alert (`Alerts.present`).
struct AlertAction: Decodable {
  let id: String
  let label: String
  /// `default`, `cancel` or `destructive`.
  let style: String?
}

/// A date, as a note's front matter writes it: no time zone, the time only
/// when it has one (`DatePick`).
struct DateParts: Codable {
  let year: Int
  let month: Int
  let day: Int
  var hour: Int?
  var minute: Int?
}

/// The system's own alerts and pickers, for what the web draws worse: a
/// centred confirmation, a date, photos, files from the Files app. Each
/// answers once, with what was chosen or nothing.
@MainActor
enum Pickers {
  /// A centred alert; `done` hears the chosen action's id.
  static func alert(
    title: String, message: String?, actions: [AlertAction], by presenter: UIViewController,
    done: @escaping (String?) -> Void
  ) {
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    for action in actions {
      let style: UIAlertAction.Style =
        switch action.style {
        case "cancel": .cancel
        case "destructive": .destructive
        default: .default
        }
      let button = UIAlertAction(title: action.label, style: style) { _ in done(action.id) }
      alert.addAction(button)
      // Return chooses it, as a lone default does on the Mac.
      if style == .default { alert.preferredAction = button }
    }
    if actions.isEmpty { alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in done(nil) }) }
    presenter.present(alert, animated: true)
  }

  /// The calendar (and the time, when `parts` has one), as a sheet on a
  /// phone and a popover from `rect` on an iPad.
  static func date(
    _ parts: DateParts, from rect: CGRect, in view: UIView, by presenter: UIViewController,
    done: @escaping (DateParts?) -> Void
  ) {
    let picker = DatePick(parts, done: done)
    let nav = UINavigationController(rootViewController: picker)
    if presenter.traitCollection.horizontalSizeClass == .regular {
      nav.modalPresentationStyle = .popover
      nav.popoverPresentationController?.sourceView = view
      nav.popoverPresentationController?.sourceRect = rect
      nav.popoverPresentationController?.delegate = picker
    } else if let sheet = nav.sheetPresentationController {
      sheet.detents = [.custom { context in min(picker.fittingHeight, context.maximumDetentValue) }]
      sheet.prefersGrabberVisible = true
      nav.presentationController?.delegate = picker
    }
    presenter.present(nav, animated: true)
  }

  /// The Photos picker, for any number of images: each copied out to a
  /// file of its own (HEIC as JPEG, which every device shows), in the
  /// order picked.
  static func photos(by presenter: UIViewController, done: @escaping ([String]) -> Void) {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 0
    configuration.selection = .ordered
    let picker = PHPickerViewController(configuration: configuration)
    let delegate = PhotosPick(done)
    PhotosPick.current = delegate
    picker.delegate = delegate
    presenter.present(picker, animated: true)
  }

  /// The Files picker, for any number of files of any kind, copied in.
  static func documents(by presenter: UIViewController, done: @escaping ([String]) -> Void) {
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
    picker.allowsMultipleSelection = true
    let delegate = DocumentsPick(done)
    DocumentsPick.current = delegate
    picker.delegate = delegate
    presenter.present(picker, animated: true)
  }

  /// A fresh folder in the temporary directory, for a pick's copies. The
  /// app copies them on into the workspace (`import_attachment`).
  nonisolated static func inbox() -> URL {
    let url = FileManager.default.temporaryDirectory.appending(path: "picked/\(UUID().uuidString)", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
}

/// The date picker's page: the inline calendar, Cancel and Done.
private final class DatePick: UIViewController, UIAdaptivePresentationControllerDelegate,
  UIPopoverPresentationControllerDelegate
{
  private let parts: DateParts
  private var done: ((DateParts?) -> Void)?
  private let picker = UIDatePicker()
  private var calendar: Calendar { Calendar.current }

  init(_ parts: DateParts, done: @escaping (DateParts?) -> Void) {
    self.parts = parts
    self.done = done
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError() }

  private var hasTime: Bool { parts.hour != nil }

  /// What the sheet needs: the calendar and the bar over it.
  var fittingHeight: CGFloat {
    loadViewIfNeeded()
    let width = view.window?.bounds.width ?? 390
    let size = picker.systemLayoutSizeFitting(
      CGSize(width: width - 32, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    return size.height + 72
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    title = hasTime ? "Date and Time" : "Date"
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.finish(nil) })
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.finish(self?.chosen) })

    picker.datePickerMode = hasTime ? .dateAndTime : .date
    picker.preferredDatePickerStyle = .inline
    var components = DateComponents()
    components.year = parts.year
    components.month = parts.month
    components.day = parts.day
    components.hour = parts.hour ?? 12
    components.minute = parts.minute ?? 0
    if let date = calendar.date(from: components) { picker.date = date }
    picker.addAction(UIAction { _ in Haptics.play("select") }, for: .valueChanged)

    picker.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(picker)
    NSLayoutConstraint.activate([
      picker.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      picker.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      picker.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
    ])
    let fitting = picker.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    preferredContentSize = CGSize(width: max(fitting.width, 320) + 32, height: fitting.height + 24)
  }

  private var chosen: DateParts {
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: picker.date)
    var parts = DateParts(year: c.year ?? parts.year, month: c.month ?? parts.month, day: c.day ?? parts.day)
    if hasTime {
      parts.hour = c.hour
      parts.minute = c.minute
    }
    return parts
  }

  private func finish(_ parts: DateParts?) {
    guard let done else { return }
    self.done = nil
    dismiss(animated: true)
    done(parts)
  }

  /// Swiped down, or tapped outside the popover: nothing chosen.
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard let done else { return }
    self.done = nil
    done(nil)
  }

  /// A popover on an iPad stays one in compact width (Slide Over) too.
  func adaptivePresentationStyle(
    for controller: UIPresentationController, traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle { .none }
}

@MainActor
private final class PhotosPick: NSObject, PHPickerViewControllerDelegate {
  /// The picker holds its delegate weakly.
  static var current: PhotosPick?
  private let done: ([String]) -> Void

  init(_ done: @escaping ([String]) -> Void) { self.done = done }

  nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    MainActor.assumeIsolated {
      picker.dismiss(animated: true)
      Self.current = nil
      let done = self.done
      let providers = results.map(\.itemProvider)
      guard !providers.isEmpty else { return done([]) }
      let inbox = Pickers.inbox()
      Task { @MainActor in
        var paths: [String] = []
        for (index, provider) in providers.enumerated() {
          if let path = await Self.copy(provider, number: index, into: inbox) { paths.append(path) }
        }
        done(paths)
      }
    }
  }

  /// The image's own file, which is gone once the provider's handler
  /// returns, so it's copied (or made JPEG) before then.
  nonisolated private static func copy(_ provider: NSItemProvider, number: Int, into inbox: URL) async -> String? {
    let type =
      provider.registeredTypeIdentifiers.compactMap { UTType($0) }.first { $0.conforms(to: .image) } ?? .image
    let name = (provider.suggestedName ?? "Photo") + (number > 0 ? " \(number + 1)" : "")
    return await withCheckedContinuation { continuation in
      provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
        continuation.resume(returning: url.flatMap { write($0, type: type, name: name, into: inbox) })
      }
    }
  }

  nonisolated private static func write(_ url: URL, type: UTType, name: String, into inbox: URL) -> String? {
    if type.conforms(to: .heic) || type.conforms(to: .heif) {
      guard let image = UIImage(contentsOfFile: url.path), let data = image.jpegData(compressionQuality: 0.9)
      else { return nil }
      let target = inbox.appending(path: "\(name).jpg")
      return (try? data.write(to: target)) != nil ? target.path : nil
    }
    let ext = url.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "png") : url.pathExtension
    let target = inbox.appending(path: "\(name).\(ext)")
    return (try? FileManager.default.copyItem(at: url, to: target)) != nil ? target.path : nil
  }
}

@MainActor
private final class DocumentsPick: NSObject, UIDocumentPickerDelegate {
  static var current: DocumentsPick?
  private let done: ([String]) -> Void

  init(_ done: @escaping ([String]) -> Void) { self.done = done }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    Self.current = nil
    done(urls.map(\.path))
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    Self.current = nil
    done([])
  }
}
