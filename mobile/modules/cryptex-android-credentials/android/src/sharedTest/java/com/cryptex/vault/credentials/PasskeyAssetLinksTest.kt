package com.cryptex.vault.credentials

import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class PasskeyAssetLinksTest {
  private val certificate = List(32) { "AB" }.joinToString(":")
  private val rotatedCertificate = List(32) { "CD" }.joinToString(":")
  private val root = "https://example.com/.well-known/assetlinks.json"

  private fun statement(
    packageName: String = "com.example.app",
    cert: String = certificate,
    relation: String = "delegate_permission/common.get_login_creds",
    namespace: String = "android_app",
  ) = JSONObject().put("relation", JSONArray().put(relation)).put(
    "target", JSONObject().put("namespace", namespace).put("package_name", packageName)
      .put("sha256_cert_fingerprints", JSONArray().put(cert)),
  )

  private fun include(url: String) = JSONObject().put("include", url)
  private fun list(vararg statements: JSONObject) = JSONArray(statements.toList()).toString()

  private class Response(
    url: URL,
    val body: ByteArray,
    val status: Int = 200,
    val type: String = "application/json",
    val length: Long = body.size.toLong(),
    val beforeResponse: () -> Unit = {},
  ) : HttpsURLConnection(url) {
    var disconnected = false
    override fun getResponseCode(): Int { beforeResponse(); return status }
    override fun getContentType() = type
    override fun getContentLengthLong() = length
    override fun getInputStream() = ByteArrayInputStream(body)
    override fun disconnect() { disconnected = true }
    override fun connect() {}
    override fun usingProxy() = false
    override fun getCipherSuite() = "test"
    override fun getLocalCertificates(): Array<Certificate>? = null
    override fun getServerCertificates(): Array<Certificate> = emptyArray()
  }

  private fun verify(
    documents: Map<String, String>,
    rpId: String = "example.com",
    packageName: String = "com.example.app",
    certs: Set<String> = setOf(certificate),
    all: Boolean = false,
    requests: MutableList<String> = mutableListOf(),
  ) = PasskeyAssetLinks.verify(rpId, packageName, certs, all, { url ->
    requests.add(url.toString())
    Response(url, documents.getValue(url.toString()).toByteArray())
  }, { 0L })

  @Test fun exactWebsitePackageAndCertificateAreRequired() {
    val requests = mutableListOf<String>()
    assertTrue(verify(mapOf(root to list(statement())), requests = requests))
    assertEquals(listOf(root), requests)
    assertFalse(verify(mapOf(root to list(statement(packageName = "com.other.app")))))
    assertFalse(verify(mapOf(root to list(statement(cert = rotatedCertificate)))))
    assertFalse(verify(mapOf(root to list(statement(relation = "delegate_permission/common.handle_all_urls")))))
    assertFalse(verify(mapOf(root to list(statement(namespace = "web")))))
  }

  @Test fun matchingNeverUsesSubstringsOrDisplayNames() {
    assertFalse(verify(mapOf(root to list(statement(packageName = "com.example.app.evil")))))
    assertFalse(verify(mapOf(root to list(statement(cert = "$certificate:AB")))))
    assertFalse(verify(mapOf(root to list(statement(cert = " $certificate")))))
  }

  @Test fun fingerprintHexCaseDoesNotChangeCertificateIdentity() {
    assertTrue(verify(mapOf(root to list(statement(cert = certificate.lowercase())))))
    assertTrue(verify(mapOf(root to list(statement())), certs = setOf(certificate.lowercase())))
  }

  @Test fun domainCaseDoesNotChangeTheHttpsEndpoint() {
    assertTrue(verify(mapOf(root to list(statement())), rpId = "EXAMPLE.COM"))
  }

  @Test fun invalidDomainsNeverReachTheNetwork() {
    for (domain in listOf("", " example.com", "example.com ", "https://example.com", "example.com:443",
      "example.com/path", "example.com?x=1", "example.com#x", "user@example.com", "example..com",
      ".example.com", "example.com.", "-example.com", "example_.com", "a".repeat(64) + ".com",
      "a.".repeat(127) + "com", "example.com\\evil.com", "example%2ecom")) {
      val requests = mutableListOf<String>()
      assertThrows(domain, IOException::class.java) {
        verify(emptyMap(), rpId = domain, requests = requests)
      }
      assertTrue(domain, requests.isEmpty())
    }
  }

  @Test fun missingAndEmptyStatementsDoNotVerify() {
    assertFalse(verify(mapOf(root to "[]")))
    assertFalse(verify(mapOf(root to "[{}]")))
  }

  @Test fun rotationCanUseAnEarlierSigningCertificate() {
    assertTrue(verify(mapOf(root to list(statement())), certs = setOf(certificate, rotatedCertificate)))
  }

  @Test fun multipleCurrentSignersMustAllBeLinked() {
    val certs = setOf(certificate, rotatedCertificate)
    assertFalse(verify(mapOf(root to list(statement())), certs = certs, all = true))
    assertTrue(verify(mapOf(root to list(statement(), statement(cert = rotatedCertificate))), certs = certs, all = true))
  }

  @Test fun malformedCallerFingerprintsFailBeforeNetworkAccess() {
    for (certs in listOf(emptySet(), setOf("AB"), setOf("not a fingerprint"))) {
      assertThrows(IllegalArgumentException::class.java) { verify(emptyMap(), certs = certs) }
    }
  }

  @Test fun delegatedHttpsStatementsCanVerifyTheCaller() {
    val delegated = "https://associations.example/statements.json"
    val requests = mutableListOf<String>()
    assertTrue(verify(mapOf(root to list(include(delegated)), delegated to list(statement())), requests = requests))
    assertEquals(listOf(root, delegated), requests)
  }

  @Test fun multipleSignersMayBeLinkedAcrossIncludedStatements() {
    val delegated = "https://associations.example/statements.json"
    assertTrue(verify(mapOf(root to list(statement(), include(delegated)),
      delegated to list(statement(cert = rotatedCertificate))), certs = setOf(certificate, rotatedCertificate), all = true))
  }

  @Test fun unneededIncludesAreNotFetchedAfterSuccessfulVerification() {
    val requests = mutableListOf<String>()
    assertTrue(verify(mapOf(root to list(statement(), include("https://unused.example/list.json"))), requests = requests))
    assertEquals(listOf(root), requests)
  }

  @Test fun duplicateAndCyclicIncludesDoNotLoop() {
    val child = "https://associations.example/list.json"
    val requests = mutableListOf<String>()
    assertFalse(verify(mapOf(root to list(include(child), include(child)), child to list(include(root))), requests = requests))
    assertEquals(listOf(root, child), requests)
  }

  @Test fun tenIncludesAreSupportedButElevenAreRejected() {
    val documents = mutableMapOf<String, String>()
    var previous = root
    for (index in 1..10) {
      val child = "https://associations.example/$index.json"
      documents[previous] = list(include(child))
      previous = child
    }
    documents[previous] = list(statement())
    assertTrue(verify(documents))
    documents[previous] = list(include("https://associations.example/11.json"))
    assertThrows(IOException::class.java) { verify(documents) }
  }

  @Test fun insecureOrMalformedDelegationIsRejected() {
    for (url in listOf("http://associations.example/list.json", "file:///tmp/list.json",
      "https://user:password@associations.example/list.json", "https://associations.example/list.json#fragment",
      "https:///list.json", "/relative.json", "https://associations.example/bad path")) {
      assertThrows(url, Exception::class.java) { verify(mapOf(root to list(include(url)))) }
    }
  }

  @Test fun invalidJsonCannotVerifyTheCaller() {
    for (body in listOf("not json", "{}", "[null]", "[1]", "[\"statement\"]")) {
      assertThrows(Exception::class.java) { verify(mapOf(root to body)) }
    }
  }

  @Test fun redirectsAndHttpErrorsFailClosed() {
    for (status in listOf(301, 302, 307, 308, 404, 500)) {
      val response = Response(URL(root), list(statement()).toByteArray(), status = status)
      assertThrows(IOException::class.java) {
        PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate),
          openConnection = { response }, now = { 0L })
      }
      assertFalse(response.instanceFollowRedirects)
      assertTrue(response.disconnected)
    }
  }

  @Test fun responsesMustBeJsonNotHtml() {
    for (type in listOf("text/html", "text/plain", "")) {
      assertThrows(IOException::class.java) {
        PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate),
          openConnection = { Response(it, list(statement()).toByteArray(), type = type) }, now = { 0L })
      }
    }
    assertTrue(PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate),
      openConnection = { Response(it, list(statement()).toByteArray(), type = "application/json; charset=utf-8") }, now = { 0L }))
  }

  @Test fun documentSizeIsBoundedEvenWithUnknownOrFalseContentLength() {
    for (length in listOf(-1L, 1L, 262145L)) {
      val response = Response(URL(root), ByteArray(262145) { ' '.code.toByte() }, length = length)
      assertThrows(IOException::class.java) {
        PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate),
          openConnection = { response }, now = { 0L })
      }
      assertTrue(response.disconnected)
    }
  }

  @Test fun deeplyNestedJsonIsRejectedBeforeRecursiveParsing() {
    assertThrows(IOException::class.java) { verify(mapOf(root to "[".repeat(33) + "]".repeat(33))) }
    val harmless = statement().put("comment", "[".repeat(100) + "\\\"{}")
    assertTrue(verify(mapOf(root to list(harmless))))
  }

  @Test fun parserNestingLimitCannotBeBypassedWithLenientStringOrCommentSyntax() {
    val nested = "[".repeat(40) + "]".repeat(40)
    for (body in listOf("['\"', $nested]", "[/* \" */ $nested]")) {
      // The JVM parser can reject comments outright; Android accepts them, but must bound recursion.
      assertThrows(Exception::class.java) { verify(mapOf(root to body)) }
    }
  }

  @Test fun trailingDataCannotSupplyASecondAssociationList() {
    assertThrows(IOException::class.java) { verify(mapOf(root to list(statement()) + "[]")) }
  }

  @Test fun invalidUtf8IsRejected() {
    assertThrows(Exception::class.java) {
      PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate),
        openConnection = { Response(it, byteArrayOf(0xC3.toByte(), 0x28)) }, now = { 0L })
    }
  }

  @Test fun everyRequestHasTimeoutsAndDoesNotUseHttpCaching() {
    val response = Response(URL(root), list(statement()).toByteArray())
    assertTrue(PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate),
      openConnection = { response }, now = { 0L }))
    assertEquals(5000, response.connectTimeout)
    assertEquals(5000, response.readTimeout)
    assertEquals("application/json", response.getRequestProperty("Accept"))
    assertFalse(response.useCaches)
    assertTrue(response.disconnected)
  }

  @Test fun includesShareOneTimeBudgetAndCannotExtendIt() {
    var clock = 0L
    val requests = mutableListOf<String>()
    val child = "https://associations.example/list.json"
    assertThrows(IOException::class.java) {
      PasskeyAssetLinks.verify("example.com", "com.example.app", setOf(certificate), openConnection = {
        requests.add(it.toString())
        Response(it, list(include(child)).toByteArray(), beforeResponse = { clock = 10_001L })
      }, now = { clock })
    }
    assertEquals(listOf(root), requests)
  }

  @Test fun noAssociationCacheSurvivesRevocationOrFailure() {
    val requests = mutableListOf<String>()
    assertTrue(verify(mapOf(root to list(statement())), requests = requests))
    assertFalse(verify(mapOf(root to "[]"), requests = requests))
    assertThrows(Exception::class.java) { verify(emptyMap(), requests = requests) }
    assertTrue(verify(mapOf(root to list(statement())), requests = requests))
    assertEquals(listOf(root, root, root, root), requests)
  }
}
