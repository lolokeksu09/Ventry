package dev.ventry.admin

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.SSLException

@RunWith(AndroidJUnit4::class)
class PrivateTlsIntegrationTest {
    @Test fun privateCaAndHostnameAreRequired()=runBlocking{
        val args=InstrumentationRegistry.getArguments()
        val caBase64=args.getString("ca")
        assumeTrue(caBase64!=null)
        val ca=CertificateFactory.getInstance("X.509").generateCertificate(
            android.util.Base64.decode(caBase64,android.util.Base64.DEFAULT).inputStream()) as X509Certificate
        val origin="https://127.0.0.1:18443"
        val key=checkNotNull(args.getString("operator"))
        // Normal platform trust cannot authenticate the test-only private CA.
        try{DeliveryApi(origin,key,true).openSession();fail("Untrusted CA accepted")}
        catch(_:SSLException){}
        // Same endpoint with wrong hostname must still fail with imported trusted CA.
        try{DeliveryApi("https://localhost:18443",key,true,ca).openSession();fail("Wrong SAN accepted")}
        catch(_:SSLException){}
        val api=DeliveryApi(origin,key,true,ca).openSession()
        assertTrue(api.projects().any{it.code=="raschet"})
        api.closeSession()
        try{api.projects();fail("Revoked session accepted")}
        catch(e:DeliveryApi.Failure){assertEquals(401,e.status)}
    }
}
