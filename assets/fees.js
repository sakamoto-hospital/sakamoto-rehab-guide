/* 料金はすべて assets/fees.json から。ここには計算のしかたと見せ方だけを書く */
const yen=n=>n.toLocaleString('ja-JP');
const state={burden:1, level:'要介護1', course:0, visits:4};
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
    cs.map(c=>`<th scope="col"><b>${c.no}クール</b><span class="ride-tag ${c.ride?'yes':'no'}">${c.ride?'送迎あり':'送迎なし'}</span></th>`).join('')+'</tr></thead><tbody>';
  for(const level of Object.keys(FEES.care.units)){
    h+=`<tr><th scope="row">${level}</th>`+cs.map(c=>{
      const u=careVisitUnits(level,c.ride);
      return `<td><span class="yen">${yen(bill(u).self)}<small>円</small></span><span class="unit"><span class="nw">${yen(u)}単位</span><span class="nw">＋処遇改善</span></span></td>`;
    }).join('')+'</tr>';
  }
  document.getElementById('care-table').innerHTML=h+'</tbody>';
  const m=addons('care','month');
  document.getElementById('care-caption').innerHTML=
    `${state.burden}割負担の場合の、1回あたりの目安です（${addons('care','visit').map(a=>a.name).join('・')}${addons('care','visit').length?'・':''}処遇改善加算を含みます。「条件あり」の加算は含みません）。`+
    `送迎のないクールは、送迎の分（片道${FEES.care.noRide.units}単位×往復）安くなります。`+
    (m.length?`<br>このほか、ひと月に1回 ${m.map(a=>`${a.name}（${a.units}単位）`).join('・')} がかかります。ひと月の合計は「<a href="#calc">ひと月の目安を計算する</a>」でご確認ください。`:'');
}

