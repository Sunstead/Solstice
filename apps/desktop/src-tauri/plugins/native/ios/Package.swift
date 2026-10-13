// swift-tools-version:5.9

import PackageDescription

let package = Package(
  name: "tauri-plugin-solstice-native",
  platforms: [
    .iOS("27.0")
  ],
  products: [
    .library(
      name: "tauri-plugin-solstice-native",
      type: .static,
      targets: ["tauri-plugin-solstice-native"])
  ],
  dependencies: [
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-solstice-native",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
