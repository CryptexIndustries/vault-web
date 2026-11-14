import XCTest

// The iOS AutoFill extension, driven through Settings and Safari, which are
// system apps Maestro can't read. run-ios-autofill.mjs prepares the vault,
// serves the pages and answers Face ID when a test asks.
final class AutofillTests: XCTestCase {
  private let environment = ProcessInfo.processInfo.environment
  private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
  private let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
  private var site: String { environment["CRYPTEX_SITE"]! }
  private var secureSite: String { environment["CRYPTEX_SECURE_SITE"]! }
  private var appName: String { environment["CRYPTEX_APP_NAME"]! }

  override func setUp() {
    continueAfterFailure = false
  }

  func testTurnOnProvider() {
    settings.terminate()
    settings.launch()
    tap(settings, label("General", in: settings))
    tap(settings, label("AutoFill & Passwords", in: settings))
    let provider = settings.switches["AutoFillFrom\(appName)Toggle"]
    assertVisible(settings, provider)
    // The row's own switch: a tap in the middle of the row misses it.
    let toggle = provider.switches.firstMatch
    // It stays on between runs; turning it on again opens the setup screen.
    if switchValue(provider) == "1" {
      toggle.tap()
      waitForValue("0", of: provider)
    }
    toggle.tap()
    let setup = label("Setting Up AutoFill", in: settings)
    assertVisible(settings, setup)
    withFaceID { XCTAssertTrue(setup.waitForNonExistence(timeout: 30), "The setup screen stayed open") }
    waitForValue("1", of: provider)
  }

  func testCancelFill() {
    openPasswords(at: "/login")
    let cancel = label("Close", in: safari)
    tap(safari, cancel)
    XCTAssertTrue(cancel.waitForNonExistence(timeout: 30), "The sheet stayed open")
    XCTAssertTrue(label("Filled: nothing / nothing", in: safari).exists)
  }

  func testFillPassword() {
    openPasswords(at: "/login")
    let login = label("Autofill Login", in: safari)
    // The sheet is open, but nothing from the vault shows before Face ID.
    assertVisible(safari, label("Close", in: safari))
    XCTAssertFalse(login.exists)
    withFaceID { assertVisible(safari, login) }
    tap(safari, login)
    // The suite's page has no HTTPS, so the login is reviewed first, as on Android.
    assertVisible(safari, prefix("This website doesn't use a secure connection", in: safari))
    XCTAssertFalse(label("Fill and Add Website", in: safari).exists)
    tap(safari, label("Fill Anyway", in: safari))
    assertVisible(safari, label("Filled: autofill@example.test / autofill-password-42", in: safari))
    // run-ios-autofill.mjs checks the copied code now, before it expires.
    request("filled")
  }

  func testAssociateWebsite() {
    openPasswords(at: "/login", on: secureSite)
    let login = label("Autofill Login", in: safari)
    withFaceID { assertVisible(safari, login) }
    // Saved for the HTTP port only, so it isn't suggested here.
    tap(safari, login)
    assertVisible(safari, prefix("Autofill Login isn't saved for this website.", in: safari))
    tap(safari, label("Fill and Add Website", in: safari))
    assertVisible(safari, label("Filled: autofill@example.test / autofill-password-42", in: safari))
  }

  func testAddLogin() {
    openPasswords(at: "/login", on: secureSite)
    let add = label("New Login", in: safari)
    withFaceID { assertVisible(safari, add) }
    tap(safari, add)
    let name = element("placeholderValue == %@ AND value BEGINSWITH 'localhost:'", "Name", in: safari)
    assertVisible(safari, name)
    // The username has focus, and the password starts generated.
    safari.typeText("added@example.test")
    tap(safari, label("Generate Password", in: safari))
    tap(safari, label("Use Password", in: safari))
    tap(safari, label("Save", in: safari))
    assertVisible(safari, prefix("Filled: added@example.test / ", in: safari))
    XCTAssertFalse(label("Filled: added@example.test / nothing", in: safari).exists, "No password was filled")
  }

  func testSaveNewLogin() {
    submit(at: "/signup", username: "saved@example.test", password: "saved-password-42")
    let saveNew = label("Save as New Login", in: safari)
    withFaceID { assertVisible(safari, saveNew) }
    tap(safari, saveNew)
    XCTAssertTrue(saveNew.waitForNonExistence(timeout: 30), "The sheet stayed open")
  }

