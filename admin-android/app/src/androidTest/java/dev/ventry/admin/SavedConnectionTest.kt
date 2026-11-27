package dev.ventry.admin

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SavedConnectionTest {
    @Test fun cleartextConnectionCannotBeSaved(){
        val store=SavedConnectionStore(InstrumentationRegistry.getInstrumentation().targetContext)
        val before=store.exists()
        try{
            store.save(SavedConnection("http://127.0.0.1:18081","a".repeat(64),null))
            fail("Cleartext connection accepted")
        }catch(_:IllegalArgumentException){}
        assertEquals(before,store.exists())
    }
}
