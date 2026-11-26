internal import Expo
import React

@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate {
    UIApplication.shared.delegate as! AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window

    // Linking.getInitialURL() reads a link that cold-started the app from here.
    let launchOptions = connectionOptions.urlContexts.first.map {
      [UIApplication.LaunchOptionsKey.url: $0.url as Any]
    }
    appDelegate.reactNativeFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
    self.scene(scene, openURLContexts: connectionOptions.urlContexts)
  }

  // expo-dev-launcher and expo-linking receive links through AppDelegate.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [:])
    }
  }
}
