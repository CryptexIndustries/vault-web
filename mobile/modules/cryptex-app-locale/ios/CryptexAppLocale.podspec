Pod::Spec.new do |s|
  s.name           = 'CryptexAppLocale'
  s.version        = '1.0.0'
  s.summary        = 'Keeps the language chosen in Cryptex Vault.'
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

  s.source_files = '*.swift'
end
