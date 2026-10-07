package com.cryptex.vault.credentials

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ProviderSessionDeadlineInstrumentedTest {
  @After
  fun clear() = ProviderCredentialCache.clear()

  @Test
  fun backgroundDeadlineCannotBeExtendedByReplacementOrRefresh() {
    ProviderCredentialCache.replace(emptyList(), 1.0)
    ProviderCredentialCache.background(0.005) // 300 ms
    Thread.sleep(180)
    ProviderCredentialCache.replace(emptyList(), 1.0)
    ProviderCredentialCache.refresh(1.0)
    Thread.sleep(180)
    assertFalse(ProviderCredentialCache.isUnlocked())
  }

  @Test
  fun foregroundReplacementDoesNotCountAsInteraction() {
    ProviderCredentialCache.replace(emptyList(), 0.005)
    Thread.sleep(180)
    ProviderCredentialCache.replace(emptyList(), 1.0)
    Thread.sleep(180)
    assertFalse(ProviderCredentialCache.isUnlocked())
  }

  @Test
  fun expiredSessionCannotBeRevivedWithoutExplicitClear() {
    ProviderCredentialCache.replace(emptyList(), 0.0005)
    Thread.sleep(100)
    assertFalse(ProviderCredentialCache.isUnlocked())
    ProviderCredentialCache.refresh(1.0)
    ProviderCredentialCache.replace(emptyList(), 1.0)
    assertFalse(ProviderCredentialCache.isUnlocked())

    // The explicit Keep editing choice clears and republishes the cache.
    ProviderCredentialCache.clear()
    ProviderCredentialCache.replace(emptyList(), 1.0)
    assertTrue(ProviderCredentialCache.isUnlocked())
  }

  @Test
  fun shortBackgroundResumeGetsNewForegroundWindow() {
    ProviderCredentialCache.replace(emptyList(), 1.0)
    ProviderCredentialCache.background(0.005)
    Thread.sleep(80)
    assertTrue(ProviderCredentialCache.isUnlocked())
    ProviderCredentialCache.resume(1.0)
    Thread.sleep(330)
    assertTrue(ProviderCredentialCache.isUnlocked())
  }

  @Test
  fun zeroDisablesNativeTimeout() {
    ProviderCredentialCache.replace(emptyList(), 0.0)
    ProviderCredentialCache.background(0.0)
    Thread.sleep(40)
    assertTrue(ProviderCredentialCache.isUnlocked())
  }
}
