package dev.ventry.admin

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.ByteArrayOutputStream

/** No credentials in URLs, logs, persistent storage, redirects or build configuration. */
class DeliveryApi(origin: String, private val token: String, private val staging: Boolean = BuildConfig.DEBUG) {
    private val base = Contract.origin(origin, staging)
    init { require(Contract.token(token)) { "Ключ доступа должен содержать 64 шестнадцатеричных символа" } }

    class Failure(val status: Int) : Exception(when(status) {
        400, 422 -> "Проверьте введённые данные"
        401 -> "Ключ доступа отклонён"
        404 -> "Запись не найдена"
        409 -> "Конфликт операции. Проверьте сумму, ID или историю"
        429 -> "Лимит запросов. Повторите позже"
        503 -> "Сервис недоступен"
        else -> "Ошибка сервера: $status"
    })

    private suspend fun request(path: String, body: JSONObject? = null): String = withContext(Dispatchers.IO) {
        require(path.startsWith("/api/v1/"))
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8000
            connection.readTimeout = 15000
            connection.useCaches = false
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Accept", "application/json")
            if(body != null) {
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                require(bytes.size <= 4096) { "Слишком большой запрос" }
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type","application/json")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            if(status != 200) throw Failure(status)
            require(connection.contentType?.startsWith("application/json") == true) { "Неожиданный формат ответа" }
            connection.inputStream.use { stream ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while(true) {
                    val n = stream.read(buffer)
                    if(n < 0) break
                    require(out.size() + n <= 2 * 1024 * 1024) { "Ответ превышает допустимый размер" }
                    out.write(buffer,0,n)
                }
                out.toString("UTF-8")
            }
        } finally { connection.disconnect() }
    }
    private fun JSONObject.nullable(key: String) = if(isNull(key)) null else getString(key)
    private fun <T> JSONArray.mapItems(block: (JSONObject)->T): List<T> = (0 until length()).map { block(getJSONObject(it)) }
    private fun JSONObject.sub() = Subscription(getString("id"),getString("customer_id"),getString("product_code"),
        getString("status"),nullable("valid_until"),nullable("installation_id"),nullable("effective_plan"))
    private fun objectOf(vararg entries: Pair<String,Any?>) = JSONObject().apply {
        entries.forEach { (k,v) -> put(k,v ?: JSONObject.NULL) }
    }
    private fun product(code: String): String { require(Contract.code(code)); return code }
    private fun sub(id: String) = "/api/v1/subscriptions/" + Contract.uuid(id)
    suspend fun projects(): List<Project> = JSONArray(request("/api/v1/projects")).mapItems {
        Project(it.getString("code"),it.getString("display_name"),it.nullable("package_name"),
            it.getLong("active_subscriptions"),it.getLong("expiring_soon"),it.getLong("expired_subscriptions"),
            it.getLong("pending_subscriptions"),it.getLong("confirmed_kopecks"),it.getInt("enabled_plans"),
            it.getBoolean("release_available"))
    }
    suspend fun createProject(code: String, name: String, packageName: String) {
        require(Contract.code(code) && name.isNotBlank() && name == name.trim() && name.length <= 100 &&
            Contract.packageName(packageName)) { "Проверьте код, название и package ID" }
        request("/api/v1/projects",objectOf("code" to code,"display_name" to name,"package_name" to packageName))
    }
    suspend fun plans(code: String): List<Plan> =
        JSONArray(request("/api/v1/projects/" + product(code) + "/plans")).mapItems {
            Plan(it.getString("code"),it.getLong("amount_kopecks"),it.getBoolean("enabled"))
        }
    suspend fun createPlan(project: String, plan: String, amount: Long) {
        require(plan in Contract.periods && amount in 0..1_000_000_000L && ((plan=="trial")==(amount==0L)))
        request("/api/v1/projects/" + product(project) + "/plans",objectOf("code" to plan,"amount_kopecks" to amount))
    }
    suspend fun subscriptions(code: String, after: String? = null): List<Subscription> =
        JSONArray(request("/api/v1/subscriptions?product=" + product(code) +
            (after?.let { "&after=" + Contract.uuid(it) } ?: ""))).mapItems { it.sub() }.also {
            require(it.all { row -> row.product == code }) { "Ответ относится к другому проекту" }
        }
    suspend fun subscription(id: String): Subscription = JSONObject(request(sub(id))).sub()
    suspend fun createSubscription(project: String,id: String,customer: String) {
        request("/api/v1/subscriptions",objectOf("id" to Contract.uuid(id),"customer_id" to Contract.uuid(customer),"product" to product(project)))
    }
    suspend fun grant(id: String,event: String,plan: Plan,amount: Long) {
        require(plan.enabled && plan.kopecks == amount && plan.code in Contract.periods) { "Сумма должна соответствовать тарифу" }
        request(sub(id)+"/grant",objectOf("event_id" to Contract.uuid(event),"plan" to plan.code,
            "confirmed_kopecks" to amount,"confirmed" to true))
    }
    suspend fun bind(id: String,event: String,old: String?,next: String) {
        request(sub(id)+"/installation",objectOf("event_id" to Contract.uuid(event),"old_installation" to old?.let(Contract::uuid),
            "new_installation" to Contract.uuid(next)))
    }
    suspend fun issue(id: String,event: String): DeliveryLink {
        val r=JSONObject(request(sub(id)+"/download",objectOf("event_id" to Contract.uuid(event))))
        return DeliveryLink(Contract.downloadUrl(r.getString("url"),staging),r.getJSONObject("grant").getString("expires_at"))
    }
    suspend fun revoke(id: String,event: String) {
        request(sub(id)+"/downloads/"+Contract.uuid(event)+"/revoke",JSONObject())
    }
    suspend fun activations(id:String):List<ActivationRecord> =
        JSONArray(request(sub(id)+"/activations")).mapItems {
            ActivationRecord(it.getString("id"),it.getString("expires_at"),it.getBoolean("trial"),!it.isNull("consumed_at"),!it.isNull("revoked_at"))
        }
    suspend fun issueActivation(id:String,event:String,trial:Boolean):ActivationCode {
        val r=JSONObject(request(sub(id)+"/activations",objectOf("event_id" to Contract.uuid(event),"trial" to trial)))
        val code=r.getString("code")
        require(Contract.token(code))
        return ActivationCode(code,r.getJSONObject("activation").getString("expires_at"),trial)
    }
    suspend fun revokeActivation(id:String,event:String){
        request(sub(id)+"/activations/"+Contract.uuid(event)+"/revoke",JSONObject())
    }
    suspend fun release(project: String): ApprovedRelease {
        val r=JSONObject(request("/api/v1/release"))
        require(r.getString("product")==project) { "Сборка другого проекта" }
        return ApprovedRelease(project,r.getString("tag"),r.getString("version_name"),r.getString("sha256"))
    }
    suspend fun history(id: String): History {
        val r=JSONObject(request(sub(id)+"/history"))
        val grants=r.getJSONArray("grants").mapItems {
            HistoryLine(Contract.period(it.getString("plan_code"))+" · "+Contract.money(it.getLong("amount_kopecks")),
                it.getString("starts_at")+" → "+it.getString("ends_at")+"\n"+it.getString("id"))
        }
        val bindings=r.getJSONArray("installations").mapItems {
            HistoryLine(if(it.isNull("old_installation")) "Привязка" else "Перенос",it.getString("recorded_at")+"\n"+it.getString("new_installation"))
        }
        return History(grants+bindings,r.getJSONArray("downloads").mapItems {
            DownloadGrant(it.getString("id"),it.getString("expires_at"),!it.isNull("consumed_at"),!it.isNull("revoked_at"))
        })
    }
}
