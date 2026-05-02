// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "AthenaOverlay",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "AthenaOverlay", targets: ["AthenaOverlay"])
    ],
    targets: [
        .executableTarget(
            name: "AthenaOverlay",
            path: "Sources/AthenaOverlay"
        )
    ]
)
