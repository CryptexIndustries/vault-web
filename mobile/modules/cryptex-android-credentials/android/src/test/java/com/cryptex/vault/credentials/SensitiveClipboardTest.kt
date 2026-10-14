package com.cryptex.vault.credentials

import org.junit.Assert.*
import org.junit.Test

class SensitiveClipboardTest {
  @Test fun api24Through27ReplaceTheOwnedClipWithEmptyText() {
    for (api in 24..27) {
      var marker: String? = "owned"
      var replacements = 0
      assertTrue(clearOwnedClipboardClip("owned", api, { marker },
        { fail("clearPrimaryClip is unavailable before API 28") },
        { replacements++; marker = null }))
      assertEquals(1, replacements)
    }
  }

  @Test fun api28AndNewerUseClearPrimaryClip() {
    for (api in listOf(28, 36)) {
      var marker: String? = "owned"
      var clears = 0
      assertTrue(clearOwnedClipboardClip("owned", api, { marker },
        { clears++; marker = null }, { fail("Unexpected legacy replacement") }))
      assertEquals(1, clears)
    }
  }

  @Test fun anotherMarkedOwnerIsPreserved() {
    assertTrue(clearOwnedClipboardClip("owned", 24, { "other owner" },
      { fail("Must preserve the replacement clip") }, { fail("Must preserve the replacement clip") }))
  }

  @Test fun unavailableOrUnmarkedClipIsNeverOverwritten() {
    var writes = 0
    assertFalse(clearOwnedClipboardClip("owned", 24, { null },
      { writes++ }, { writes++ }))
    assertFalse(clearOwnedClipboardClip("owned", 28, { throw SecurityException("Read denied") },
      { writes++ }, { writes++ }))
    assertEquals(0, writes)
  }

  @Test fun failedClearRetainsOwnershipForASuccessfulRetry() {
    var marker: String? = "owned"
    assertFalse(clearOwnedClipboardClip("owned", 28, { marker },
      { throw SecurityException("Clear denied") }, { fail("Unexpected legacy replacement") }))
    assertEquals("owned", marker)
    assertTrue(clearOwnedClipboardClip("owned", 28, { marker },
      { marker = null }, { fail("Unexpected legacy replacement") }))
  }

  @Test fun failedLegacyReplacementRetainsOwnership() {
    var unavailableApiCalls = 0
    var replacements = 0
    assertFalse(clearOwnedClipboardClip("owned", 27, { "owned" },
      { unavailableApiCalls++ }, { replacements++; throw SecurityException("Write denied") }))
    assertEquals(0, unavailableApiCalls)
    assertEquals(1, replacements)
  }

  @Test fun silentlyIgnoredClearRetainsOwnership() {
    assertFalse(clearOwnedClipboardClip("owned", 28, { "owned" }, {},
      { fail("Unexpected legacy replacement") }))
  }

  @Test fun failedPostClearReadRetainsOwnership() {
    var reads = 0
    assertFalse(clearOwnedClipboardClip("owned", 28, {
      if (reads++ == 0) "owned" else throw SecurityException("Read denied")
    }, {}, { fail("Unexpected legacy replacement") }))
  }
}
