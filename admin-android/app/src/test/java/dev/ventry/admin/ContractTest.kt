package dev.ventry.admin

import org.junit.Assert.*
import org.junit.Test

class ContractTest {
    private fun reject(block:()->Unit) {
        try { block(); fail("Expected validation failure") } catch (_:IllegalArgumentException) { }
    }
    @Test fun exactMoneyAndIdentifiers() {
        assertEquals(29900L,Contract.kopecks("299"))
        assertEquals(79900L,Contract.kopecks("799,00"))
        assertEquals(1L,Contract.kopecks("0.01"))
        reject { Contract.kopecks("1.001") }
        reject { Contract.kopecks("-1") }
        reject { Contract.kopecks("1e3") }
        assertTrue(Contract.code("raschet"))
        assertFalse(Contract.code("../escape"))
        assertTrue(Contract.packageName("dev.ventry.other"))
        assertFalse(Contract.packageName("bad"))
        assertEquals(36,Contract.uuid(Contract.newId()).length)
        reject { Contract.uuid("00000000-0000-0000-0000-000000000000") }
    }
    @Test fun credentialsAndTransport() {
        val token="a".repeat(64)
        assertTrue(Contract.token(token))
        assertFalse(Contract.token("A".repeat(64)))
        assertEquals("https://admin.example.com",Contract.origin("https://admin.example.com/",false))
        assertEquals("http://127.0.0.1:18081",Contract.origin("http://127.0.0.1:18081",true))
        reject { Contract.origin("http://127.0.0.1:18081",false) }
        reject { Contract.origin("http://example.com",true) }
        reject { Contract.origin("https://example.com/path",true) }
        reject { Contract.origin("https://u:pass@example.com",true) }
        reject { Contract.origin("https://example.com/?token=a",true) }
        val link="https://download.example.com/download#"+token
        assertEquals(link,Contract.downloadUrl(link,false))
        reject { Contract.downloadUrl("https://download.example.com/download?token="+token,false) }
        reject { Contract.downloadUrl("http://download.example.com/download#"+token,true) }
    }
}
