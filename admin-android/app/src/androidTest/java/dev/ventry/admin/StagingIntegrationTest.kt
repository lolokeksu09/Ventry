package dev.ventry.admin

import android.view.WindowManager
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StagingIntegrationTest {
    @get:Rule val compose=createAndroidComposeRule<MainActivity>()
    private val args get()=InstrumentationRegistry.getArguments()
    private fun origin()=requireNotNull(args.getString("origin"))
    private fun key()=requireNotNull(args.getString("operator"))
    private fun waitTag(tag:String) {
        compose.waitUntil(30_000){compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()}
    }

    @Test fun nativeUiLoadsRealProjectsAndPlans() {
        assertTrue(compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        compose.onNodeWithTag("server").performTextInput(origin())
        compose.onNodeWithTag("token").performTextInput(key())
        compose.onNodeWithTag("connect").performScrollTo().performClick()
        waitTag("project_raschet")
        compose.onNodeWithTag("project_raschet").performClick()
        compose.waitUntil(30_000){compose.onAllNodesWithText("Тарифы").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Тарифы").performClick()
        compose.onNodeWithText("299,00 ₽").assertExists()
        compose.onNodeWithTag("logout").performClick()
        compose.onNodeWithTag("token").assertExists()
    }

    @Test fun nativeTransportAgainstRealDatabase() = runBlocking {
        val api=DeliveryApi(origin(),key(),true)
        val project="native_"+Contract.newId().replace("-","").take(12)
        val customer=Contract.newId()
        val subscription=Contract.newId()
        assertTrue(api.projects().any{it.code=="raschet"})
        api.createProject(project,"Native integration","dev.ventry."+project)
        api.createPlan(project,"month",12300)
        val plan=api.plans(project).single()
        assertEquals(12300L,plan.kopecks)
        api.createSubscription(project,subscription,customer)
        api.bind(subscription,Contract.newId(),null,Contract.newId())
        val event=Contract.newId()
        api.grant(subscription,event,plan,12300)
        val first=api.subscription(subscription)
        api.grant(subscription,event,plan,12300)
        val replay=api.subscription(subscription)
        assertEquals("active",first.status)
        assertEquals(first.validUntil,replay.validUntil)
        assertEquals(1,api.history(subscription).lines.count{it.detail.endsWith(event)})
        assertTrue(api.subscriptions(project).all{it.product==project})
        assertFalse(api.projects().single{it.code==project}.releaseAvailable)
        try { api.issue(subscription,Contract.newId()); fail("Unapproved product issued APK") }
        catch(e:DeliveryApi.Failure){assertEquals(409,e.status)}
        try { DeliveryApi(origin(),"0".repeat(64),true).projects(); fail("Invalid token accepted") }
        catch(e:DeliveryApi.Failure){assertEquals(401,e.status)}
    }
}
