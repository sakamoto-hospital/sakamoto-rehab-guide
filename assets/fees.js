/* 料金はすべて assets/fees.json から。ここには計算のしかたと見せ方だけを書く */
const yen=n=>n.toLocaleString('ja-JP');
const state={burden:1, level:'要介護1', course:0, visits:4, discharge:false, area:false};
let FEES=null;

/* 国保連の請求と同じ手順で計算する
   ① 単位の合計（基本＋加算） → ② 処遇改善加算＝①×率（四捨五入）
   → ③ 費用＝単位×単価（円未満切り捨て） → ④ 保険から出る分＝③×給付率（円未満切り捨て）
   → ⑤ 自己負担＝③−④ */
function bill(units){
  const t=FEES.treatment?.status==='confirmed'?Math.round(units*FEES.treatment.rate):0;
  const total=units+t;
  const cost=Math.floor(total*FEES.unitPrice);
  const insured=Math.floor(cost*(10-state.burden)/10);
  return {units,t,total,cost,self:cost-insured};
}
const kindOf=level=>level in FEES.support.units?'support':'care';
const addons=(kind,per)=>FEES[kind].addons.filter(a=>a.status==='confirmed'&&a.per===per);
const addonUnits=(a,level)=>typeof a.units==='number'?a.units:(a.units[level]||0);
const sumAddons=(kind,per,level)=>addons(kind,per).reduce((s,a)=>s+addonUnits(a,level),0);
const noRideUnits=()=>FEES.care.noRide.units*2;   // 行きと帰りの両方
const pct=()=>(FEES.treatment.rate*100).toFixed(1)+'%';

// 要介護：1回あたり（基本＋1回ごとの加算−送迎なしの減算）
function careVisitUnits(level,ride){
  return FEES.care.units[level]+sumAddons('care','visit',level)-(ride?0:noRideUnits());
}
// 要支援：ひと月（基本＋ひと月ごとの加算）
function supportMonthUnits(level){
  return FEES.support.units[level]+sumAddons('support','month',level);
}

function renderSegs(){
  document.querySelectorAll('[data-burden-seg]').forEach(seg=>{
    seg.replaceChildren(...[1,2,3].map(n=>{
      const b=document.createElement('button');
      b.type='button';b.textContent=n+'割';
      b.setAttribute('aria-pressed',String(state.burden===n));
      b.addEventListener('click',()=>{state.burden=n;renderAll()});
      return b;
    }));
  });
}

function renderCare(){
  const cs=FEES.courses;
  let h='<thead><tr><th scope="col" style="text-align:left;padding-left:14px">介護度</th>'+
    cs.map(c=>`<th scope="col"><span class="ride-tag big ${c.ride?'yes':'no'}">${c.ride?'送迎あり':'送迎なし'}</span><span class="th-time">${c.time}</span></th>`).join('')+'</tr></thead><tbody>';
  for(const level of Object.keys(FEES.care.units)){
    // ★2026-10-06 本人「高齢者には文字が多すぎる」→ 表は金額だけ。単位の式は下の「料金の内訳」へ
    h+=`<tr><th scope="row">${level}</th>`+cs.map(c=>`<td><span class="yen">${yen(bill(careVisitUnits(level,c.ride)).self)}<small>円</small></span></td>`).join('')+'</tr>';
  }
  document.getElementById('care-table').innerHTML=h+'</tbody>';
  // ★ひと月に1回かかる加算（科学的介護推進体制加算）を、表のすぐ下に金額で出す（2026-10-06 本人「要介護に入っていない」）
  const m=addons('care','month');
  document.getElementById('care-plus').innerHTML=m.map(a=>
    `<p class="plus"><span>＋ ひと月に1回</span><b>${a.name}</b><span class="yen">${yen(bill(a.units).self)}<small>円</small></span></p>`).join('');
  document.getElementById('care-caption').innerHTML=
    `${state.burden}割負担・1回あたりの目安です（${addons('care','visit').map(a=>a.short||a.name).join('・')}加算・処遇改善加算をふくみます）。`;
}

