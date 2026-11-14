# Read the vault store with the MMKV version that react-native-mmkv bundles,
# so both sides share one file format.
mmkv_version = File.read(
  File.join(__dir__, '../../node_modules/react-native-mmkv/MMKV/Core/MMKVPredef.h')
)[/MMKV_VERSION = "v([\d.]+)"/, 1] or raise 'Could not read the MMKV version from react-native-mmkv.'

pod 'MMKVAppExtension', mmkv_version, :modular_headers => true
pod 'MMKVCore', mmkv_version
# Keep in step with swift-protobuf in targets/Package.swift.
pod 'SwiftProtobuf', '1.39.0'
