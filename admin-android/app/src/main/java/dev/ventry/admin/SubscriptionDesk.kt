package dev.ventry.admin

import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import java.util.UUID

/** Read-only projection. Server pagination uses PostgreSQL UUID byte order. */
object SubscriptionDesk {
    private fun compare(a:String,b:String)=Contract.uuid(a).compareTo(Contract.uuid(b))
    fun validatePage(rows:List<Subscription>,after:String?){
        require(rows.size<=100)
        var previous=after
        rows.forEach{
            Contract.uuid(it.id);Contract.uuid(it.customerId)
            require(previous==null || compare(checkNotNull(previous),it.id)<0) { "Нарушена пагинация" }
            previous=it.id
        }
    }
    fun merge(old:List<Subscription>,next:List<Subscription>):List<Subscription> {
        require(old.isEmpty() || next.isEmpty() || compare(old.last().id,next.first().id)<0)
        return old+next
    }
    fun expiry(row:Subscription)=row.validUntil?.let{runCatching{Instant.parse(it)}.getOrNull()}
    fun expiring(row:Subscription,now:Instant):Boolean=row.status=="active" &&
        expiry(row)?.let{it.isAfter(now)&&!it.isAfter(now.plus(7,ChronoUnit.DAYS))}==true
    fun select(rows:List<Subscription>,labels:Map<String,String>,query:String,filter:String,now:Instant):List<Subscription>{
        val needle=query.trim()
        return rows.filter {
            (needle.isEmpty() || it.id.contains(needle,true)||it.customerId.contains(needle,true)||
                labels[it.customerId]?.contains(needle,true)==true) &&
                when(filter){
                    "all"->true
                    "expiring"->expiring(it,now)
                    "pending"->it.status in listOf("not_started","awaiting_activation")
                    else->it.status==filter
                }
        }.sortedWith(compareBy<Subscription>{
            when{expiring(it,now)->0;it.status=="expired"->1;it.status in listOf("not_started","awaiting_activation")->2;else->3}
        }.thenBy{expiry(it)?:Instant.MAX}.thenBy{it.id})
    }
    fun date(value:String?,zone:ZoneId=ZoneId.systemDefault()):String {
        if(value==null)return "—"
        return runCatching{Instant.parse(value).atZone(zone).format(DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm",Locale("ru")))}.getOrDefault("Некорректная дата")
    }
    data class PaymentSummary(val rows:List<PaymentEvent>,val confirmed:Long,val paid:Int)
    fun payments(events:List<PaymentEvent>,days:Int?,now:Instant,zone:ZoneId):PaymentSummary {
        require(days==null || days in listOf(7,30,90))
        val today=now.atZone(zone).toLocalDate()
        val first=days?.let{today.minusDays(it.toLong()-1)}
        val selected=events.filter{
            val day=Instant.parse(it.recordedAt).atZone(zone).toLocalDate()
            first==null || (!day.isBefore(first)&&!day.isAfter(today))
        }.sortedByDescending{Instant.parse(it.recordedAt)}
        return PaymentSummary(selected,selected.fold(0L){sum,row->Math.addExact(sum,row.amount)},selected.count{it.amount>0})
    }
}
