import UIKit

/// The paper PDFs, notebooks and drawings are on: white, or dark (`ink.darkPaper`),
/// as in Notes and Preview. Dark paper changes how things are *shown* and
/// nothing that's saved: PencilKit keeps an ink's colour as drawn and swaps
/// its lightness when its canvas reads colours as dark,
/// so black ink is white on screen and black in the file.
enum Paper {
  /// The dark paper's colour (a page, an infinite drawing's ground).
  static let ground = UIColor(red: 0.11, green: 0.11, blue: 0.118, alpha: 1)
  /// What white text becomes on a dark page: not harsher than the ground allows.
  static let text = UIColor(white: 0.9, alpha: 1)

  static func style(dark: Bool) -> UIUserInterfaceStyle { dark ? .dark : .light }
  static func colour(dark: Bool) -> UIColor { dark ? ground : .white }
}