function renderSupport(){
  let h='<thead><tr><th scope="col" style="text-align:left;padding-left:14px">介護度</th><th scope="col"><b>ひと月</b>何回通っても同じ</th></tr></thead><tbody>';
  for(const level of Object.keys(FEES.support.units)){
    h+=`<tr><th scope="row">${level}</th><td><span class="yen">${yen(bill(supportMonthUnits(level)).self)}<small>円</small></span></td></tr>`;
  }
  document.getElementById('support-table').innerHTML=h+'</tbody>';
  document.getElementById('support-caption').innerHTML=
    `${state.burden}割負担・ひと月の目安です（${addons('support','month').map(a=>a.name).join('・')}・処遇改善加算をふくみます）。`;
}

/* 単位の内訳。注記は狭い列に詰めず、行の下に全幅で出す（スマホで読みやすくするため） */
const row=(k,v,s='')=>`<tr${s?' class="has-note"':''}><td>${k}</td><td>${v}</td></tr>`+(s?`<tr class="sub"><td colspan="2">${s}</td></tr>`:'');
const grp=t=>`<tr class="grp"><th colspan="2">${t}</th></tr>`;
const shown=a=>a.status==='confirmed'||a.status==='conditional';
const COND='<span class="cond">条件あり</span>';
function addonRows(kind){
  return FEES[kind].addons.filter(shown).map(a=>{
    const per='／'+(a.perLabel||(a.per==='month'?'1か月':'1回'));
    // 介護度ごとに単位が違うものは1行ずつ（1行に並べるとスマホで表がはみ出す）
    const u=a.pct!=null?`基本の${a.pct}％`
      :typeof a.units==='number'?`${yen(a.units)}単位${per}`
      :Object.entries(a.units).map(([k,v])=>`<span class="nw">${k} ${v}単位${per}</span>`).join('<br>');
    return row(a.name+(a.status==='conditional'?COND:''),u,a.note);
  }).join('');
}

/* 加算・減算が「要支援」「要介護」のどちらに付くかの一覧（料金表では混ざって分かりにくいため・2026-10-02 本人指示） */
/* 加算1つぶんの「いくら」 */
function amountOf(a,level){
  const per='／'+(a.perLabel||(a.per==='month'?'1か月':'1回'));
  if(a.pct!=null)return `基本の${a.pct}％`;
  if(typeof a.units==='number')return `${yen(a.units)}単位${per}`;
  return Object.entries(a.units).map(([k,v])=>`${k} ${v}単位${per}`).join('、');
}
function renderMatrix(){
  const items=new Map();
  const put=(name,kind,cond,note,amount)=>{
    const it=items.get(name)||{name,support:false,care:false,cond,note,amount:{}};
    it[kind]=true;it.cond=it.cond||cond;if(!it.note)it.note=note;it.amount[kind]=amount;items.set(name,it);
  };
  FEES.care.addons.filter(shown).forEach(a=>put(a.name,'care',a.status==='conditional',a.note,amountOf(a)));
  FEES.support.addons.filter(shown).forEach(a=>put(a.name,'support',a.status==='conditional',a.note,amountOf(a)));
  if(FEES.treatment?.status==='confirmed'){
    const t=FEES.treatment, amt=`ひと月の合計単位の${pct()}`;
    put(t.name+t.rateLabel,'care',false,t.note,amt);put(t.name+t.rateLabel,'support',false,t.note,amt);
  }
  put('送迎を行わない場合の減算','care',true,
    `送迎を使わない場合（9:00〜10:30の方、または10:40〜12:10でご自分で来られる方）に、国の決まりで行き・帰りそれぞれ差し引かれます。要支援の方は対象外です。`,
    `−${FEES.care.noRide.units}単位／片道（往復で−${noRideUnits()}単位）`);
  if(FEES.support.over12Months)put('ご利用開始から12か月を超えた場合の減算','support',true,
    'リハビリの会議の開催や国（LIFE）への情報提出などの条件を満たしている場合は、差し引かれません。',
    Object.entries(FEES.support.over12Months).map(([k,v])=>`${k} −${v}単位／1か月`).join('、'));
  const mark=v=>v?'<span class="yes" aria-label="あり">○</span>':'<span class="no" aria-label="なし">—</span>';
  const amt=it=>{
    const s=it.amount.support, c=it.amount.care;
    if(s&&c&&s===c)return s;
    return [s?`要支援：${s}`:'',c?`要介護：${c}`:''].filter(Boolean).join('<br>');
  };
  // ★加算名を押すと説明が開く（2026-10-02 本人「どういったものかタップしたら見れるように」）
  document.getElementById('addon-matrix').innerHTML=
    '<thead><tr><th scope="col">加算・減算<span class="tap">（名前を押すと説明）</span></th><th scope="col">要支援</th><th scope="col">要介護</th></tr></thead><tbody>'+
    [...items.values()].map(it=>`<tr><th scope="row"><details><summary>${it.name}${it.cond?COND:''}</summary>`+
      `<p class="m-amt">${amt(it)}</p><p class="m-note">${it.note||''}</p></details></th><td>${mark(it.support)}</td><td>${mark(it.care)}</td></tr>`).join('')+
    '</tbody>';
}
const treatmentRow=()=>FEES.treatment?.status==='confirmed'?row(FEES.treatment.name+FEES.treatment.rateLabel,`合計の${pct()}`,FEES.treatment.note):'';

