package dev.ventry.admin

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModelProvider

private val Night=Color(0xFF080B09)
private val PanelColor=Color(0xFF121915)
private val Leaf=Color(0xFFCFE4B8)
private val Muted=Color(0xFFACB9AD)
private val Line=Color(0xFF354238)

class MainActivity:ComponentActivity(){
    override fun onCreate(savedInstanceState:Bundle?){
        super.onCreate(savedInstanceState)
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge(statusBarStyle=SystemBarStyle.dark(android.graphics.Color.BLACK),navigationBarStyle=SystemBarStyle.dark(android.graphics.Color.BLACK))
        val vm=ViewModelProvider(this)[AdminViewModel::class.java]
        setContent{
            MaterialTheme(colorScheme=darkColorScheme(primary=Leaf,onPrimary=Color(0xFF172416),background=Night,surface=PanelColor,onSurface=Color(0xFFF1F4ED),onBackground=Color(0xFFF1F4ED),onSurfaceVariant=Muted,outline=Line,error=Color(0xFFFFB8AD))){
                val state by vm.state.collectAsState()
                AdminScreen(state,vm)
            }
        }
    }
}

@Composable
private fun AdminScreen(s:AdminState,vm:AdminViewModel){
    BackHandler(s.connected){vm.back()}
    Column(Modifier.fillMaxSize().background(Night).safeDrawingPadding().imePadding()){
        Row(Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f)){
                Text("VENTRY  /  ADMIN",color=Leaf,fontSize=12.sp,letterSpacing=1.5.sp,fontWeight=FontWeight.Bold)
                Text(if(s.selected!=null)"Подписка" else s.project?.name ?: "Проекты",style=MaterialTheme.typography.headlineSmall)
            }
            if(s.connected){
                if(s.project!=null)TextButton(onClick=vm::back,enabled=!s.busy){Text("Назад")}
                TextButton(onClick={vm.lock()},modifier=Modifier.testTag("logout")){Text("Выйти")}
            }
        }
        HorizontalDivider(color=Line)
        if(s.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(s.message.isNotBlank())Text(s.message,Modifier.fillMaxWidth().padding(12.dp),color=if(s.error)MaterialTheme.colorScheme.error else Leaf)
        Box(Modifier.weight(1f)){
            when{
                !s.connected -> Login(s,vm)
                s.selected!=null -> Detail(s,vm)
                s.project!=null -> ProjectScreen(s,vm)
                else -> Catalog(s,vm)
            }
        }
    }
}
@Composable
private fun Login(s:AdminState,vm:AdminViewModel){
    var server by remember{mutableStateOf("")};var token by remember{mutableStateOf("")}
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
        item{Text("Вход в центр управления",style=MaterialTheme.typography.titleLarge)}
        item{Text("Закрытый тестовый контур. Ключ не сохраняется после выхода.",color=Muted)}
        item{Field("Адрес HTTPS",server,{server=it},!s.busy,"server")}
        item{OutlinedTextField(token,{token=it},Modifier.fillMaxWidth().testTag("token"),label={Text("Ключ администратора")},singleLine=true,enabled=!s.busy,
            visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password))}
        item{Action("Подключиться",!s.busy && server.isNotBlank() && token.isNotBlank(),"connect"){val key=token;token="";vm.connect(server,key)}}
        if(BuildConfig.DEBUG)item{Text("STAGING: HTTP только на 127.0.0.1 через локальный туннель. Не используйте production-ключи.",color=Muted,fontSize=12.sp)}
    }
}
@Composable
private fun Field(label:String,value:String,change:(String)->Unit,enabled:Boolean=true,tag:String="",numeric:Boolean=false){
    OutlinedTextField(value,change,Modifier.fillMaxWidth().then(if(tag.isNotEmpty())Modifier.testTag(tag) else Modifier),
        label={Text(label)},singleLine=true,enabled=enabled,keyboardOptions=KeyboardOptions(keyboardType=if(numeric)KeyboardType.Decimal else KeyboardType.Text))
}
@Composable
private fun Panel(content:@Composable ColumnScope.()->Unit){
    Surface(Modifier.fillMaxWidth(),color=PanelColor,shape=RoundedCornerShape(12.dp),border=BorderStroke(1.dp,Line)){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(9.dp),content=content)
    }
}
@Composable
private fun Heading(label:String){Text(label,style=MaterialTheme.typography.titleMedium,fontWeight=FontWeight.SemiBold)}
@Composable
private fun Fact(label:String,value:String){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Text(label,Modifier.weight(.42f),color=Muted,fontSize=13.sp);Text(value,Modifier.weight(.58f),fontSize=13.sp)
    }
}
@Composable
private fun Action(label:String,enabled:Boolean=true,tag:String="",onClick:()->Unit){
    Button(onClick=onClick,enabled=enabled,modifier=Modifier.fillMaxWidth().then(if(tag.isNotEmpty())Modifier.testTag(tag) else Modifier)){Text(label)}
}
@Composable
private fun Secondary(label:String,enabled:Boolean=true,onClick:()->Unit){
    OutlinedButton(onClick=onClick,enabled=enabled,modifier=Modifier.fillMaxWidth()){Text(label)}
}
@Composable
private fun Choice(options:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit,enabled:Boolean){
    var expanded by remember{mutableStateOf(false)}
    Box{
        OutlinedButton(onClick={expanded=true},enabled=enabled && options.isNotEmpty(),modifier=Modifier.fillMaxWidth()){
            Text(options.firstOrNull{it.first==selected}?.second ?: "Выбрать")
        }
        DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){options.forEach{(key,title)->
            DropdownMenuItem(text={Text(title)},onClick={expanded=false;onSelect(key)})
        }}
    }
}
@Composable
private fun Confirm(title:String,message:String,cancel:()->Unit,confirm:()->Unit){
    AlertDialog(onDismissRequest=cancel,title={Text(title)},text={Text(message)},confirmButton={TextButton(onClick=confirm){Text("Подтвердить")}},
        dismissButton={TextButton(onClick=cancel){Text("Отмена")}})
}
@Composable
private fun PendingPanel(s:AdminState,vm:AdminViewModel){
    val p=s.pending ?: return
    var discard by remember{mutableStateOf(false)}
    Panel{
        Heading("Незавершённое начисление");Text("Повтор использует сохранённый ID. Не подтверждайте этот платёж заново.",color=Muted)
        Fact("Сумма",Contract.money(p.amount));Fact("Подписка",p.subscription);Fact("Операция",p.event)
        Action("Повторить подтверждение",!s.busy){vm.retryPayment()}
        Secondary("Очистить локальный журнал",!s.busy){discard=true}
    }
    if(discard)Confirm("Очистить журнал?","Только после проверки истории сервера. Это не отменяет начисление.",{discard=false},{discard=false;vm.discardPending()})
}

