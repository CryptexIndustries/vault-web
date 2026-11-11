import XCTest

// iOS suites that use the share sheet's Save dialog or the file picker, which
// are separate system apps that Maestro can't read.
final class TransferTests: XCTestCase {
  private let password = "CorrectHorseBatteryStaple42"
  private let saveDialog = XCUIApplication(bundleIdentifier: "com.apple.DocumentManagerUICore.SaveToFiles")
  private let picker = XCUIApplication(bundleIdentifier: "com.apple.DocumentManagerUICore.Service")
  private let importedFingerprint = "SHA256:FgJyvLLzDuDxEny970gdFu3G8z6d8daahg2A+LVGV68"
  private let exportPrefix = ProcessInfo.processInfo.environment["CRYPTEX_EXPORT_PREFIX"]!
  private var vault: XCUIApplication!

  override func setUp() {
    continueAfterFailure = false
    vault = XCUIApplication(bundleIdentifier: ProcessInfo.processInfo.environment["CRYPTEX_APP_ID"]!)
    vault.launchArguments = ["-cryptexE2EKeyboard", "YES"]
  }

  func testExport() {
    vault.launch()
    unlock()
    tap(label("More"))
    tap(prefix("Import / Export"))
    tap(prefix("Encrypted vault"))
    tap(label("Export encrypted vault"))
    saveToFiles(as: "\(exportPrefix)-encrypted")
    assertVisible(label("Encrypted export ready."))
    tap(label("Close dialog"))

    tap(prefix("Unencrypted export"))
    enter("WrongPassword42", into: label("Master password for cleartext export"))
    tap(label("I understand this file is unencrypted and will delete it after use."))
    tap(label("Review export"))
    tap(label("Export JSON"))
    // Wrong reauthentication must leave the confirmation open with sharing absent.
    assertVisible(label("Export cleartext JSON"))
    XCTAssertFalse(label("Save to Files").exists)
    tap(label("Cancel"))
    enter(password, into: label("Master password for cleartext export"), clearing: true)
    tap(label("Review export"))
    tap(label("Export JSON"))
    saveToFiles(as: "\(exportPrefix)-readable")
    assertVisible(label("Cleartext export ready. Delete it after use."))
  }

  func testRestore() {
    vault.launch()
    assertVisible(label("Vault name"))
    tap(label("Restore backup"))
    tap(label("Choose .cryx backup file"))
    pick("\(exportPrefix)-encrypted")
    assertVisible(prefix("After restore, unlock with the existing master password"))
    enter("E2E Restored Vault", into: label("Restored vault name"), clearing: true)
    tap(identified("restore-vault"))
    assertVisible(label("Backup restored. Unlock it to continue."))

    enter("WrongPassword42", into: identified("unlock-master-password"))
    tap(identified("unlock-vault"))
    assertVisible(label("That password could not unlock this vault. Check it and try again."))
    XCTAssertFalse(prefix("E2E Transfer Login").exists)
    enter(password, into: identified("unlock-master-password"), clearing: true)
    tap(identified("unlock-vault"))
    assertTransferLogin()

    vault.launch()
    unlock()
    assertVisible(prefix("E2E Transfer Login"))
  }

  func testImportReadableExport() {
    vault.launch()
    unlock()
    tap(label("More"))
    tap(prefix("Import / Export"))
    tap(prefix("Import passwords"))
    tap(label("Cryptex Vault JSON"))
    tap(label("Continue"))
    tap(vault.buttons["Choose import file"])
    pick("\(exportPrefix)-readable")
    assertVisible(label("Ready to import"))
    tap(label("Import 1 login"))
    assertVisible(prefix("Imported 1 credential"))
    vault.launch()
    unlock()
    assertTransferLogin()
  }