function renderSupport(){
  let h='<thead><tr><th scope="col" style="text-align:left;padding-left:14px">介護度</th><th scope="col"><b>ひと月</b>何回通っても同じ</th></tr></thead><tbody>';
  for(const level of Object.keys(FEES.support.units)){
    const u=supportMonthUnits(level);
    h+=`<tr><th scope="row">${level}</th><td><span class="yen">${yen(bill(u).self)}<small>円</small></span><span class="unit"><span class="nw">${yen(u)}単位</span><span class="nw">＋処遇改善</span></span></td></tr>`;
  }
  document.getElementById('support-table').innerHTML=h+'</tbody>';
  const o=FEES.support.over12Months;
  document.getElementById('support-caption').innerHTML=
    `${state.burden}割負担の場合の、ひと月の目安です（${addons('support','month').map(a=>a.name).join('・')}・処遇改善加算を含みます。「条件あり」の加算は含みません）。`+
    (o?`<br>ご利用の開始から12か月を超えると、国の決まりにより、ひと月に${Object.entries(o).map(([k,v])=>`${k}は${v}単位`).join('、')}が差し引かれることがあります（リハビリの会議や国への情報提出などの条件を満たしている場合は差し引かれません）。`:'');
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
function renderMatrix(){
  const items=new Map();
  const put=(name,kind,cond,note)=>{
    const it=items.get(name)||{name,support:false,care:false,cond,note};
    it[kind]=true;it.cond=it.cond||cond;if(!it.note)it.note=note;items.set(name,it);
  };
  FEES.care.addons.filter(shown).forEach(a=>put(a.name,'care',a.status==='conditional',a.note));
  FEES.support.addons.filter(shown).forEach(a=>put(a.name,'support',a.status==='conditional',a.note));
  if(FEES.treatment?.status==='confirmed'){
    put(FEES.treatment.name,'care',false,FEES.treatment.note);put(FEES.treatment.name,'support',false,'');
  }
  put('送迎を行わない場合の減算','care',true,`送迎のない${FEES.courses.filter(x=>!x.ride).map(x=>x.no).join('・')}クールをご利用の場合（片道${FEES.care.noRide.units}単位）。要支援の方は対象外です。`);
  if(FEES.support.over12Months)put('ご利用開始から12か月を超えた場合の減算','support',true,'条件を満たしている場合は差し引かれません。');
  const mark=v=>v?'<span class="yes" aria-label="あり">○</span>':'<span class="no" aria-label="なし">—</span>';
  document.getElementById('addon-matrix').innerHTML=
    '<thead><tr><th scope="col">加算・減算</th><th scope="col">要支援</th><th scope="col">要介護</th></tr></thead><tbody>'+
    [...items.values()].map(it=>`<tr><th scope="row">${it.name}${it.cond?COND:''}</th><td>${mark(it.support)}</td><td>${mark(it.care)}</td></tr>`).join('')+
    '</tbody>';
}
const treatmentRow=()=>FEES.treatment?.status==='confirmed'?row(FEES.treatment.name+FEES.treatment.rateLabel,`合計の${pct()}`,FEES.treatment.note):'';

function renderUnits(){
  const c=FEES.care, s=FEES.support;
  document.getElementById('care-units').innerHTML='<tbody>'+
    grp(c.label)+Object.entries(c.units).map(([k,v])=>row(k,`${v}単位／1回`)).join('')+
    grp('送迎')+row('送迎を行わない場合',`−${c.noRide.units}単位／片道`,`送迎のない${FEES.courses.filter(x=>!x.ride).map(x=>x.no).join('・')}クールをご利用の場合、国の決まりにより行き・帰りそれぞれ差し引かれます。`)+
    grp('加算')+addonRows('care')+treatmentRow()+'</tbody>';
  document.getElementById('support-units').innerHTML='<tbody>'+
    grp(s.label)+Object.entries(s.units).map(([k,v])=>row(k,`${yen(v)}単位／1か月`)).join('')+
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
    FEES.courses.forEach((c,i)=>co.add(new Option(`${c.no}クール（${c.ride?'送迎あり':'送迎なし'}）`,i)));
    // 月〜土の営業なので、多い月で27回（31日で日曜が4回の月）。回数そのものに国の上限はない
    const hint={4:'（週1回の目安）',8:'（週2回の目安）',13:'（週3回の目安）'};
    for(let n=1;n<=27;n++)vi.add(new Option(n+'回'+(hint[n]||''),n));
    lv.value=state.level;co.value=state.course;vi.value=state.visits;
    lv.addEventListener('change',()=>{state.level=lv.value;renderCalc()});
    co.addEventListener('change',()=>{state.course=+co.value;renderCalc()});
    vi.addEventListener('change',()=>{state.visits=+vi.value;renderCalc()});
  }
  const isSupport=kindOf(state.level)==='support';
  for(const id of ['f-course','f-visits'])document.getElementById(id).style.opacity=isSupport?.45:1;
  vi.disabled=co.disabled=isSupport;

  const rows=[];let units=0;
  const add=(k,v)=>{rows.push([k,v]);units+=v};
  if(isSupport){
    add(`${FEES.support.label}（${state.level}）`,FEES.support.units[state.level]);
    addons('support','month').forEach(a=>add(a.name,addonUnits(a,state.level)));
  }else{
    const c=FEES.courses[state.course], n=state.visits, base=FEES.care.units[state.level];
    add(`通所リハビリテーション費（${state.level}） ${base}単位 × ${n}回`,base*n);
    addons('care','visit').forEach(a=>add(`${a.name} ${a.units}単位 × ${n}回`,a.units*n));
    if(!c.ride)add(`送迎を行わない場合 ${FEES.care.noRide.units}単位 × 往復 × ${n}回`,-noRideUnits()*n);
    addons('care','month').forEach(a=>add(`${a.name}（ひと月）`,a.units));
  }
  const b=bill(units);
  document.getElementById('r-value').innerHTML=`約 ${yen(b.self)}<small>円</small>`;
  document.getElementById('r-sub').textContent=isSupport
    ?`${state.level}・${state.burden}割負担・ひと月（回数にかかわらず定額）`
    :`${state.level}・${state.burden}割負担・${FEES.courses[state.course].no}クール・ひと月${state.visits}回`;
  const tr=(a,v,c='')=>`<tr class="${c}"><td>${a}</td><td>${v}</td></tr>`;
  document.getElementById('r-bd').innerHTML=
    rows.map(([k,v])=>tr(k,(v<0?'−':'')+yen(Math.abs(v))+'単位')).join('')+
    (b.t?tr(`${FEES.treatment.name}（上の合計の${pct()}・四捨五入）`,yen(b.t)+'単位'):'')+
    tr('単位の合計',yen(b.total)+'単位','sum')+
    tr(`費用の総額（1単位＝${FEES.unitPrice}円）`,yen(b.cost)+'円')+
    tr(`介護保険から支払われる分（${10-state.burden}割）`,'−'+yen(b.cost-b.self)+'円')+
    tr(`お支払いいただく分（${state.burden}割）`,yen(b.self)+'円','sum');
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
    ?`<div class="doc">${d.qr?`<img src="${d.qr}" width="480" height="480" alt="${d.title}のQRコード">`:''}<div><b>${d.title}</b><span class="st">PDF・QRを読み取るとスマートフォンでも開けます</span><a class="dl" href="${d.pdf}" download>ダウンロード</a></div></div>`
    :`<div class="doc"><div><b>${d.title}</b><span class="st">準備中です。できあがりしだい、ここからダウンロードできるようにします。</span></div></div>`).join('');
}

function renderStatic(){
  const u=FEES.unitPrice, ex=FEES.care.units['要介護1'];
  document.getElementById('unitbox').innerHTML=
    `<p class="u-big">1単位 ＝ ${u}円</p>`+
    `<p class="u-sub">介護保険の料金は「単位」で決まっています。当事業所は${FEES.unitPriceNote}のため、<b>1単位＝${u}円</b>です。<br>`+
    `たとえば ${ex}単位 は ${yen(ex*u)}円。1割負担の方は、そのうち ${yen(ex*u/10)}円 をお支払いいただきます（処遇改善加算などは別に加わります）。</p>`;
  document.getElementById('cautions').innerHTML=[
    `金額は${FEES.basis}にもとづく<b>目安</b>です（${FEES.asOf}）。実際のご請求は月ごとの合計で計算するため、数円ずれることがあります。`,
    '負担割合（1割・2割・3割）は、お手元の「介護保険負担割合証」でご確認ください。',
    '区分支給限度基準額を超えた分や、介護保険の対象にならない費用は、全額のご負担になります。',
    '高額介護サービス費などの制度に当てはまる方は、お支払いが軽くなることがあります。担当のケアマネジャーにご相談ください。',
    '料金は、国の介護報酬の改定や事業所の体制の変更により変わることがあります。変わるときは、事前に書面でお知らせします。'
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
