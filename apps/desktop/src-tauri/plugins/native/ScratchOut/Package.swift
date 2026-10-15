// swift-tools-version:5.9

import PackageDescription

// Scratching out ink: the geometry alone, free of UIKit and PaperKit (only
// Foundation), so its tests run anywhere, CI's Linux too (`swift test`). The
// native plugin uses it.
let package = Package(
  name: "ScratchOut",
  platforms: [.iOS("27.0"), .macOS(.v13)],
  products: [.library(name: "ScratchOut", targets: ["ScratchOut"])],
  targets: [
    .target(name: "ScratchOut"),
    .testTarget(name: "ScratchOutTests", dependencies: ["ScratchOut"]),
  ]
)