// ★2026-10-06 本人「1単位＝10円は上に出さず、内訳を開いたときに分かればいい」
const unitRow=()=>`<tr class="grp"><th colspan="2">1単位＝${FEES.unitPrice}円で計算しています</th></tr>`;
function renderUnits(){
  const c=FEES.care, s=FEES.support;
  document.getElementById('care-units').innerHTML='<tbody>'+
    unitRow()+grp(c.label)+Object.entries(c.units).map(([k,v])=>row(k,`${v}単位／1回`)).join('')+
    grp('送迎')+row('送迎を行わない場合',`−${c.noRide.units}単位／片道`,`送迎を使わない場合（9:00〜10:30の方、または10:40〜12:10でご自分で来られる方）、国の決まりにより行き・帰りそれぞれ差し引かれます。`)+
    grp('加算')+addonRows('care')+treatmentRow()+'</tbody>';
  document.getElementById('support-units').innerHTML='<tbody>'+
    unitRow()+grp(s.label)+Object.entries(s.units).map(([k,v])=>row(k,`${yen(v)}単位／1か月`)).join('')+
    (s.over12Months?row('ご利用開始から12か月を超えた場合',Object.entries(s.over12Months).map(([k,v])=>`<span class="nw">${k} −${v}単位</span>`).join('<br>'),'条件を満たしている場合は差し引かれません。'):'')+
    grp('加算')+addonRows('support')+treatmentRow()+'</tbody>';
}

