import PaperKit
import PhotosUI
import UIKit

/// The ink ribbon's + menu (`InsertMenu` on the web side): PaperKit's own
/// shapes, text box, lines, loupe and images, inserted through the canvas's
/// own handling of Apple's insert menu (its `MarkupEditViewController`
/// delegate), so they land where PaperKit would put them, selected. Apple's
/// menu itself is never shown.
@MainActor
enum MarkupInsert {
  /// Inserts `item` (`InsertItem.id` in `lib/ink/insert.ts`) into `controller`,
  /// around `centre` (markup space) where something has to be placed by hand.
  static func insert(
    _ item: String, shape: String?, into controller: PaperMarkupViewController, features: FeatureSet,
    centre: CGPoint, presenter: UIViewController?
  ) {
    // Only an argument: PaperKit's delegate methods take the menu they came from.
    let menu = MarkupEditViewController(supportedFeatureSet: features)
    switch item {
    case "text":
      controller.markupEditViewControllerInsertNewTextbox(menu)
    case "shape":
      controller.markupEditViewController(menu, insertNewShape: Self.shape(shape))
    case "line", "arrow":
      controller.markupEditViewController(menu, insertNewLineWithStartMarker: false, endMarker: item == "arrow")
    case "loupe":
      let side: CGFloat = 160
      let frame = CGRect(x: centre.x - side / 2, y: centre.y - side / 2, width: side, height: side)
      var contents = PaperMarkup(bounds: controller.markup?.bounds ?? frame)
      contents.subelements.append(LoupeMarkup(frame: frame))
      controller.markupEditViewController(menu, insertNewContents: contents)
    case "image":
      guard let presenter else { return }
      ImagePick.present(from: presenter) { [weak controller] image in
        guard let controller, let cgImage = image.cgImage else { return }
        // Half the canvas across at most, its own shape kept.
        let bounds = controller.markup?.bounds ?? CGRect(x: 0, y: 0, width: 600, height: 600)
        let scale = min(1, bounds.width / 2 / image.size.width, bounds.height / 2 / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let frame = CGRect(x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height)
        var contents = PaperMarkup(bounds: bounds)
        contents.subelements.append(ImageMarkup(image: cgImage, frame: frame))
        controller.markupEditViewController(menu, insertNewContents: contents)
      }
    default:
      break
    }
  }

  private static func shape(_ name: String?) -> ShapeConfiguration.Shape {
    switch name {
    case "roundedRectangle": .roundedRectangle
    case "ellipse": .ellipse
    case "star": .star
    case "regularPolygon": .regularPolygon
    case "chatBubble": .chatBubble
    case "arrowShape": .arrowShape
    default: .rectangle
    }
  }
}

/// The Photos picker, for one image.
@MainActor
private final class ImagePick: NSObject, PHPickerViewControllerDelegate {
  /// The picker holds its delegate weakly.
  private static var current: ImagePick?
  private let done: (UIImage) -> Void

  private init(_ done: @escaping (UIImage) -> Void) { self.done = done }

  static func present(from presenter: UIViewController, done: @escaping (UIImage) -> Void) {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 1
    let picker = PHPickerViewController(configuration: configuration)
    let delegate = ImagePick(done)
    current = delegate
    picker.delegate = delegate
    presenter.present(picker, animated: true)
  }

  nonisolated func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    MainActor.assumeIsolated {
      picker.dismiss(animated: true)
      let done = self.done
      Self.current = nil
      guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else { return }
      provider.loadObject(ofClass: UIImage.self) { object, _ in
        guard let image = object as? UIImage else { return }
        DispatchQueue.main.async { done(image) }
      }
    }
  }
}