  func testUpdateLogin() {
    submit(at: "/login", username: "autofill@example.test", password: "autofill-password-43")
    let update = label("Autofill Login", in: safari)
    withFaceID { assertVisible(safari, update) }
    tap(safari, update)
    XCTAssertTrue(update.waitForNonExistence(timeout: 30), "The sheet stayed open")
  }

  func testAppAddsSavedLogins() {
    let vault = XCUIApplication(bundleIdentifier: environment["CRYPTEX_APP_ID"]!)
    vault.launchArguments = ["-cryptexE2EKeyboard", "YES"]
    vault.launch()
    let password = element("identifier == %@", "unlock-master-password", in: vault)
    tap(vault, password)
    password.typeText("CorrectHorseBatteryStaple42")
    tap(vault, element("identifier == %@", "unlock-vault", in: vault))
    assertVisible(vault, label("Saved 3 AutoFill logins to your vault. Added 1 website from AutoFill to your logins.", in: vault))
    assertVisible(vault, prefix("localhost", in: vault))
    tap(vault, prefix("Autofill Login", in: vault))
    tap(vault, label("Reveal Password", in: vault))
    assertVisible(vault, label("autofill-password-43", in: vault))
  }

  /// Opens a page, focuses its first field and picks this provider from the
  /// Passwords key above the keyboard.
  private func openPasswords(at path: String, on site: String? = nil) {
    open(path, on: site)
    tap(safari, safari.webViews.textFields.firstMatch)
    tap(safari, safari.buttons["Passwords"])
    tap(safari, label(appName, in: safari))
  }

  private func submit(at path: String, username: String, password: String) {
    open(path)
    tap(safari, safari.webViews.textFields.firstMatch)
    safari.typeText(username)
    tap(safari, safari.webViews.secureTextFields.firstMatch)
    safari.typeText(password)
    tap(safari, safari.webViews.buttons["Continue"])
    tap(safari, label(appName, in: safari))
  }

  /// Safari shows only the minimized keyboard bar, without the Passwords key,
  /// when it reopens a page it already showed, so each test starts it fresh.
  private func open(_ path: String, on site: String? = nil) {
    safari.terminate()
    XCUIDevice.shared.system.open(URL(string: (site ?? self.site) + path)!)
    XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 30))
  }

  /// Asks run-ios-autofill.mjs to match Face ID while `body` waits.
  private func withFaceID(_ body: () -> Void) {
    let match = request("match")
    defer { try? FileManager.default.removeItem(at: match) }
    body()
  }

  /// Creates a file that run-ios-autofill.mjs reacts to.
  @discardableResult
  private func request(_ name: String) -> URL {
    let file = URL(fileURLWithPath: environment["CRYPTEX_REQUESTS"]!).appendingPathComponent(name)
    XCTAssertTrue(FileManager.default.createFile(atPath: file.path, contents: nil), "Could not ask for \(name)")
    return file
  }

  private func switchValue(_ element: XCUIElement) -> String { "\(element.value ?? "")" }

  private func waitForValue(_ value: String, of element: XCUIElement) {
    let changed = expectation(
      for: NSPredicate { [unowned self] _, _ in switchValue(element) == value },
      evaluatedWith: element
    )
    wait(for: [changed], timeout: 30)
  }

  private func label(_ text: String, in app: XCUIApplication) -> XCUIElement { element("label == %@", text, in: app) }
  private func prefix(_ text: String, in app: XCUIApplication) -> XCUIElement { element("label BEGINSWITH %@", text, in: app) }

  private func element(_ format: String, _ value: String, in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: format, value)).firstMatch
  }

  private func assertVisible(_ app: XCUIApplication, _ element: XCUIElement, line: UInt = #line) {
    guard element.waitForExistence(timeout: 30) else {
      print(app.debugDescription)
      return XCTFail("Not found: \(element)", line: line)
    }
  }

  private func tap(_ app: XCUIApplication, _ element: XCUIElement, line: UInt = #line) {
    assertVisible(app, element, line: line)
    for _ in 0..<8 where !element.isHittable {
      app.swipeUp()
    }
    element.tap()
  }
}
