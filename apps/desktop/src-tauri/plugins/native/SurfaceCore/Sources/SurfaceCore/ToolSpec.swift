import Foundation

/// The tool in hand, as the web side's ribbon sends it (`toNative` in
/// `lib/ink/toolbox.ts`): a kind, a colour, a width and an opacity. Read
/// leniently, since it's also the cold-start cache: anything it can't use
/// falls back to a black pen, so the Pencil always draws.
public struct ToolSpec: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, Sendable, CaseIterable {
    case pen, monoline, fountainPen, marker, pencil, crayon, watercolor, reed, eraser, lasso
  }

  public enum EraserMode: String, Codable, Sendable {
    case vector, bitmap
  }

  public var kind: Kind
  public var red: Double
  public var green: Double
  public var blue: Double
  public var width: Double
  public var opacity: Double
  public var eraser: EraserMode

  /// Each ink clamps further to its own range (`PKInkingTool.InkType.validWidthRange`).
  public static let widthRange = 0.5...100.0
  public static let opacityRange = 0.1...1.0
  public static let pen = ToolSpec(kind: .pen, red: 0, green: 0, blue: 0, width: 5, opacity: 1, eraser: .vector)

  public init(kind: Kind, red: Double, green: Double, blue: Double, width: Double, opacity: Double, eraser: EraserMode) {
    self.kind = kind
    self.red = red
    self.green = green
    self.blue = blue
    self.width = width
    self.opacity = opacity
    self.eraser = eraser
  }

  private enum CodingKeys: String, CodingKey {
    case kind, color, width, opacity, eraser
  }

  public init(from decoder: Decoder) throws {
    let fallback = ToolSpec.pen
    let values = try decoder.container(keyedBy: CodingKeys.self)
    func read<T: Decodable>(_ type: T.Type, _ key: CodingKeys) -> T? { (try? values.decodeIfPresent(type, forKey: key)) ?? nil }

    kind = read(String.self, .kind).flatMap(Kind.init(rawValue:)) ?? fallback.kind
    let rgb = read(String.self, .color).flatMap(Self.rgb(hex:)) ?? (fallback.red, fallback.green, fallback.blue)
    (red, green, blue) = rgb
    if let width = read(Double.self, .width), width.isFinite, width > 0 {
      self.width = min(max(width, Self.widthRange.lowerBound), Self.widthRange.upperBound)
    } else {
      width = fallback.width
    }
    if let opacity = read(Double.self, .opacity), opacity.isFinite {
      self.opacity = min(max(opacity, Self.opacityRange.lowerBound), Self.opacityRange.upperBound)
    } else {
      opacity = fallback.opacity
    }
    eraser = read(String.self, .eraser).flatMap(EraserMode.init(rawValue:)) ?? fallback.eraser
  }

  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(kind.rawValue, forKey: .kind)
    try values.encode(hex, forKey: .color)
    try values.encode(width, forKey: .width)
    try values.encode(opacity, forKey: .opacity)
    try values.encode(eraser.rawValue, forKey: .eraser)
  }

  /// `#rrggbb`.
  public var hex: String {
    let byte = { (v: Double) in Int((min(max(v, 0), 1) * 255).rounded()) }
    return String(format: "#%02x%02x%02x", byte(red), byte(green), byte(blue))
  }

  static func rgb(hex: String) -> (Double, Double, Double)? {
    let digits = hex.hasPrefix("#") ? hex.dropFirst() : Substring(hex)
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    return (Double((value >> 16) & 0xff) / 255, Double((value >> 8) & 0xff) / 255, Double(value & 0xff) / 255)
  }
}