  func testSshKeys() {
    vault.launch()
    unlock()
    tap(label("Add item"))
    tap(identified("add-item-login"))
    enter("Plain Login", into: label("Credential name"))
    tap(identified("credential-submit"))
    assertVisible(prefix("Plain Login"))
    tap(label("Back"))

    // A generated key is ready at once, and its comment follows the name.
    tap(label("Add item"))
    tap(identified("add-item-ssh-key"))
    assertVisible(identified("ssh-key-generated"))
    // The comment regenerates on each keystroke, which can drop fast typing.
    let name = label("SSH key name")
    tap(name)
    "Generated key".forEach { name.typeText(String($0)) }
    assertVisible(element("label MATCHES %@", "ssh-ed25519 AAAA\\S+ Generated key"))
    tap(identified("ssh-key-submit"))
    assertVisible(label("Item details"))
    assertVisible(prefix("Generated key"))
    tap(label("Back"))

    // Import the encrypted fixture key.
    tap(label("Add item"))
    tap(identified("add-item-ssh-key"))
    tap(identified("ssh-key-source-import"))
    tap(vault.buttons["Choose key file"])
    pick("\(exportPrefix)-key")
    enter("wrong horse", into: identified("ssh-key-passphrase"))
    tap(vault.buttons["Unlock"])
    assertVisible(label("The passphrase is incorrect."))
    enter("correct horse", into: identified("ssh-key-passphrase"), clearing: true)
    tap(vault.buttons["Unlock"])
    assertVisible(identified("ssh-key-imported"))
    assertVisible(contains(importedFingerprint))
    enter("Imported key", into: label("SSH key name"), clearing: true)
    tap(identified("ssh-key-submit"))
    assertVisible(label("Item details"))
    assertVisible(contains(importedFingerprint))

    // Save the private key with a passphrase; the runner checks the file.
    tap(label("Copy Public key"))
    tap(label("Save private key"))
    enter("export horse", into: identified("ssh-key-file-passphrase"))
    enter("export horse", into: identified("ssh-key-file-passphrase-confirm"))
    tap(identified("ssh-key-file-save"))
    // Encrypting runs on the key worker, which is slow without a JIT.
    XCTAssertTrue(label("Save to Files").waitForExistence(timeout: 90))
    saveToFiles(as: "\(exportPrefix)-saved")
    assertVisible(label("Item details"))
    tap(label("Back"))

    // The filter shows only SSH keys.
    tap(prefix("Filter items"))
    tap(prefix("SSH keys"))
    assertVisible(prefix("Generated key"))
    assertVisible(prefix("Imported key"))
    XCTAssertFalse(prefix("Plain Login").exists)

    // Search finds the comment.
    enter("ed25519-enc", into: label("Search your vault"))
    assertVisible(prefix("Imported key"))
    XCTAssertFalse(prefix("Generated key").exists)
    tap(label("Back"))

    // The copied public key is the imported key's .pub line.
    tap(label("Add item"))
    tap(identified("add-item-ssh-key"))
    tap(identified("ssh-key-source-import"))
    let keyField = identified("ssh-key-private-key")
    // iOS offers Paste only on a field that already has focus.
    tap(keyField)
    keyField.press(forDuration: 1.2)
    tap(label("Paste"))
    assertVisible(element("value BEGINSWITH %@", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM0WTpF53QEFgxvkp1z95vsy4"))
    assertVisible(prefix("This is a public key"))
    tap(label("Cancel editing"))
    tap(label("Discard"))
  }

  private func unlock() {
    enter(password, into: identified("unlock-master-password"))
    tap(identified("unlock-vault"))
    assertVisible(label("Search your vault"))
  }

  private func assertTransferLogin() {
    tap(prefix("E2E Transfer Login"))
    assertVisible(label("transfer@example.test"))
    assertVisible(prefix("https://transfer.example.test/login"))
    tap(label("Reveal Password"))
    assertVisible(label("transfer-password-42"))
    tap(label("Back"))
  }

  private func saveToFiles(as name: String) {
    tap(label("Save to Files"))
    let field = saveDialog.textFields["DOCPicker.filenameTextField"]
    assertVisible(field)
    // Tapping selects the suggested name, so typing replaces it. The dialog
    // can ignore a tap while it is still opening.
    for _ in 0..<5 where !saveDialog.keyboards.firstMatch.exists {
      field.tap()
      _ = saveDialog.keyboards.firstMatch.waitForExistence(timeout: 3)
    }
    field.typeText(name)
    saveDialog.buttons["DOCPicker.actionButton"].tap()
    XCTAssertTrue(field.waitForNonExistence(timeout: 30), "The Save dialog stayed open")
  }

  private func pick(_ name: String) {
    let file = picker.descendants(matching: .any)
      .matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
    if !file.waitForExistence(timeout: 5) {
      picker.buttons["Browse"].tap()
      picker.descendants(matching: .any)["On My iPhone"].firstMatch.tap()
    }
    // A fast swipe keeps the list coasting, and a tap then only stops it.
    for _ in 0..<20 where !(file.exists && file.isHittable) {
      picker.swipeUp(velocity: .slow)
    }
    file.tap()
    XCTAssertTrue(file.waitForNonExistence(timeout: 10), "The picker kept \(name) open")
  }

  private func label(_ text: String) -> XCUIElement { element("label == %@", text) }
  private func prefix(_ text: String) -> XCUIElement { element("label BEGINSWITH %@", text) }
  private func contains(_ text: String) -> XCUIElement { element("label CONTAINS %@", text) }
  private func identified(_ id: String) -> XCUIElement { element("identifier == %@", id) }

  private func element(_ format: String, _ value: String) -> XCUIElement {
    vault.descendants(matching: .any).matching(NSPredicate(format: format, value)).firstMatch
  }

  private func assertVisible(_ element: XCUIElement, line: UInt = #line) {
    XCTAssertTrue(element.waitForExistence(timeout: 30), "Not found: \(element)", line: line)
  }

  // Swiping also closes the keyboard, which can cover the next control.
  private func tap(_ element: XCUIElement, line: UInt = #line) {
    assertVisible(element, line: line)
    for _ in 0..<8 where !element.isHittable {
      vault.swipeUp()
    }
    element.tap()
  }

  private func enter(_ text: String, into field: XCUIElement, clearing: Bool = false, line: UInt = #line) {
    tap(field, line: line)
    if clearing {
      field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40))
    }
    field.typeText(text)
  }
}