function renderCalc(){
  const lv=document.getElementById('c-level'), co=document.getElementById('c-course'), vi=document.getElementById('c-visits');
  if(!lv.options.length){
    [['要介護の方',FEES.care.units],['要支援の方',FEES.support.units]].forEach(([label,units])=>{
      const g=document.createElement('optgroup');g.label=label;
      Object.keys(units).forEach(l=>g.appendChild(new Option(l,l)));lv.appendChild(g);
    });
    FEES.courses.forEach((c,i)=>co.add(new Option(`${c.ride?'送迎あり':'送迎なし'}（${c.short}）`,i)));
    // 月〜土の営業なので、多い月で27回（31日で日曜が4回の月）。回数そのものに国の上限はない
    const hint={4:'（週1回の目安）',8:'（週2回の目安）',13:'（週3回の目安）'};
    for(let n=1;n<=27;n++)vi.add(new Option(n+'回'+(hint[n]||''),n));
    lv.value=state.level;co.value=state.course;vi.value=state.visits;
    lv.addEventListener('change',()=>{state.level=lv.value;renderCalc()});
    co.addEventListener('change',()=>{state.course=+co.value;renderCalc()});
    vi.addEventListener('change',()=>{state.visits=+vi.value;renderCalc()});
  }
  const isSupport=kindOf(state.level)==='support';
  // 要支援は回数で保険の金額は変わらないが、教養娯楽費（1回ごと）の計算に回数を使う
  document.getElementById('f-course').style.opacity=isSupport?.45:1;
  co.disabled=isSupport;
  document.getElementById('c-visits-note').textContent=isSupport?'要支援の方は、回数は教養娯楽費（1回ごと）の計算にだけ使います。':'';
  const kind=isSupport?'support':'care';

  /* はい／いいえの切り替え（退院・中山間地域） */
  const yesNo=(id,key)=>document.getElementById(id).replaceChildren(...[[false,'いいえ'],[true,'はい']].map(([v,t])=>{
    const b=document.createElement('button');b.type='button';b.textContent=t;
    b.setAttribute('aria-pressed',String(state[key]===v));
    b.addEventListener('click',()=>{state[key]=v;renderCalc()});
    return b;
  }));

  /* ★2026-11-24 本人指示：「退院（退所）して3か月以内」を選ぶと、退院時共同指導加算と
     短期集中個別リハビリテーション実施加算（要介護のみ）も計算に入れる。どれが対象かは fees.json の discharge */
  yesNo('c-discharge','discharge');
  const dAddons=FEES[kind].addons.filter(a=>a.discharge&&a.status!=='pending');
  document.getElementById('c-discharge-note').textContent=
    `「はい」にすると、${dAddons.map(a=>a.name).join('と')}を入れて計算します。`+
    (isSupport?'（短期集中個別リハビリテーション実施加算は要介護の方のみです）':'');

  /* ★2026-11-24 本人指示：中山間地域（fees.json の area に書いた地域）にお住まいかを選ぶ */
  const areaAddon=FEES[kind].addons.find(a=>a.area&&a.status!=='pending');
  document.getElementById('f-area').hidden=!areaAddon;
  if(areaAddon){
    yesNo('c-area','area');
    document.getElementById('c-area-list').textContent=areaAddon.area;
  }

  const rows=[];let units=0;
  const add=(k,v)=>{rows.push([k,v]);units+=v};
  const used=[];   // 目安に入れた加算（結果の下に一覧で出す）[名前, いくつ分, 説明]
  const use=(a,v)=>used.push([a.name,v,a.note]);
  const useD=state.discharge?dAddons:[];
  const useA=state.area&&areaAddon?[areaAddon]:[];
  const n=state.visits;
  if(isSupport){
    const base=FEES.support.units[state.level];
    add(`${FEES.support.label}（${state.level}）`,base);
    addons('support','month').forEach(a=>{add(a.name,addonUnits(a,state.level));use(a,'ひと月');});
    useA.forEach(a=>{const u=Math.round(base*a.pct/100);add(`${a.name}（基本の${a.pct}％）`,u);use(a,'ひと月');});
    useD.forEach(a=>{
      if(a.per==='once'){add(`${a.name}（1回）`,addonUnits(a,state.level));use(a,'1回');}
      else if(a.per==='month'){add(`${a.name}（ひと月）`,addonUnits(a,state.level));use(a,'ひと月');}
    });
  }else{
    const c=FEES.courses[state.course], base=FEES.care.units[state.level];
    add(`通所リハビリテーション費（${state.level}） ${base}単位 × ${n}回`,base*n);
    addons('care','visit').forEach(a=>{add(`${a.name} ${a.units}単位 × ${n}回`,a.units*n);use(a,`${n}回分`);});
    useD.filter(a=>a.per==='visit').forEach(a=>{add(`${a.name} ${addonUnits(a,state.level)}単位 × ${n}回`,addonUnits(a,state.level)*n);use(a,`${n}回分`);});
    useA.forEach(a=>{const u=Math.round(base*a.pct/100);add(`${a.name}（基本の${a.pct}％） ${u}単位 × ${n}回`,u*n);use(a,`${n}回分`);});
    if(!c.ride)add(`送迎を行わない場合 ${FEES.care.noRide.units}単位 × 往復 × ${n}回`,-noRideUnits()*n);
    addons('care','month').forEach(a=>{add(`${a.name}（ひと月）`,a.units);use(a,'ひと月');});
    useD.filter(a=>a.per==='once').forEach(a=>{add(`${a.name}（1回）`,addonUnits(a,state.level));use(a,'1回');});
  }
  if(FEES.treatment?.status==='confirmed')used.push([FEES.treatment.name+FEES.treatment.rateLabel,`合計の${pct()}`,FEES.treatment.note]);

  /* ★2026-11-24 本人指示：介護保険以外の費用（教養娯楽費 1回ごと）も合計に入れる。km ごとの交通費は下に注記だけ */
  const extras=FEES.extras.filter(x=>x.per==='1回').map(x=>({name:x.name,price:x.price,yen:x.price*n,note:x.note}));
  const extraYen=extras.reduce((s,x)=>s+x.yen,0);
  const kmExtras=FEES.extras.filter(x=>x.per!=='1回');

  const b=bill(units);
  const grand=b.self+extraYen;
  document.getElementById('r-value').innerHTML=`約 ${yen(grand)}<small>円</small>`;
  document.getElementById('r-sub').textContent=(isSupport
    ?`${state.level}・${state.burden}割負担・ひと月${n}回`
    :`${state.level}・${state.burden}割負担・${FEES.courses[state.course].ride?'送迎あり':'送迎なし'}・ひと月${n}回`)
    +(state.discharge?'・退院後3か月以内':'')+(useA.length?'・中山間地域':'');
  document.getElementById('r-split').innerHTML=
    `<span>介護保険の自己負担 ${yen(b.self)}円</span>`+extras.map(x=>`<span>${x.name} ${yen(x.yen)}円</span>`).join('');

  // ★加算の名前を押すと説明が開く（上の「加算の一覧」と同じ形）
  document.getElementById('r-addons').innerHTML=
    `<p class="ra-head">この目安に入っている加算<span class="tap">（名前を押すと説明）</span></p><ul>`+
    used.map(([k,v,note])=>`<li><details><summary><span>${k}</span><small>${v}</small></summary>${note?`<p>${note}</p>`:''}</details></li>`).join('')+'</ul>'+
    (extras.length?`<p class="ra-head ra-gap">介護保険以外の費用</p><ul>`+
      extras.map(x=>`<li><details><summary><span>${x.name}</span><small>${yen(x.price)}円 × ${n}回</small></summary>${x.note?`<p>${x.note}</p>`:''}</details></li>`).join('')+'</ul>':'')+
    (useD.length?`<p class="ra-note">退院時共同指導加算は、退院前のカンファレンスに参加した場合に、はじめの月に1回だけかかります。${isSupport?'':'短期集中個別リハビリテーション実施加算は、退院（退所）日から3か月以内の間だけかかります。'}</p>`:'')+
    kmExtras.map(x=>`<p class="ra-note">${x.name}（${yen(x.price)}円／${x.per}）は、${x.note.replace(/について。?$/,'')}だけ別にかかります（この目安には入っていません）。</p>`).join('');

  const tr=(a,v,c='')=>`<tr class="${c}"><td>${a}</td><td>${v}</td></tr>`;
  document.getElementById('r-bd').innerHTML=
    rows.map(([k,v])=>tr(k,(v<0?'−':'')+yen(Math.abs(v))+'単位')).join('')+
    (b.t?tr(`${FEES.treatment.name}（上の合計の${pct()}・四捨五入）`,yen(b.t)+'単位'):'')+
    tr('単位の合計',yen(b.total)+'単位','sum')+
    tr(`費用の総額（1単位＝${FEES.unitPrice}円）`,yen(b.cost)+'円')+
    tr(`介護保険から支払われる分（${10-state.burden}割）`,'−'+yen(b.cost-b.self)+'円')+
    tr(`介護保険の自己負担（${state.burden}割）`,yen(b.self)+'円','sum')+
    extras.map(x=>tr(`${x.name} ${yen(x.price)}円 × ${n}回`,yen(x.yen)+'円')).join('')+
    (extras.length?tr('ひと月のお支払いの合計',yen(grand)+'円','sum'):'');
  // 条件つきの加算・減算で、上の選択に出ていないものだけを「含めていないもの」に書く
  const cond=FEES[kind].addons.filter(a=>a.status==='conditional'&&!a.discharge&&!a.area).map(a=>`${a.name}（${amountOf(a)}）`);
  if(isSupport&&FEES.support.over12Months)cond.push(`12か月を超えた場合の減算（${state.level} −${FEES.support.over12Months[state.level]}単位）`);
  document.getElementById('r-cond').innerHTML=cond.length
    ?`<b>この目安に含めていないもの</b>（条件に当てはまる方だけにかかります）：${cond.join('、')}`:'';
}