@Composable
private fun Catalog(s:AdminState,vm:AdminViewModel){
    var adding by remember{mutableStateOf(false)};var code by remember{mutableStateOf("")};var name by remember{mutableStateOf("")};var pkg by remember{mutableStateOf("")}
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        item{PendingPanel(s,vm);Row(verticalAlignment=Alignment.CenterVertically){Text("Каталог продуктов",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);TextButton(onClick=vm::refresh,enabled=!s.busy){Text("Обновить")}}}
        if(s.projects.isEmpty())item{Text("Проекты пока отсутствуют",color=Muted)}
        items(s.projects,key={it.code}){p->
            Surface(Modifier.fillMaxWidth().clickable(enabled=!s.busy){vm.openProject(p.code)}.testTag("project_"+p.code),color=PanelColor,shape=RoundedCornerShape(12.dp),border=BorderStroke(1.dp,Line)){
                Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Row(verticalAlignment=Alignment.CenterVertically){Text(p.name,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold);Text("›",color=Leaf,fontSize=26.sp)}
                    Text(p.packageName ?: p.code,color=Muted,fontSize=12.sp)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                        Column{Text(p.active.toString(),fontSize=24.sp,color=Leaf);Text("Активны",color=Muted,fontSize=12.sp)}
                        Column{Text(p.expiring.toString(),fontSize=24.sp);Text("Истекают",color=Muted,fontSize=12.sp)}
                        Column{Text(p.expired.toString(),fontSize=24.sp);Text("Истекли",color=Muted,fontSize=12.sp)}
                    }
                    Text("Начислено: "+Contract.money(p.confirmedKopecks),fontSize=13.sp)
                }
            }
        }
        item{
            Secondary(if(adding)"Свернуть" else "Добавить проект",!s.busy){adding=!adding}
            if(adding)Panel{
                Field("Название",name,{name=it},!s.busy,"new_project_name");Field("Код",code,{code=it},!s.busy,"new_project_code")
                Field("Android package ID",pkg,{pkg=it},!s.busy,"new_project_package")
                Text("Тарифы и проверенный APK подключаются отдельно.",fontSize=12.sp,color=Muted)
                Action("Создать проект",!s.busy && name.isNotBlank() && Contract.code(code.trim()) && Contract.packageName(pkg.trim()),"create_project"){vm.addProject(code,name,pkg)}
            }
        }
    }
}

