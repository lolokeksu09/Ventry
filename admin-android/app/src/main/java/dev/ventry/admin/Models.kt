package dev.ventry.admin

import java.math.BigDecimal
import java.net.URI
import java.util.UUID

data class Project(val code: String, val name: String, val packageName: String?, val active: Long,
    val expiring: Long, val expired: Long, val pending: Long, val confirmedKopecks: Long,
    val enabledPlans: Int, val releaseAvailable: Boolean)
data class Plan(val code: String, val kopecks: Long, val enabled: Boolean)
data class Subscription(val id: String, val customerId: String, val product: String, val status: String,
    val validUntil: String?, val installation: String?, val effectivePlan: String?,
    val customerName:String?=null,val customerRevision:Long?=null)
data class CustomerCard(val id:String,val name:String?,val revision:Long)
data class Revenue(val confirmed:Long,val count:Long,val from:String?,val to:String)
data class HistoryLine(val title: String, val detail: String)
data class PaymentEvent(val id:String,val plan:String,val amount:Long,val recordedAt:String,val startsAt:String,val endsAt:String)
data class DownloadGrant(val id: String, val expires: String, val consumed: Boolean, val revoked: Boolean,
    val retryUntil:String?=null,val attempts:Int=0) {
    fun retryAvailable():Boolean = !revoked && attempts in 1..2 && retryUntil?.let{
        runCatching{java.time.Instant.parse(it).isAfter(java.time.Instant.now())}.getOrDefault(false)
    }==true
}
data class History(val lines: List<HistoryLine> = emptyList(), val downloads: List<DownloadGrant> = emptyList(),
    val payments:List<PaymentEvent> = emptyList(),val bindings:List<HistoryLine> = emptyList())
data class DeliveryLink(val url: String, val expires: String)
data class ActivationCode(val code:String,val expires:String,val trial:Boolean)
data class ActivationRecord(val id:String,val expires:String,val trial:Boolean,val consumed:Boolean,val revoked:Boolean)
data class ApprovedRelease(val product: String, val tag: String, val version: String, val sha: String)

object Contract {
    private val code = Regex("[a-z][a-z0-9_-]{0,31}")
    private val pkg = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")
    private val key = Regex("[0-9a-f]{64}")
    private val amount = Regex("[0-9]{1,7}(\\.[0-9]{1,2})?")
    val periods = listOf("trial", "month", "quarter", "year")
    fun code(value: String) = value.matches(code)
    fun packageName(value: String) = value.length <= 180 && value.matches(pkg)
    fun token(value: String) = value.matches(key)
    fun uuid(value: String): String = UUID.fromString(value).toString().also {
        require(it.equals(value, ignoreCase = true) && it != "00000000-0000-0000-0000-000000000000") { "Неверный UUID" }
    }
    fun newId() = UUID.randomUUID().toString()
    fun kopecks(value: String): Long {
        val normalized = value.trim().replace(',', '.')
        require(normalized.matches(amount)) { "Введите сумму с точностью до копейки" }
        return BigDecimal(normalized).movePointRight(2).longValueExact()
    }
    fun money(value: Long) = BigDecimal.valueOf(value, 2).toPlainString().replace('.', ',') + " ₽"
    fun period(value: String?) = when(value) {
        "trial" -> "7 дней"; "month" -> "1 месяц"; "quarter" -> "3 месяца"; "year" -> "1 год"
        else -> value ?: "—"
    }
    fun status(value: String) = when(value) {
        "active" -> "Активна"; "expired" -> "Истекла"; "awaiting_activation" -> "Ожидает активации"
        "not_started" -> "Не начата"; else -> value
    }
    fun origin(value: String, staging: Boolean): String {
        val uri = URI(value.trim())
        require(uri.host != null && uri.userInfo == null && uri.query == null && uri.fragment == null &&
            (uri.path.isNullOrEmpty() || uri.path == "/")) { "Укажите только адрес сервера" }
        require(uri.port == -1 || uri.port in 1..65535) { "Неверный порт" }
        require(uri.scheme == "https" || (staging && uri.scheme == "http" && uri.host == "127.0.0.1")) {
            "Требуется HTTPS; HTTP разрешён только на 127.0.0.1 в staging"
        }
        return uri.toString().trimEnd('/')
    }
    fun downloadUrl(value: String, staging: Boolean): String {
        val uri = URI(value)
        require(uri.host != null && uri.userInfo == null && uri.path == "/download" && uri.query == null &&
            uri.fragment?.matches(key) == true && (uri.scheme == "https" ||
            (staging && uri.scheme == "http" && uri.host == "127.0.0.1"))) { "Неверная ссылка выдачи" }
        return value
    }
}