function renderExtras(){
  const el=document.getElementById('extras-body');
  if(!FEES.extras.length){
    el.innerHTML='<p class="pending">そのほかの実費（日用品など）がある場合は、ご契約のときに書面でご説明します。</p>';
    return;
  }
  el.innerHTML='<table class="units"><tbody>'+FEES.extras.map(x=>row(x.name,`${yen(x.price)}円／${x.per}`,x.note||'')).join('')+'</tbody></table>';
}

function renderDocs(){
  document.getElementById('docs').innerHTML=FEES.documents.map(d=>d.pdf
    ?`<div class="doc">${d.qr?`<img src="${d.qr}" width="480" height="480" alt="${d.title}のQRコード">`:''}<div><b>${d.title}</b>${d.title==='重要事項説明書'&&FEES.officeNumber?`<span class="no">事業所番号は ${FEES.officeNumber} です</span>`:''}<span class="st">PDF・QRを読み取るとスマートフォンでも開けます</span><a class="dl" href="${d.pdf}" download>ダウンロード</a></div></div>`
    :`<div class="doc"><div><b>${d.title}</b><span class="st">準備中です。できあがりしだい、ここからダウンロードできるようにします。</span></div></div>`).join('');
}

function renderStatic(){
  const u=FEES.unitPrice, ex=FEES.care.units['要介護1'];
  document.getElementById('asof').textContent=FEES.asOf;
  // ★2026-11-12 本人指示：料金ページのいちばん上に事業所番号（数字は fees.json の officeNumber）
  const on=document.getElementById('officeno'); if(on&&FEES.officeNumber) on.innerHTML=`介護保険 事業所番号<b>${FEES.officeNumber}</b>`;
  // ★2026-10-06 上の箱は「1単位＝10円」ではなく、ご利用の時間（本人「ページを開いて時間が分からない」「クールという言葉はなし」）
  document.getElementById('unitbox').innerHTML=`<p class="u-head">ご利用の時間</p>${FEES.times.map(t=>`<p class="u-times">${t.time}<small>${t.ride?'送迎あり':'送迎なし'}</small></p>`+(t.ride?'<p class="u-note">※送迎なしの方もご利用できます</p>':'')).join('')}`;
  document.getElementById('cautions').innerHTML=[
    `金額は<b>目安</b>です（${FEES.asOf}）。実際のご請求は、ひと月の合計で計算します。`,
    'ひと月の上限（区分支給限度基準額）を超えた分は、全額ご負担になります。',
    '料金が変わるときは、事前に書面でお知らせします。'
  ].map(t=>`<li>${t}</li>`).join('');
}

function renderAll(){renderSegs();renderCare();renderSupport();renderCalc()}

(async()=>{
  try{
    const res=await fetch('assets/fees.json',{cache:'no-cache'});
    FEES=await res.json();
    renderStatic();renderAll();renderUnits();renderMatrix();renderExtras();renderDocs();
  }catch(e){
    document.querySelector('[data-fees-app]').innerHTML='<section><div class="wrap"><p class="error">料金表を読み込めませんでした。時間をおいて、もう一度開いてください。</p></div></section>';
  }
})();
