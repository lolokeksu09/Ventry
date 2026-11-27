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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.security.cert.X509Certificate
import org.json.JSONObject

data class PendingPayment(val origin:String,val subscription:String,val event:String,val plan:String,val amount:Long)
data class AdminState(
    val connected:Boolean=false,val busy:Boolean=false,val message:String="",val error:Boolean=false,
    val projects:List<Project> = emptyList(),val project:Project?=null,val plans:List<Plan> = emptyList(),
    val subscriptions:List<Subscription> = emptyList(),val next:String?=null,val release:ApprovedRelease?=null,
    val selected:Subscription?=null,val history:History=History(),val link:DeliveryLink?=null,val pending:PendingPayment?=null,
    val activations:List<ActivationRecord> = emptyList(),val activation:ActivationCode?=null,
    val labels:Map<String,String> = emptyMap(),val savedConnection:Boolean=false,
    val serverDesk:Boolean=false,val deskQuery:String="",val deskFilter:String="all",
    val revenue:Revenue?=null,val revenueDays:Int?=null,val customerCard:CustomerCard?=null,val paymentNext:String?=null
)

class AdminViewModel(application:Application):AndroidViewModel(application) {
    private val prefs=application.getSharedPreferences("pending_payment_v1",0)
    private val labels=CustomerLabels(application)
    private val connectionStore=SavedConnectionStore(application)
    private var labelScope=""
    private var api:DeliveryApi?=null
    private var origin=""
    private var generation=0L
    private var job:Job?=null
    private var expiry:Job?=null
    private val mutable=MutableStateFlow(AdminState(savedConnection=connectionStore.exists()))
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
    fun canSaveConnection():Boolean=connectionStore.secureDevice()
    fun connect(server:String,key:String,ca:X509Certificate?=null,rememberConnection:Boolean=false)=task { owner->
        connectInternal(owner,server,key,ca,rememberConnection)
    }
    fun connectSaved()=task { owner->
        val saved=try{withContext(Dispatchers.IO){connectionStore.load()}}
        catch(e:CancellationException){throw e}
        catch(_:Exception){
            publish(owner){it.copy(error=true,message="Не удалось открыть сохранённое подключение. Повторите разблокировку или настройте вход заново.")}
            return@task
        }
        connectInternal(owner,saved.origin,saved.key,saved.ca,false)
    }
    fun forgetConnection()=task { owner->
        try{withContext(Dispatchers.IO){connectionStore.forget()}}
        finally{publish(owner){it.copy(savedConnection=connectionStore.exists())}}
    }
    private suspend fun connectInternal(owner:Long,server:String,key:String,ca:X509Certificate?,rememberConnection:Boolean){
        val url=Contract.origin(server,BuildConfig.DEBUG)
        val c=DeliveryApi(url,key.trim(),trustedCa=ca).openSession()
        val p:PendingPayment?
        val rows:List<Project>
        try { p=pending();rows=c.projects() }
        catch(e:Exception){runCatching{c.closeSession()};throw e}
        if(owner==generation){
            var warning=""
            if(rememberConnection){
                try{withContext(Dispatchers.IO){connectionStore.save(SavedConnection(url,key.trim(),ca))}}
                catch(e:CancellationException){runCatching{c.closeSession()};throw e}
                catch(_:Exception){warning="Вход выполнен, но сохранить подключение не удалось. Проверьте блокировку устройства."}
            }
            if(owner!=generation){runCatching{c.closeSession()};return}
            api=c;origin=url;labelScope=CustomerLabels.scope(url,ca);publish(owner){AdminState(connected=true,busy=true,projects=rows,pending=p,savedConnection=connectionStore.exists(),message=warning,error=warning.isNotEmpty())}
            expiry?.cancel()
            expiry=viewModelScope.launch{delay(14*60*1000L);if(owner==generation)lock("Сеанс завершён. Откройте сохранённое подключение или войдите вручную.")}
        }else runCatching{c.closeSession()}
    }
    fun lock(message:String=""){
        val old=api
        generation++;job?.cancel();job=null;expiry?.cancel();expiry=null;api=null;origin="";labelScope=""
        mutable.value=AdminState(message=message,error=message.isNotEmpty(),savedConnection=connectionStore.exists())
        if(old!=null)viewModelScope.launch{runCatching{old.closeSession()}}
    }
    private fun client()=checkNotNull(api)
    private suspend fun projectData(owner:Long,code:String,keep:String?=null) {
        val c=client()
        val all=c.projects()
        val p=all.first{it.code==code}
        val plans=c.plans(code)
        val previous=mutable.value
        val same=previous.project?.code==code
        val q=if(same)previous.deskQuery else ""
        val filter=if(same)previous.deskFilter else "all"
        val days=if(same)previous.revenueDays else null
        // Explicit legacy compatibility: only a missing desk route on a known project falls back.
        val desk=try{c.desk(code,q,filter)}catch(e:DeliveryApi.Failure){if(e.status==404)null else throw e}
        val online=desk!=null
        val rows=desk?:c.subscriptions(code)
        val revenue=if(online)c.revenue(code,days) else null
        val release=if(p.releaseAvailable)c.release(code) else null
        val selected=keep?.let{c.subscription(it)}
        require(selected==null || selected.product==code)
        val card=if(online&&selected!=null)c.customer(selected.customerId) else null
        val full=if(online&&selected!=null)c.paymentPage(selected.id) else null
        val h=if(selected==null)History() else c.history(selected.id).let{if(full!=null)it.copy(payments=full) else it}
        val activations=if(selected==null)emptyList() else c.activations(selected.id)
        publish(owner){it.copy(projects=all,project=p,plans=plans,subscriptions=rows,
            next=if(rows.size==100)rows.last().id else null,release=release,selected=selected,history=h,
            pending=pending(),link=if(keep==it.selected?.id)it.link else null,activations=activations,
            labels=labels.read(labelScope,code),serverDesk=online,deskQuery=if(online)q else "",deskFilter=if(online)filter else "all",
            revenue=revenue,revenueDays=days,customerCard=card,paymentNext=if(full?.size==100)full.last().id else null,
            activation=if(keep==it.selected?.id)it.activation else null)}
    }
    fun openProject(code:String)=task{owner->
        publish(owner){it.copy(project=null,plans=emptyList(),subscriptions=emptyList(),selected=null,release=null,history=History(),link=null,next=null,activation=null,activations=emptyList(),labels=emptyMap())}
        projectData(owner,code)
    }
    fun back(){
        if(mutable.value.busy)return
        val s=mutable.value
        if(s.selected!=null)mutable.value=s.copy(selected=null,history=History(),link=null,activation=null,activations=emptyList(),message="",error=false)
        else if(s.project!=null)mutable.value=s.copy(project=null,plans=emptyList(),subscriptions=emptyList(),release=null,next=null,link=null,message="",error=false,labels=emptyMap(),serverDesk=false,deskQuery="",deskFilter="all",revenue=null,revenueDays=null,customerCard=null,paymentNext=null)
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
    fun searchDesk(query:String,filter:String)=task{owner->
        val s=mutable.value;val p=checkNotNull(s.project);require(s.serverDesk)
        val q=query.trim();val rows=client().desk(p.code,q,filter)
        publish(owner){it.copy(deskQuery=q,deskFilter=filter,subscriptions=rows,next=if(rows.size==100)rows.last().id else null)}
    }
    fun revenuePeriod(days:Int?)=task{owner->
        val s=mutable.value;require(s.serverDesk);val r=client().revenue(checkNotNull(s.project).code,days)
        publish(owner){it.copy(revenue=r,revenueDays=days)}
    }
    fun morePayments()=task{owner->
        val s=mutable.value;val id=checkNotNull(s.selected).id;val cursor=s.paymentNext?:return@task
        val rows=client().paymentPage(id,cursor)
        require(rows.none{row->s.history.payments.any{it.id==row.id}}){"Пересечение страниц"}
        publish(owner){it.copy(history=it.history.copy(payments=it.history.payments+rows),paymentNext=if(rows.size==100)rows.last().id else null)}
    }
    fun more()=loadPages(1)
    fun loadBatch()=loadPages(20)
    private fun loadPages(maxPages:Int)=task{owner->
        val p=checkNotNull(mutable.value.project)
        val c=client()
        var pages=0
        while(pages<maxPages && owner==generation){
            val cursor=mutable.value.next?:break
            val state=mutable.value
            val rows=if(state.serverDesk)c.desk(p.code,state.deskQuery,state.deskFilter,cursor) else c.subscriptions(p.code,cursor)
            require(rows.none{row->state.subscriptions.any{it.id==row.id}}){"Пересечение страниц; обновите список"}
            publish(owner){it.copy(subscriptions=if(state.serverDesk)it.subscriptions+rows else SubscriptionDesk.merge(it.subscriptions,rows),
                next=if(rows.size==100)rows.last().id else null)}
            pages++
        }
        publish(owner){it.copy(message=if(it.next==null)"Все страницы загружены" else "Загружено "+it.subscriptions.size+" подписок. Есть ещё страницы.")}
    }
    fun saveLabel(customer:String,value:String)=task{owner->
        val s=mutable.value;val p=checkNotNull(s.project)
        require(s.selected?.customerId==customer || s.subscriptions.any{it.customerId==customer})
        if(s.serverDesk){
            val card=checkNotNull(s.customerCard);require(card.id==customer)
            val name=CustomerLabels.clean(value).ifEmpty{null}
            val updated=client().renameCustomer(customer,name,card.revision)
            publish(owner){it.copy(customerCard=updated,subscriptions=it.subscriptions.map{row->
                if(row.customerId==customer)row.copy(customerName=updated.name,customerRevision=updated.revision) else row
            })}
            projectData(owner,p.code,s.selected?.id)
            publish(owner){it.copy(message="Имя сохранено на сервере",busy=false)}
        }else{
            labels.save(labelScope,p.code,customer,value)
            publish(owner){it.copy(labels=labels.read(labelScope,p.code),message="Локальное имя сохранено")}
        }
    }
    fun select(id:String)=task{owner->
        val p=checkNotNull(mutable.value.project)
        val s=client().subscription(Contract.uuid(id));require(s.product==p.code)
        val online=mutable.value.serverDesk
        val card=if(online)client().customer(s.customerId) else null
        val full=if(online)client().paymentPage(s.id) else null
        val h=client().history(s.id).let{if(full!=null)it.copy(payments=full) else it};val a=client().activations(s.id)
        publish(owner){it.copy(selected=s,history=h,link=null,pending=pending(),activation=null,activations=a,
            customerCard=card,paymentNext=if(full?.size==100)full.last().id else null)}
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