@Composable
private fun ProjectScreen(s:AdminState,vm:AdminViewModel){
    val p=checkNotNull(s.project)
    var tab by remember(p.code){mutableIntStateOf(0)}
    var search by remember(p.code){mutableStateOf("")};var filter by remember(p.code){mutableStateOf("all")}
    var creating by remember(p.code){mutableStateOf(false)}
    var customer by remember(p.code){mutableStateOf(Contract.newId())};var subscription by remember(p.code){mutableStateOf(Contract.newId())}
    var openId by remember(p.code){mutableStateOf("")}
    var planCode by remember(p.code){mutableStateOf("")};var price by remember(p.code){mutableStateOf("")};var confirmPlan by remember(p.code){mutableStateOf(false)}
    Column{
        TabRow(selectedTabIndex=tab,containerColor=Night,contentColor=Leaf){listOf("Подписки","Тарифы","Релиз").forEachIndexed{index,title->
            Tab(selected=tab==index,onClick={if(!s.busy)tab=index},text={Text(title,fontSize=13.sp)})
        }}
        LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            item{PendingPanel(s,vm);Row(verticalAlignment=Alignment.CenterVertically){Text(p.packageName ?: p.code,Modifier.weight(1f),color=Muted,fontSize=12.sp);TextButton(onClick=vm::refresh,enabled=!s.busy){Text("Обновить")}}}
            when(tab){
                0->{
                    item{Panel{Fact("Активны",p.active.toString());Fact("Истекают за 7 дней",p.expiring.toString());Fact("Истекли",p.expired.toString());Fact("Ожидают",p.pending.toString());Fact("Начислено",Contract.money(p.confirmedKopecks))}}
                    item{
                        Field("Поиск по ID среди загруженных",search,{search=it},!s.busy)
                        Choice(listOf("all" to "Все","active" to "Активны","expired" to "Истекли","pending" to "Ожидают"),filter,{filter=it},!s.busy)
                        Secondary(if(creating)"Свернуть" else "Создать подписку",!s.busy){creating=!creating}
                        if(creating)Panel{
                            Field("ID клиента",customer,{customer=it},!s.busy,"customer_id");Field("ID подписки",subscription,{subscription=it},!s.busy,"subscription_id")
                            Secondary("Новые UUID",!s.busy){customer=Contract.newId();subscription=Contract.newId()}
                            Action("Создать",!s.busy,"create_subscription"){vm.createSubscription(subscription,customer)}
                        }
                        Field("Открыть по UUID",openId,{openId=it},!s.busy);Secondary("Открыть",!s.busy && openId.isNotBlank()){vm.select(openId)}
                    }
                    val rows=s.subscriptions.filter{(search.isBlank() || it.id.contains(search,true) || it.customerId.contains(search,true)) &&
                        (filter=="all" || it.status==filter || (filter=="pending" && it.status in listOf("not_started","awaiting_activation")))}
                    if(rows.isEmpty())item{Text("Нет подписок в выбранном списке",color=Muted)}
                    items(rows,key={it.id}){sub->
                        Surface(Modifier.fillMaxWidth().clickable(enabled=!s.busy){vm.select(sub.id)}.testTag("subscription_"+sub.id),color=PanelColor,shape=RoundedCornerShape(12.dp),border=BorderStroke(1.dp,Line)){
                            Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(5.dp)){
                                Text(Contract.status(sub.status),color=if(sub.status=="active")Leaf else Muted,fontWeight=FontWeight.SemiBold)
                                Text(sub.customerId,fontSize=13.sp);Text("До: "+(sub.validUntil ?: "—"),fontSize=12.sp,color=Muted)
                            }
                        }
                    }
                    if(s.next!=null)item{Secondary("Загрузить ещё",!s.busy){vm.more()}}
                }
                1->{
                    items(s.plans,key={it.code}){plan->Panel{Heading(Contract.period(plan.code));Text(Contract.money(plan.kopecks),fontSize=24.sp);Text(if(plan.enabled)"Доступен" else "Отключён",color=Muted)}}
                    item{
                        val available=Contract.periods.filter{code->s.plans.none{it.code==code}}
                        if(available.isEmpty())Text("Все периоды настроены. Изменение цены пока недоступно.",color=Muted)
                        else Panel{
                            Heading("Добавить тариф");Choice(available.map{it to Contract.period(it)},planCode,{planCode=it;price=if(it=="trial")"0" else ""},!s.busy)
                            Field("Цена, ₽",price,{price=it},!s.busy,numeric=true)
                            Action("Создать тариф",!s.busy && planCode in available && price.isNotBlank()){confirmPlan=true}
                        }
                    }
                }
                2->item{Panel{
                    Heading("Одобренная сборка");val r=s.release
                    if(r==null)Text("Для этого проекта APK ещё не зарегистрирован.",color=Muted)
                    else{Fact("Версия",r.version);Fact("Тег",r.tag);Fact("SHA-256",r.sha);Text("Предварительный релиз. Выдача не активирует подписку.",color=Muted)}
                }}
            }
        }
    }
    if(confirmPlan)Confirm("Создать тариф?","Цена пока не редактируется.",{confirmPlan=false},{confirmPlan=false;vm.addPlan(planCode,price)})
}

