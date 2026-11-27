Pod::Spec.new do |s|
  s.name           = 'CryptexIosCredentials'
  s.version        = '1.0.0'
  s.summary        = 'Registers Cryptex Vault logins with iOS AutoFill.'
  s.author         = 'Cryptex Industries'
  s.homepage       = 'https://github.com/CryptexIndustries/vault-web'
  s.license        = 'AGPL-3.0-only'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Shared/ links to the AutoFill extension's identity code in targets/autofill,
  # so the app and the extension's setup screen register the same identities.
  s.source_files = '*.swift', 'Shared/*.swift'
end
