package dev.ventry.admin

import android.content.Context
import java.security.MessageDigest
import java.security.cert.X509Certificate

/** Optional operator-device labels only; never transmitted, never stored with tokens.
 * Application backups are disabled. Scope includes origin, private trust anchor and product.
 */
internal class CustomerLabels(context:Context){
    private val prefs=context.getSharedPreferences("customer_labels_v1",Context.MODE_PRIVATE)
    companion object{
        fun scope(origin:String,ca:X509Certificate?):String {
            val digest=MessageDigest.getInstance("SHA-256")
            digest.update(origin.toByteArray(Charsets.UTF_8));digest.update(0.toByte())
            ca?.let{digest.update(it.encoded)}
            return digest.digest().joinToString(""){"%02x".format(it)}
        }
        fun clean(value:String):String=value.trim().also {
            require(it.length<=80&&it.none{c->c.isISOControl()}) { "Имя: до 80 символов" }
        }
    }
    private fun prefix(scope:String,product:String):String{
        require(scope.matches(Regex("[0-9a-f]{64}"))&&Contract.code(product))
        return scope+":"+product+":"
    }
    fun read(scope:String,product:String):Map<String,String>{
        val prefix=prefix(scope,product)
        return prefs.all.mapNotNull{(key,value)->
            if(key.startsWith(prefix)&&value is String) key.removePrefix(prefix) to value else null
        }.toMap()
    }
    fun save(scope:String,product:String,customer:String,value:String){
        val key=prefix(scope,product)+Contract.uuid(customer)
        val label=clean(value)
        val editor=prefs.edit()
        if(label.isEmpty())editor.remove(key) else editor.putString(key,label)
        check(editor.commit())
    }
}
