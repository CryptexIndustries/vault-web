package com.cryptex.vault.credentials

import java.util.Locale

internal enum class CredentialFieldRole { USERNAME, EMAIL, PASSWORD, OTP }

internal object CredentialFieldPolicy {
  private val usernameTerms = setOf("user", "username", "login", "account", "identifier")
  private val emailTerms = setOf("email", "e mail")
  private val passwordTerms = setOf("password", "passwd", "passcode", "pwd")
  private val otpTerms = setOf("otp", "totp", "2fa", "mfa", "verification", "one time", "security code")
  private val identitySeparators = Regex("[^a-z0-9]+")

  fun classify(
    identity: String,
    otp: Boolean = false,
    password: Boolean = false,
    username: Boolean = false,
    email: Boolean = false,
  ): CredentialFieldRole? {
    val normalized = normalize(identity)
    fun hasTerm(terms: Set<String>) = terms.any(normalized::contains)
    return when {
      otp || hasTerm(otpTerms) -> CredentialFieldRole.OTP
      password || hasTerm(passwordTerms) -> CredentialFieldRole.PASSWORD
      // Explicit username hints take precedence over email-like resource names.
      username -> CredentialFieldRole.USERNAME
      email || hasTerm(emailTerms) -> CredentialFieldRole.EMAIL
      hasTerm(usernameTerms) -> CredentialFieldRole.USERNAME
      else -> null
    }
  }

  fun isNewPassword(identity: String): Boolean {
    val normalized = normalize(identity)
    return normalized.contains("new password") || normalized.contains("confirm password") ||
      normalized.contains("password confirmation")
  }

  private fun normalize(identity: String): String =
    identity.lowercase(Locale.ROOT).replace(identitySeparators, " ")
}
