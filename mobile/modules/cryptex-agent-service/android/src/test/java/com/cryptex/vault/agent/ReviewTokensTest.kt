package com.cryptex.vault.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewTokensTest {
  private val secret = ByteArray(32) { it.toByte() }

  @Test
  fun acceptsOnlyTheTokenForThatRequest() {
    val token = ReviewTokens.token(secret, "request-1")
    assertTrue(ReviewTokens.matches(secret, "request-1", token))
    assertFalse(ReviewTokens.matches(secret, "request-2", token))
    assertFalse(ReviewTokens.matches(secret, "request-1", null))
    assertFalse(ReviewTokens.matches(secret, "request-1", ""))
    assertFalse(ReviewTokens.matches(ReviewTokens.newSecret(), "request-1", token))
  }

  @Test
  fun requestCodesDontCollideWhereHashCodesDo() {
    // "Aa" and "BB" share a hashCode.
    assertEquals("Aa".hashCode(), "BB".hashCode())
    var saved = 0
    val codes = RequestCodes(RequestCodes.FIRST) { saved = it }
    val first = codes.codeFor("Aa")
    val second = codes.codeFor("BB")
    assertNotEquals(first, second)
    assertEquals(first, codes.codeFor("Aa"))
    assertEquals(second + 1, saved)
  }

  @Test
  fun requestCodesContinueAfterARestart() {
    var saved = 0
    RequestCodes(RequestCodes.FIRST) { saved = it }.codeFor("old")
    val restarted = RequestCodes(saved) { saved = it }
    assertNotEquals(RequestCodes.FIRST, restarted.codeFor("new"))
  }
}
