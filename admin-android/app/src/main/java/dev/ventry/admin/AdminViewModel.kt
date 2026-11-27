package dev.ventry.admin

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import java.security.cert.X509Certificate
import org.json.JSONObject

data class PendingPayment(val origin:String,val subscription:String,val event:String,val plan:String,val amount:Long)
data class AdminState(
    val connected:Boolean=false,val busy:Boolean=false,val message:String="",val error:Boolean=false,
    val projects:List<Project> = emptyList(),val project:Project?=null,val plans:List<Plan> = emptyList(),
    val subscriptions:List<Subscription> = emptyList(),val next:String?=null,val release:ApprovedRelease?=null,
    val selected:Subscription?=null,val history:History=History(),val link:DeliveryLink?=null,val pending:PendingPayment?=null,
    val activations:List<ActivationRecord> = emptyList(),val activation:ActivationCode?=null
)

class AdminViewModel(application:Application):AndroidViewModel(application) {
    private val prefs=application.getSharedPreferences("pending_payment_v1",0)
    private var api:DeliveryApi?=null
    private var origin=""
    private var generation=0L
    private var job:Job?=null
    private var expiry:Job?=null
    private val mutable=MutableStateFlow(AdminState())
    val state=mutable.asStateFlow()
    private fun pending():PendingPayment? {
        val raw=prefs.getString("payment",null) ?: return null
        val j=JSONObject(raw)
        return PendingPayment(j.getString("origin"),Contract.uuid(j.getString("subscription")),
            Contract.uuid(j.getString("event")),j.getString("plan"),j.getLong("amount"))
    }
    private fun save(p:PendingPayment) {
        check(prefs.edit().putString("payment",JSONObject().apply {
            put("origin",p.origin);put("subscription",p.subscription);put("event",p.event);put("plan",p.plan);put("amount",p.amount)
        }.toString()).commit())
    }
    private fun clear() { check(prefs.edit().remove("payment").commit()) }
    private fun publish(owner:Long,f:(AdminState)->AdminState) { if(owner==generation) mutable.value=f(mutable.value) }
    private fun task(block:suspend(Long)->Unit) {
        if(mutable.value.busy)return
        val owner=generation
        publish(owner){it.copy(busy=true,message="",error=false)}
        job=viewModelScope.launch {
            try {block(owner)}
            catch(e:CancellationException){throw e}
            catch(e:DeliveryApi.Failure){
                if(e.status==401 && owner==generation)lock("Ключ отклонён. Войдите снова.")
                else publish(owner){it.copy(error=true,message=e.message.orEmpty())}
            }
            catch(e:IllegalArgumentException){publish(owner){it.copy(error=true,message="Проверьте адрес, данные и UUID.")}}
            catch(e:Exception){publish(owner){it.copy(error=true,message="Ответ не подтверждён. Проверьте соединение и историю, не повторяйте платёж с новым ID.")}}
            finally {publish(owner){it.copy(busy=false)}}
        }
    }
    fun connect(server:String,key:String,ca:X509Certificate?=null)=task { owner->
        val url=Contract.origin(server,BuildConfig.DEBUG)
        val c=DeliveryApi(url,key.trim(),trustedCa=ca).openSession()
        val p=pending()
        val rows=c.projects()
        if(owner==generation){
            api=c;origin=url;publish(owner){AdminState(connected=true,busy=true,projects=rows,pending=p)}
            expiry?.cancel()
            expiry=viewModelScope.launch{delay(14*60*1000L);if(owner==generation)lock("Срок сеанса истёк. Войдите снова.")}
        }else runCatching{c.closeSession()}
    }
    fun lock(message:String=""){
        val old=api
        generation++;job?.cancel();job=null;expiry?.cancel();expiry=null;api=null;origin=""
        mutable.value=AdminState(message=message,error=message.isNotEmpty())
        if(old!=null)viewModelScope.launch{runCatching{old.closeSession()}}
    }
    private fun client()=checkNotNull(api)
    private suspend fun projectData(owner:Long,code:String,keep:String?=null) {
        val c=client()
        val all=c.projects()
        val p=all.first{it.code==code}
        val plans=c.plans(code)
        val rows=c.subscriptions(code)
        val release=if(p.releaseAvailable)c.release(code) else null
        val selected=keep?.let{c.subscription(it)}
        require(selected==null || selected.product==code)
        val h=if(selected==null)History() else c.history(selected.id)
        val activations=if(selected==null)emptyList() else c.activations(selected.id)
        publish(owner){it.copy(projects=all,project=p,plans=plans,subscriptions=rows,
            next=if(rows.size==100)rows.last().id else null,release=release,selected=selected,history=h,
            pending=pending(),link=if(keep==it.selected?.id)it.link else null,activations=activations,
            activation=if(keep==it.selected?.id)it.activation else null)}
    }
    fun openProject(code:String)=task{owner->
        publish(owner){it.copy(project=null,plans=emptyList(),subscriptions=emptyList(),selected=null,release=null,history=History(),link=null,next=null,activation=null,activations=emptyList())}
        projectData(owner,code)
    }
    fun back(){
        if(mutable.value.busy)return
        val s=mutable.value
        if(s.selected!=null)mutable.value=s.copy(selected=null,history=History(),link=null,activation=null,activations=emptyList(),message="",error=false)
        else if(s.project!=null)mutable.value=s.copy(project=null,plans=emptyList(),subscriptions=emptyList(),release=null,next=null,link=null,message="",error=false)
        else lock()
    }
    fun refresh()=task{owner->
        val s=mutable.value
        if(s.project==null){val rows=client().projects();publish(owner){it.copy(projects=rows,pending=pending())}}
        else projectData(owner,s.project.code,s.selected?.id)
        publish(owner){it.copy(message="Данные обновлены")}
    }
    fun addProject(code:String,name:String,pkg:String)=task{owner->
        client().createProject(code.trim(),name.trim(),pkg.trim())
        projectData(owner,code.trim())
        publish(owner){it.copy(message="Проект зарегистрирован")}
    }
    fun addPlan(code:String,price:String)=task{owner->
        val p=checkNotNull(mutable.value.project)
        client().createPlan(p.code,code,Contract.kopecks(price));projectData(owner,p.code)
        publish(owner){it.copy(message="Тариф зарегистрирован")}
    }
    fun more()=task{owner->
        val s=mutable.value;val p=checkNotNull(s.project);val cursor=s.next?:return@task
        val rows=client().subscriptions(p.code,cursor)
        publish(owner){it.copy(subscriptions=(it.subscriptions+rows).distinctBy(Subscription::id),next=if(rows.size==100)rows.last().id else null)}
    }
    fun select(id:String)=task{owner->
        val p=checkNotNull(mutable.value.project)
        val s=client().subscription(Contract.uuid(id));require(s.product==p.code)
        val h=client().history(s.id);val a=client().activations(s.id)
        publish(owner){it.copy(selected=s,history=h,link=null,pending=pending(),activation=null,activations=a)}
    }
    fun createSubscription(id:String,customer:String)=task{owner->
        val p=checkNotNull(mutable.value.project)
        client().createSubscription(p.code,id,customer);projectData(owner,p.code,id)
        publish(owner){it.copy(message="Подписка создана")}
    }
    fun bind(event:String,device:String)=task{owner->
        val s=checkNotNull(mutable.value.selected)
        client().bind(s.id,event,s.installation,device);projectData(owner,s.product,s.id)
        publish(owner){it.copy(message="Привязка сохранена")}
    }
    fun confirmPayment(plan:Plan,price:String,event:String)=task{owner->
        val s=checkNotNull(mutable.value.selected)
        val amount=Contract.kopecks(price);require(plan.enabled && plan.kopecks==amount)
        val p=PendingPayment(origin,s.id,Contract.uuid(event),plan.code,amount)
        val previous=pending();require(previous==null || previous==p)
        save(p);publish(owner){it.copy(pending=p)}
        client().grant(s.id,p.event,plan,p.amount)
        if(owner!=generation)return@task
        clear();publish(owner){it.copy(pending=null,message="Начисление подтверждено")}
        projectData(owner,s.product,s.id)
    }
    fun retryPayment()=task{owner->
        val p=checkNotNull(pending());require(p.origin==origin)
        val c=client();val s=c.subscription(p.subscription)
        c.grant(s.id,p.event,Plan(p.plan,p.amount,true),p.amount)
        if(owner!=generation)return@task
        clear();publish(owner){it.copy(pending=null,message="Начисление подтверждено")}
        projectData(owner,s.product,s.id)
    }
    fun discardPending()=task{owner->clear();publish(owner){it.copy(pending=null,message="Локальный журнал очищен. Серверные операции не изменены.")}}
    fun issue()=task{owner->
        val s=checkNotNull(mutable.value.selected);require(mutable.value.project?.releaseAvailable==true)
        val link=client().issue(s.id,Contract.newId());publish(owner){it.copy(link=link,message="Ссылка создана")}
        projectData(owner,s.product,s.id)
    }
    fun issueActivation(trial:Boolean)=task{owner->
        val s=checkNotNull(mutable.value.selected)
        val a=client().issueActivation(s.id,Contract.newId(),trial)
        publish(owner){it.copy(activation=a,message="Код активации создан")}
        projectData(owner,s.product,s.id)
    }
    fun revokeActivation(event:String)=task{owner->
        val s=checkNotNull(mutable.value.selected)
        client().revokeActivation(s.id,event)
        publish(owner){it.copy(activation=null,message="Код отозван")}
        projectData(owner,s.product,s.id)
    }
    fun revoke(event:String)=task{owner->
        val s=checkNotNull(mutable.value.selected);client().revoke(s.id,event)
        publish(owner){it.copy(link=null,message="Ссылка отозвана")};projectData(owner,s.product,s.id)
    }
}
