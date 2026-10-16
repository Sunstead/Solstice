// swift-tools-version:5.9

import PackageDescription

// The native views' plain parts: saving one at a time and the geometry of
// ink, free of UIKit and PaperKit (only Foundation), so their tests run
// anywhere, CI's Linux too (`swift test`). The native plugin uses it.
let package = Package(
  name: "SurfaceCore",
  platforms: [.iOS("27.0"), .macOS(.v13)],
  products: [.library(name: "SurfaceCore", targets: ["SurfaceCore"])],
  targets: [
    .target(name: "SurfaceCore"),
    .testTarget(name: "SurfaceCoreTests", dependencies: ["SurfaceCore"]),
  ]
)
