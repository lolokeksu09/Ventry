package dev.ventry.admin

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Opt-in device-bound credential vault. The server session is still short-lived.
 * No master credential is placed in saved state, logs, backups or plaintext preferences.
 */
internal class SavedConnection(val origin:String,val key:String,val ca:X509Certificate?)
internal class SavedConnectionStore(private val context:Context) {
    private val prefs=context.getSharedPreferences("admin_connection_v1",Context.MODE_PRIVATE)
    private val alias="ventry.admin.connection.v1"
    private val aad=(context.packageName+":admin_connection_v1").toByteArray(Charsets.UTF_8)
    private val keyguard=context.getSystemService(KeyguardManager::class.java)
    fun secureDevice():Boolean=keyguard?.isDeviceSecure==true
    fun exists():Boolean=prefs.contains("envelope")
    private fun store()=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
    @Suppress("DEPRECATION")
    private fun encryptionKey(create:Boolean):SecretKey {
        val ks=store()
        (ks.getKey(alias,null) as? SecretKey)?.let{return it}
        check(create && secureDevice()){"Device credential required"}
        val spec=KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
        if(Build.VERSION.SDK_INT>=30)spec.setUserAuthenticationParameters(120,KeyProperties.AUTH_DEVICE_CREDENTIAL)
        else spec.setUserAuthenticationValidityDurationSeconds(120)
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(spec.build())}.generateKey()
    }
    private fun encode(b:ByteArray)=Base64.encodeToString(b,Base64.NO_WRAP)
    private fun decode(s:String)=Base64.decode(s,Base64.NO_WRAP)
    fun save(connection:SavedConnection){
        val origin=Contract.origin(connection.origin,false)
        require(Contract.token(connection.key))
        check(secureDevice())
        val raw=JSONObject().apply{
            put("origin",origin);put("key",connection.key)
            put("ca",connection.ca?.let{encode(it.encoded)}?:JSONObject.NULL)
        }.toString().toByteArray(Charsets.UTF_8)
        try{
            val cipher=Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE,encryptionKey(true))
            cipher.updateAAD(aad)
            val envelope=JSONObject().apply{
                put("iv",encode(cipher.iv));put("ciphertext",encode(cipher.doFinal(raw)))
            }
            check(prefs.edit().putString("envelope",envelope.toString()).commit())
        }finally{raw.fill(0)}
    }
    fun load():SavedConnection {
        check(secureDevice())
        val envelope=JSONObject(checkNotNull(prefs.getString("envelope",null)))
        val iv=decode(envelope.getString("iv"))
        require(iv.size==12)
        val cipher=Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE,encryptionKey(false),GCMParameterSpec(128,iv))
        cipher.updateAAD(aad)
        val raw=cipher.doFinal(decode(envelope.getString("ciphertext")))
        try{
            val data=JSONObject(raw.toString(Charsets.UTF_8))
            val origin=Contract.origin(data.getString("origin"),false)
            val key=data.getString("key")
            require(Contract.token(key))
            val ca=if(data.isNull("ca"))null else
                (CertificateFactory.getInstance("X.509").generateCertificate(decode(data.getString("ca")).inputStream()) as X509Certificate)
                    .also{require(it.basicConstraints>=0);it.checkValidity()}
            return SavedConnection(origin,key,ca)
        }finally{raw.fill(0)}
    }
    fun forget(){
        // Remove ciphertext first; never leave an apparently available broken connection.
        check(prefs.edit().remove("envelope").commit())
        store().deleteEntry(alias)
    }
}
