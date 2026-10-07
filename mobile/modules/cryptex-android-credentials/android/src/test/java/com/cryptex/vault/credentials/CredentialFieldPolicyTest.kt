package com.cryptex.vault.credentials

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialFieldPolicyTest {
  @Test fun emailIdentityWinsOverGenericUsernameVocabulary() {
    assertEquals(CredentialFieldRole.EMAIL, CredentialFieldPolicy.classify("user_email"))
    assertEquals(CredentialFieldRole.EMAIL, CredentialFieldPolicy.classify("Account e-mail"))
    assertEquals(CredentialFieldRole.EMAIL, CredentialFieldPolicy.classify("login", email = true))
  }

  @Test fun explicitUsernameHintsRemainAuthoritative() {
    assertEquals(CredentialFieldRole.USERNAME,
      CredentialFieldPolicy.classify("user_email", username = true))
    assertEquals(CredentialFieldRole.USERNAME,
      CredentialFieldPolicy.classify("email", username = true, email = true))
  }

  @Test fun passwordAndOtpFieldsNeverBecomeUsernameOrEmailFields() {
    assertEquals(CredentialFieldRole.PASSWORD,
      CredentialFieldPolicy.classify("user email password", username = true, email = true))
    assertEquals(CredentialFieldRole.PASSWORD,
      CredentialFieldPolicy.classify("account", password = true, username = true))
    assertEquals(CredentialFieldRole.OTP,
      CredentialFieldPolicy.classify("one-time verification password", password = true))
    assertEquals(CredentialFieldRole.OTP,
      CredentialFieldPolicy.classify("security code", username = true))
    assertEquals(CredentialFieldRole.OTP,
      CredentialFieldPolicy.classify("password", otp = true, password = true))
  }

  @Test fun ordinaryLoginFieldsAndUnknownFieldsKeepTheirRoles() {
    assertEquals(CredentialFieldRole.USERNAME, CredentialFieldPolicy.classify("ACCOUNT identifier"))
    assertEquals(CredentialFieldRole.PASSWORD, CredentialFieldPolicy.classify("passwd"))
    assertEquals(CredentialFieldRole.EMAIL, CredentialFieldPolicy.classify("", email = true))
    assertNull(CredentialFieldPolicy.classify("search query"))
  }

  @Test fun newAndConfirmationPasswordsShareTheSameNormalization() {
    assertTrue(CredentialFieldPolicy.isNewPassword("NEW_password"))
    assertTrue(CredentialFieldPolicy.isNewPassword("Confirm-Password"))
    assertTrue(CredentialFieldPolicy.isNewPassword("password_confirmation"))
    assertFalse(CredentialFieldPolicy.isNewPassword("current-password"))
  }
}