@Composable
private fun Detail(s:AdminState,vm:AdminViewModel){
    val sub=checkNotNull(s.selected);val context=LocalContext.current
    var action by remember(sub.id){mutableStateOf("history")};var planCode by remember(sub.id){mutableStateOf("")};var price by remember(sub.id){mutableStateOf("")}
    var paymentId by remember(sub.id){mutableStateOf(Contract.newId())};var bindId by remember(sub.id){mutableStateOf(Contract.newId())}
    var device by remember(sub.id){mutableStateOf("")};var confirm by remember(sub.id){mutableStateOf("")};var revokeId by remember(sub.id){mutableStateOf("")}
    val plan=s.plans.firstOrNull{it.enabled && it.code==planCode}
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        item{PendingPanel(s,vm);Panel{
            Heading(Contract.status(sub.status));Fact("Клиент",sub.customerId);Fact("Подписка",sub.id);Fact("До",sub.validUntil ?: "—")
            Fact("Установка",sub.installation ?: "Не привязана");Fact("Тариф",Contract.period(sub.effectivePlan));Secondary("Обновить",!s.busy){vm.refresh()}
        }}
        item{Choice(listOf("history" to "История","grant" to "Продление / пробный доступ","bind" to "Устройство","download" to "Выдача APK","activation" to "Лицензия / активация"),action,{action=it},!s.busy)}
        when(action){
            "grant"->item{Panel{
                Heading("Подтверждение оплаты")
                Choice(s.plans.filter{it.enabled}.map{it.code to (Contract.period(it.code)+" · "+Contract.money(it.kopecks))},planCode,{
                    planCode=it;price=java.math.BigDecimal.valueOf(s.plans.first{p->p.code==it}.kopecks,2).toPlainString()
                },!s.busy && s.pending==null)
                Field("Получено, ₽",price,{price=it},!s.busy && s.pending==null,numeric=true);Fact("ID операции",paymentId)
                Text("Подтверждение не списывает деньги. После сбоя используйте сохранённый ID.",color=Muted,fontSize=12.sp)
                Action("Подтвердить начисление",!s.busy && s.pending==null && plan!=null && price.isNotBlank()){confirm="grant"}
                Secondary("Новый ID для другого платежа",!s.busy && s.pending==null){paymentId=Contract.newId()}
            }}
            "bind"->item{Panel{
                Heading(if(sub.installation==null)"Привязка" else "Перенос устройства");Field("Новый ID установки",device,{device=it},!s.busy);Fact("ID операции",bindId)
                Secondary("Новый ID операции",!s.busy){bindId=Contract.newId()};Action("Сохранить привязку",!s.busy && device.isNotBlank()){confirm="bind"}
            }}
            "activation"->{
                item{Panel{
                    Heading("Активация лицензии")
                    Text("Код действует 24 часа. Пробный период начинается при первой активации. Платный код использует существующий оплаченный срок.",color=Muted)
                    Action("Выдать оплаченный код",!s.busy && sub.status in listOf("active","awaiting_activation")){confirm="activation"}
                    Action("Выдать 7 дней",!s.busy && sub.status=="not_started" && sub.installation==null && s.plans.any{it.code=="trial" && it.enabled}){confirm="trial_activation"}
                    s.activation?.let{a->
                        Fact("Истекает",a.expires)
                        Text(a.code,color=Leaf,fontSize=13.sp)
                        Action("Поделиться кодом",!s.busy){
                            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply{
                                type="text/plain";putExtra(Intent.EXTRA_TEXT,"Код активации "+(s.project?.name ?: sub.product)+": "+a.code)
                            },"Передать код"))
                        }
                    }
                    Text("Текущий опубликованный APK «Расчёта» пока не умеет активировать эти коды.",color=Muted,fontSize=12.sp)
                }}
                items(s.activations,key={it.id}){a->Panel{
                    Heading(if(a.consumed)"Активирован" else if(a.revoked)"Отозван" else if(a.trial)"Пробный код" else "Код активации")
                    Fact("До",a.expires);Fact("ID",a.id)
                    if(!a.consumed && !a.revoked)Secondary("Отозвать код",!s.busy){revokeId=a.id;confirm="revoke_activation"}
                }}
            }
            "download"->{
                item{Panel{
                    Heading("Персональная выдача APK");Text("Одна загрузка, 30 минут. Код активации выдаётся отдельно в разделе лицензии.",color=Muted)
                    Action("Создать ссылку",!s.busy && s.project?.releaseAvailable==true){vm.issue()}
                    if(s.project?.releaseAvailable!=true)Text("Нет одобренной сборки.",color=Muted)
                    s.link?.let{link->Fact("Истекает",link.expires);Text(link.url,fontSize=12.sp,color=Leaf)
                        Action("Поделиться ссылкой",!s.busy){context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply{type="text/plain";putExtra(Intent.EXTRA_TEXT,link.url)},"Передать APK"))}
                    }
                }}
                items(s.history.downloads,key={it.id}){d->Panel{
                    Heading(if(d.consumed)"Использована" else if(d.revoked)"Отозвана" else "Ссылка");Fact("До",d.expires);Fact("ID",d.id)
                    if(!d.consumed && !d.revoked)Secondary("Отозвать",!s.busy){revokeId=d.id;confirm="revoke"}
                }}
            }
            else->{
                if(s.history.lines.isEmpty())item{Text("История начислений и привязок пуста",color=Muted)}
                items(s.history.lines){line->Panel{Heading(line.title);Text(line.detail,fontSize=12.sp,color=Muted)}}
            }
        }
    }
    if(confirm.isNotEmpty()){
        val kind=confirm
        val title=when(kind){"grant"->"Подтвердить оплату?";"bind"->"Сохранить устройство?";"activation"->"Выдать код?";"trial_activation"->"Выдать пробный доступ?";"revoke_activation"->"Отозвать код?";else->"Отозвать ссылку?"}
        val message=when(kind){"grant"->"Подтверждайте только полученную сумму или пробный доступ."; "bind"->"Срок не изменится. Старое устройство перестанет быть текущим.";"activation"->"Код может перенести подписку на новое устройство. Оплаченный срок сохранится.";"trial_activation"->"Однократные семь дней начнутся после активации.";else->"Неиспользованный код перестанет работать."}
        Confirm(title,message,{confirm=""},{confirm="";when(kind){"grant"->plan?.let{vm.confirmPayment(it,price,paymentId)};"bind"->vm.bind(bindId,device);"activation"->vm.issueActivation(false);"trial_activation"->vm.issueActivation(true);"revoke_activation"->vm.revokeActivation(revokeId);else->vm.revoke(revokeId)}})
    }
}
