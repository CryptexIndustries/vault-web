// swift-tools-version:6.0

// Runs the AutoFill extension's platform-independent code with `swift test`
// on macOS. The extension target compiles the same autofill/Core sources.
import PackageDescription

let package = Package(
    name: "CryptexAutofill",
    platforms: [.macOS(.v13)],
    dependencies: [
        // Keep in step with the SwiftProtobuf pod in autofill/pods.rb.
        .package(url: "https://github.com/apple/swift-protobuf.git", exact: "1.39.0"),
    ],
    targets: [
        .target(
            name: "AutofillCore",
            dependencies: [.product(name: "SwiftProtobuf", package: "swift-protobuf")],
            path: "autofill/Core"
        ),
        .testTarget(
            name: "AutofillCoreTests",
            dependencies: ["AutofillCore", .product(name: "SwiftProtobuf", package: "swift-protobuf")],
            path: "AutofillCoreTests",
            // Read through #filePath, like the shared URL vectors.
            exclude: ["Fixtures"]
        ),
    ],
    swiftLanguageModes: [.v5]
)
