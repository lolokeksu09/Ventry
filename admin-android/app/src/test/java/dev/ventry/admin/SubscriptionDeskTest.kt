package dev.ventry.admin

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

class SubscriptionDeskTest {
    private val now=Instant.parse("2026-11-27T12:00:00Z")
    private fun id(n:Int)="00000000-0000-0000-0000-"+n.toString().padStart(12,'0')
    private fun row(n:Int,status:String,until:String?)=Subscription(id(n),id(n+1000),"raschet",status,until,null,null)
    @Test fun renewalBoundaryAndSearch() {
        val rows=listOf(row(1,"active","2026-12-04T12:00:00Z"),row(2,"active","2026-12-04T12:00:01Z"),
            row(3,"expired","2026-11-26T12:00:00Z"),row(4,"not_started",null),row(5,"active","2026-11-27T12:00:00Z"))
        assertEquals(listOf(id(1)),SubscriptionDesk.select(rows,emptyMap(),"","expiring",now).map{it.id})
        assertEquals(listOf(id(4)),SubscriptionDesk.select(rows,mapOf(id(1004) to "Магазин"),"магаз","pending",now).map{it.id})
        assertEquals(listOf(id(1),id(3),id(4),id(5),id(2)),SubscriptionDesk.select(rows,emptyMap(),"","all",now).map{it.id})
    }
    @Test fun pagesCannotRepeatOrMoveBackwards(){
        val first=(1..100).map{row(it,"active",null)}
        val next=(101..103).map{row(it,"active",null)}
        SubscriptionDesk.validatePage(first,null);SubscriptionDesk.validatePage(next,first.last().id)
        assertEquals(103,SubscriptionDesk.merge(first,next).size)
        for(broken in listOf(listOf(first.last()),next.reversed())){
            try{SubscriptionDesk.validatePage(broken,first.last().id);fail("Invalid page accepted")}catch(_:IllegalArgumentException){}
        }
    }
    @Test fun paymentsUseConfirmationDateNotCoverageStart(){
        fun event(n:Int,amount:Long,recorded:String)=PaymentEvent(id(n),"month",amount,recorded,"2026-12-10T00:00:00Z","2027-01-10T00:00:00Z")
        val rows=listOf(event(1,29900,"2026-11-21T00:00:00Z"),event(2,79900,"2026-11-20T23:59:59Z"),
            event(3,0,"2026-11-27T10:00:00Z"))
        val result=SubscriptionDesk.payments(rows,7,now,ZoneOffset.UTC)
        assertEquals(29900L,result.confirmed);assertEquals(1,result.paid);assertEquals(2,result.rows.size)
        assertEquals(109800L,SubscriptionDesk.payments(rows,null,now,ZoneOffset.UTC).confirmed)
    }
}
