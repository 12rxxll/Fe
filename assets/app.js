(() => {
'use strict';
const TERMS = Array.isArray(window.FE_TERMS) ? window.FE_TERMS : [];
const STORAGE_KEY = 'fe-learning-os-v2';
const DAY = 86400000;
const defaultState = () => ({version:2,createdAt:new Date().toISOString(),settings:{dailyGoal:10,examDate:'',theme:'system'},terms:{},attempts:[],sessions:[]});
let state = loadState();
let currentView = 'home';
let visibleTermCount = 40;
let reviewFilter = 'due';
let quiz = null;
let deferredInstall = null;
const termById = new Map(TERMS.map(t => [String(t.id), t]));
const termByName = new Map(TERMS.map(t => [normalize(t['用語']), t]));

const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
function normalize(v){return String(v ?? '').trim().toLowerCase();}
function esc(v){return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function localDate(d=new Date()){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10);}
function addDays(dateStr,days){const d=new Date((dateStr||localDate())+'T12:00:00');d.setDate(d.getDate()+days);return localDate(d);}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function unique(a){return [...new Set(a.filter(Boolean))];}
function getSystems(){return unique(TERMS.map(t=>t['系']));}
function emptyTermState(){return {mastery:0,correct:0,wrong:0,streak:0,ease:2.5,interval:0,repetitions:0,due:null,last:null,bookmark:false,note:''};}
function getTermState(id){id=String(id);if(!state.terms[id]) state.terms[id]=emptyTermState();return state.terms[id];}
function loadState(){try{const s=JSON.parse(localStorage.getItem(STORAGE_KEY));if(s&&s.version===2)return Object.assign(defaultState(),s,{settings:Object.assign(defaultState().settings,s.settings||{})});}catch(e){}return defaultState();}
function saveState(render=true){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));if(render) renderAll();}
function showToast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2200);}
function applyTheme(){let theme=state.settings.theme||'system';if(theme==='system')theme=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=theme;}
function todayAttempts(){return state.attempts.filter(a=>a.date===localDate());}
function dueTerms(){const today=localDate();return TERMS.filter(t=>{const s=getTermState(t.id);return s.due&&s.due<=today;});}
function studiedTerms(){return TERMS.filter(t=>getTermState(t.id).mastery>0);}
function attemptsFor(id){return state.attempts.filter(a=>String(a.id)===String(id));}
function accuracy(arr=state.attempts){return arr.length?Math.round(arr.filter(a=>a.correct).length/arr.length*100):null;}
function daysWithActivity(){return unique(state.attempts.map(a=>a.date)).sort();}
function currentStreak(){const set=new Set(daysWithActivity());let d=new Date(localDate()+'T12:00:00');if(!set.has(localDate(d))){d.setDate(d.getDate()-1);}let n=0;while(set.has(localDate(d))){n++;d.setDate(d.getDate()-1);}return n;}
function bestStreak(){const days=daysWithActivity();if(!days.length)return 0;let best=1,run=1;for(let i=1;i<days.length;i++){const a=new Date(days[i-1]+'T12:00:00'),b=new Date(days[i]+'T12:00:00');if(Math.round((b-a)/DAY)===1)run++;else run=1;best=Math.max(best,run);}return best;}
function examStatus(){const value=state.settings.examDate;if(!value)return '試験日未設定';const today=new Date(localDate()+'T12:00:00'),exam=new Date(value+'T12:00:00');if(Number.isNaN(exam.getTime()))return '試験日未設定';const days=Math.ceil((exam-today)/DAY);if(days<0)return `試験日から${Math.abs(days)}日経過`;if(days===0)return '試験日当日';return `試験まで${days}日`;}
function termScore(t){const s=getTermState(t.id);const total=s.correct+s.wrong;const acc=total?s.correct/total:.5;return (1-s.mastery/5)*3 + s.wrong*1.2 + (1-acc)*4 + (s.due&&s.due<=localDate()?3:0);}
function readiness(){const coverage=TERMS.length?studiedTerms().length/TERMS.length:0;const acc=(accuracy()??0)/100;return Math.round((coverage*.45+acc*.55)*100);}
function groupStats(){return getSystems().map(system=>{const terms=TERMS.filter(t=>t['系']===system);const ids=new Set(terms.map(t=>String(t.id)));const attempts=state.attempts.filter(a=>ids.has(String(a.id)));const studied=terms.filter(t=>getTermState(t.id).mastery>0).length;return {system,terms:terms.length,studied,attempts:attempts.length,accuracy:accuracy(attempts)};});}
function syncNavigationState(){
  $$('.view').forEach(v=>{const active=v.id===`view-${currentView}`;v.classList.toggle('active',active);v.setAttribute('aria-hidden',active?'false':'true');});
  $$('[data-nav]').forEach(b=>{const active=b.dataset.nav===currentView;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
}
function syncReviewTabs(){$$('[data-review-filter]').forEach(b=>{const active=b.dataset.reviewFilter===reviewFilter;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');});}
function navTo(view){currentView=view;syncNavigationState();window.scrollTo({top:0,behavior:'smooth'});renderAll();}
function startDueReview(){const due=dueTerms().length;if(due>0){navTo('quiz');startQuiz({mode:'due',length:Math.min(20,Math.max(5,due))});return;}navTo('review');}

function setup(){
  $('todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date());
  getSystems().forEach(s=>{$('systemFilter').add(new Option(s,s));$('quizSystem').add(new Option(s,s));});
  syncNavigationState();syncReviewTabs();
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.nav)));
  $('quickStartButton').addEventListener('click',()=>{navTo('quiz');$('quizLength').value='10';startQuiz({mode:'weak'});});
  $('homeReviewButton').addEventListener('click',startDueReview);
  $('termSearch').addEventListener('input',()=>{visibleTermCount=40;renderTerms();});
  $('systemFilter').addEventListener('change',()=>{visibleTermCount=40;renderTerms();});
  $('masteryFilter').addEventListener('change',()=>{visibleTermCount=40;renderTerms();});
  $('loadMoreTerms').addEventListener('click',()=>{visibleTermCount+=40;renderTerms();});
  $('startQuizButton').addEventListener('click',()=>startQuiz());
  $('startReviewButton').addEventListener('click',startDueReview);
  $$('[data-review-filter]').forEach(b=>b.addEventListener('click',()=>{reviewFilter=b.dataset.reviewFilter;syncReviewTabs();renderReview();}));
  $('saveSettingsButton').addEventListener('click',saveSettings);
  $('exportButton').addEventListener('click',exportData);
  $('importInput').addEventListener('change',importData);
  $('resetButton').addEventListener('click',resetData);
  $('copyGeneralPromptButton').addEventListener('click',copyWeakPrompt);
  $('appTermCount').textContent=`${TERMS.length}語`;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installButton').classList.remove('hidden');});
  $('installButton').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installButton').classList.add('hidden');}else{showToast('Safariの共有メニューから「ホーム画面に追加」を選択してください');}});
  if(window.matchMedia){const darkPreference=matchMedia('(prefers-color-scheme: dark)');darkPreference.addEventListener?.('change',()=>{if((state.settings.theme||'system')==='system')applyTheme();});}
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  applyTheme();
  const initialView=new URLSearchParams(location.search).get('view');
  if(['home','study','quiz','review','progress','settings'].includes(initialView))navTo(initialView);else renderAll();
}

function renderAll(){applyTheme();renderHome();if(currentView==='study')renderTerms();if(currentView==='review')renderReview();if(currentView==='progress')renderProgress();if(currentView==='settings')renderSettings();}
function renderHome(){
  const daily=state.settings.dailyGoal||10, done=todayAttempts().length,pct=clamp(done/daily*100,0,100);
  $('dailyProgressText').textContent=`${done} / ${daily}`;$('dailyProgressBar').style.width=pct+'%';
  const remaining=Math.max(daily-done,0),due=dueTerms().length,studied=studiedTerms().length,acc=accuracy();
  $('homePlanTitle').textContent=due>0?'期限復習から始める':remaining>0?`今日の目標まであと${remaining}問`:'今日の目標を達成しました';
  $('homePlanText').textContent=due>0?`期限が来ている${due}語を先に復習して、忘れかけた用語を戻しましょう。`:remaining>0?'10問単位で演習し、間違えた用語は自動で復習候補に入ります。':'余力があれば未学習語か苦手語を少し進めましょう。';
  $('homeReviewButton').textContent=due>0?`復習 ${due}語`:'復習を見る';
  $('examCountdownText').textContent=examStatus();
  $('streakValue').textContent=currentStreak()+'日';$('accuracyValue').textContent=acc===null?'—':acc+'%';
  $('studiedValue').textContent=studied;$('studiedCaption').textContent=`全${TERMS.length}語`;$('dueValue').textContent=due;
  const ready=readiness();$('readinessValue').textContent=ready+'%';$('readinessBar').style.width=ready+'%';
  $('homeReadinessRing').textContent=ready+'%';$('homeReadinessRing').parentElement.style.setProperty('--ring',`${ready*3.6}deg`);
  renderActivity();
  const cats=groupStats();$('homeCategoryProgress').innerHTML=cats.map(c=>{const p=Math.round(c.studied/c.terms*100);return `<div class="stack-item"><div class="stack-item-main"><strong>${esc(c.system)}</strong><small>${c.studied}/${c.terms}語・正答率 ${c.accuracy===null?'—':c.accuracy+'%'}</small><div class="mini-progress"><span style="width:${p}%"></span></div></div><b>${p}%</b></div>`;}).join('');
  const weak=TERMS.filter(t=>{const s=getTermState(t.id);return s.wrong>0||s.mastery>0;}).sort((a,b)=>termScore(b)-termScore(a)).slice(0,5);
  $('weakList').innerHTML=weak.length?weak.map(t=>stackTerm(t)).join(''):'<p class="empty">問題を解くと弱点が表示されます。</p>';
}
function renderActivity(){const el=$('activityChart'),days=[];for(let i=13;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const date=localDate(d);days.push({date,count:state.attempts.filter(a=>a.date===date).length,label:d.getDate()});}const max=Math.max(1,...days.map(x=>x.count));el.innerHTML=days.map(x=>`<div class="activity-day" title="${x.date}: ${x.count}問"><div class="activity-bar" style="height:${Math.max(3,x.count/max*86)}px"></div><small>${x.label}</small></div>`).join('');}
function stackTerm(t){const s=getTermState(t.id);return `<button class="stack-item term-link text-button" data-term-id="${esc(t.id)}"><span class="stack-item-main"><strong>${esc(t['用語'])}</strong><small>${esc(t['系'])}・正解${s.correct}/誤答${s.wrong}</small></span><b>Lv.${s.mastery}</b></button>`;}

function filteredTerms(){const q=normalize($('termSearch').value),system=$('systemFilter').value,mf=$('masteryFilter').value;return TERMS.filter(t=>{const s=getTermState(t.id);if(system&&t['系']!==system)return false;if(mf==='unlearned'&&s.mastery!==0)return false;if(mf==='weak'&&!(s.wrong>0||s.mastery===1||s.mastery===2))return false;if(mf==='learned'&&s.mastery===0)return false;if(mf==='bookmarked'&&!s.bookmark)return false;if(q&&!normalize(Object.values(t).join(' ')).includes(q))return false;return true;});}
function renderTerms(){const all=filteredTerms(),show=all.slice(0,visibleTermCount);$('termCountLabel').textContent=`${all.length}語`;$('termList').innerHTML=show.length?show.map(termCard).join(''):'<div class="panel empty">該当する用語はありません。</div>';$('loadMoreTerms').classList.toggle('hidden',show.length>=all.length);bindTermLinks();}
function termCard(t){const s=getTermState(t.id);return `<button class="term-card term-link" data-term-id="${esc(t.id)}"><div class="term-card-header"><div><h3>${esc(t['用語'])}</h3><small>${esc(t['系'])} › ${esc(t['中分類'])}</small></div><span class="bookmark ${s.bookmark?'active':''}">${s.bookmark?'★':'☆'}</span></div><p>${esc(t['基本解説'])}</p><div class="badges"><span class="badge gray">理解 Lv.${s.mastery}</span>${s.wrong?`<span class="badge bad">誤答 ${s.wrong}</span>`:''}${s.due&&s.due<=localDate()?'<span class="badge">復習期限</span>':''}</div></button>`;}
function bindTermLinks(){$$('.term-link').forEach(b=>b.onclick=()=>openTerm(b.dataset.termId));}
function openTerm(id){const t=termById.get(String(id));if(!t)return;const s=getTermState(t.id);const rel=String(t['関連語']||'').split('/').map(x=>x.trim()).filter(Boolean);$('termDialogContent').innerHTML=`<div class="dialog-head"><div><p class="eyebrow">${esc(t['系'])} / ${esc(t['中分類'])}</p><h2>${esc(t['用語'])}</h2><p class="subtle">${esc(t['英語'])}</p></div><button class="close-button" data-close-dialog type="button">×</button></div><div class="badges"><span class="badge gray">${esc(t['大分類'])}</span><span class="badge gray">${esc(t['小分類'])}</span>${s.bookmark?'<span class="badge good">保存済み</span>':''}</div><section class="detail-section"><h3>基本解説</h3><p>${esc(t['基本解説'])||'解説未登録'}</p></section><section class="detail-section"><h3>試験での着眼点</h3><p>${esc(t['試験での着眼点'])||'—'}</p></section><section class="detail-section"><h3>関連語</h3><div class="badges">${rel.length?rel.map(r=>`<button class="badge gray related-term" data-name="${esc(r)}" type="button">${esc(r)}</button>`).join(''):'—'}</div></section><section class="detail-section"><h3>理解度</h3><div class="mastery-row">${[0,1,2,3,4,5].map(n=>`<button class="${s.mastery===n?'active':''}" data-mastery="${n}" type="button">${n}</button>`).join('')}</div><p class="help">0:未学習 / 3:説明できる / 5:他人に教えられる</p></section><section class="detail-section"><h3>自分用メモ</h3><textarea id="termNote" class="note-area" placeholder="覚え方や間違えた点を記録">${esc(s.note)}</textarea><button id="saveNoteButton" class="secondary full" type="button">メモを保存</button></section><div class="dialog-actions"><button id="bookmarkButton" class="secondary" type="button">${s.bookmark?'★ 保存解除':'☆ 保存'}</button><button id="copyPromptButton" class="primary" type="button">AI質問文をコピー</button></div>`;
  const dialog=$('termDialog');if(!dialog.open)dialog.showModal();
  $('[data-close-dialog]').onclick=()=>dialog.close();
  $$('[data-mastery]').forEach(b=>b.onclick=()=>{setMastery(t.id,Number(b.dataset.mastery));openTerm(t.id);});
  $$('.related-term').forEach(b=>b.onclick=()=>{const x=termByName.get(normalize(b.dataset.name));if(x)openTerm(x.id);else showToast('関連語の詳細は見つかりませんでした');});
  $('saveNoteButton').onclick=()=>{s.note=$('termNote').value.trim();saveState(false);showToast('メモを保存しました');};
  $('bookmarkButton').onclick=()=>{s.bookmark=!s.bookmark;saveState(false);openTerm(t.id);};
  $('copyPromptButton').onclick=()=>copyText(`基本情報技術者試験の「${t['用語']}」を、初心者向けに次の順で説明してください。1. 一言での定義 2. 仕組み 3. 試験で問われるポイント 4. 関連用語との違い 5. 四択問題を1問。私が特に確認したい点: ${t['試験での着眼点']||'基本事項'}`,'質問文をコピーしました');
}
function setMastery(id,n){const s=getTermState(id);s.mastery=n;s.last=localDate();s.due=n===0?null:addDays(localDate(),[0,1,2,4,7,14][n]);saveState(false);renderAll();}

function selectPool(mode,system){let pool=TERMS.filter(t=>!system||t['系']===system);if(mode==='due'){const due=new Set(dueTerms().map(t=>String(t.id)));pool=pool.filter(t=>due.has(String(t.id)));}else if(mode==='unlearned'){const u=pool.filter(t=>getTermState(t.id).mastery===0);if(u.length>=4)pool=u;}else if(mode==='weak'){pool=pool.sort((a,b)=>termScore(b)-termScore(a)).slice(0,Math.max(30,Math.ceil(pool.length*.25)));}return pool.length?pool:TERMS.filter(t=>!system||t['系']===system);}
function sample(arr,n){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,n);}
function startQuiz(overrides={}){const mode=overrides.mode||$('quizMode').value,system=overrides.system??$('quizSystem').value,length=Number(overrides.length||$('quizLength').value),type=overrides.type||$('quizType').value,pool=selectPool(mode,system);const chosen=sample(pool,Math.min(length,pool.length));quiz={mode,system,type,length:chosen.length,index:0,correct:0,answered:false,items:chosen.map(t=>makeQuestion(t,type)),results:[],startedAt:Date.now()};$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();}
function distractorsFor(target){let pool=TERMS.filter(t=>t.id!==target.id&&t['中分類']&&t['中分類']===target['中分類']);if(pool.length<3)pool=TERMS.filter(t=>t.id!==target.id&&t['大分類']===target['大分類']);if(pool.length<3)pool=TERMS.filter(t=>t.id!==target.id&&t['系']===target['系']);return sample(pool,3);}
function makeQuestion(target,type){let qtype=type==='mixed'?(Math.random()<.5?'description':'term'):type;const ds=distractorsFor(target);if(qtype==='term')return {target,qtype,prompt:`「${target['用語']}」の説明として最も適切なものはどれですか。`,options:sample([target,...ds],4).map(t=>({id:t.id,label:t['基本解説']||`${t['用語']}に関する概念`}))};return {target,qtype,prompt:target['基本解説']||target['試験での着眼点'],options:sample([target,...ds],4).map(t=>({id:t.id,label:t['用語']}))};}
function renderQuizQuestion(){if(!quiz)return;if(quiz.index>=quiz.items.length){finishQuiz();return;}const q=quiz.items[quiz.index];quiz.answered=false;$('quizSessionStatus').textContent=`${quiz.index+1} / ${quiz.length}`;$('quizArea').innerHTML=`<article class="quiz-card"><div class="quiz-meta"><span>${esc(q.target['系'])} › ${esc(q.target['中分類'])}</span><span>${quiz.index+1}/${quiz.length}</span></div><div class="progress-track" style="margin-top:10px"><span style="width:${quiz.index/quiz.length*100}%"></span></div><p class="quiz-question">${esc(q.prompt)}</p><div class="option-list">${q.options.map((o,i)=>`<button class="option" data-answer-id="${esc(o.id)}" type="button"><span>${String.fromCharCode(65+i)}.</span> ${esc(o.label)}</button>`).join('')}</div><div id="quizFeedback"></div></article>`;$$('[data-answer-id]').forEach(b=>b.onclick=()=>answerQuestion(b.dataset.answerId,b));}
function answerQuestion(id,button){if(!quiz||quiz.answered)return;quiz.answered=true;const q=quiz.items[quiz.index],correct=String(id)===String(q.target.id);if(correct)quiz.correct++;const s=getTermState(q.target.id);s.last=localDate();if(correct){s.correct++;s.streak++;s.mastery=Math.max(s.mastery,2);}else{s.wrong++;s.streak=0;s.mastery=Math.min(Math.max(s.mastery,1),2);}state.attempts.push({id:String(q.target.id),correct,date:localDate(),ts:Date.now(),mode:quiz.mode,type:q.qtype,system:q.target['系']});quiz.results.push({id:q.target.id,correct});$$('[data-answer-id]').forEach(b=>{b.disabled=true;if(String(b.dataset.answerId)===String(q.target.id))b.classList.add('correct');});if(!correct)button.classList.add('wrong');scheduleReview(q.target.id,correct?4:1);saveState(false);$('quizFeedback').innerHTML=`<div class="explanation"><strong>${correct?'正解':'不正解'}</strong><p><b>正解：</b>${esc(q.target['用語'])}</p><p>${esc(q.target['試験での着眼点'])||esc(q.target['基本解説'])}</p><div class="rating-row"><button data-rating="1">もう一度</button><button data-rating="3">難しい</button><button data-rating="4">理解</button><button data-rating="5">簡単</button></div><div class="quiz-actions"><button id="nextQuestionButton" class="primary" type="button">${quiz.index+1>=quiz.length?'結果を見る':'次の問題'}</button></div></div>`;$$('[data-rating]').forEach(b=>b.onclick=()=>{scheduleReview(q.target.id,Number(b.dataset.rating));$$('[data-rating]').forEach(x=>x.disabled=true);showToast('復習間隔を更新しました');});$('nextQuestionButton').onclick=()=>{quiz.index++;renderQuizQuestion();};}
function scheduleReview(id,quality){const s=getTermState(id);if(quality<3){s.repetitions=0;s.interval=1;s.ease=Math.max(1.3,s.ease-.2);s.due=addDays(localDate(),1);return;}s.repetitions=(s.repetitions||0)+1;if(s.repetitions===1)s.interval=1;else if(s.repetitions===2)s.interval=3;else s.interval=Math.max(1,Math.round((s.interval||3)*(s.ease||2.5)));s.ease=Math.max(1.3,(s.ease||2.5)+(0.1-(5-quality)*(0.08+(5-quality)*0.02)));s.due=addDays(localDate(),s.interval);s.mastery=clamp(Math.max(s.mastery,quality===5?4:3),0,5);}
function finishQuiz(){const pct=Math.round(quiz.correct/quiz.length*100);state.sessions.push({date:localDate(),ts:Date.now(),mode:quiz.mode,total:quiz.length,correct:quiz.correct,durationSec:Math.round((Date.now()-quiz.startedAt)/1000)});saveState(false);$('quizArea').classList.add('hidden');$('quizSetup').classList.remove('hidden');$('quizSessionStatus').textContent='';$('resultDialogContent').innerHTML=`<div class="dialog-head"><div><p class="eyebrow">Session complete</p><h2>演習結果</h2></div><button class="close-button" data-close-result type="button">×</button></div><div class="result-score"><strong>${pct}%</strong><span>${quiz.correct} / ${quiz.length}問正解</span></div><div class="result-breakdown"><div><strong>${quiz.correct}</strong><small>正解</small></div><div><strong>${quiz.length-quiz.correct}</strong><small>誤答</small></div><div><strong>${Math.round((Date.now()-quiz.startedAt)/1000)}秒</strong><small>所要時間</small></div></div><button id="retryWeakButton" class="primary full" type="button">間違えた問題を復習</button>`;const d=$('resultDialog');d.showModal();$('[data-close-result]').onclick=()=>{d.close();renderAll();};$('retryWeakButton').onclick=()=>{const ids=new Set(quiz.results.filter(r=>!r.correct).map(r=>String(r.id)));d.close();if(!ids.size){showToast('間違えた問題はありません');return;}const selected=TERMS.filter(t=>ids.has(String(t.id)));quiz={mode:'retry',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(t=>makeQuestion(t,'mixed')),results:[],startedAt:Date.now()};$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();};renderAll();}

function reviewTerms(){if(reviewFilter==='wrong')return TERMS.filter(t=>getTermState(t.id).wrong>0).sort((a,b)=>getTermState(b.id).wrong-getTermState(a.id).wrong);if(reviewFilter==='bookmark')return TERMS.filter(t=>getTermState(t.id).bookmark);return dueTerms().sort((a,b)=>String(getTermState(a.id).due).localeCompare(String(getTermState(b.id).due)));}
function renderReview(){const list=reviewTerms();$('reviewCountLabel').textContent=`${list.length}語`;$('reviewHeroCount').textContent=`${dueTerms().length}語`;$('startReviewButton').disabled=dueTerms().length===0;$('reviewList').innerHTML=list.length?list.slice(0,100).map(termCard).join(''):'<div class="panel empty">現在の対象はありません。</div>';bindTermLinks();}
function renderProgress(){const total=state.attempts.length,c=state.attempts.filter(a=>a.correct).length;$('totalAnswersValue').textContent=total;$('totalCorrectValue').textContent=c;$('studyDaysValue').textContent=daysWithActivity().length;$('bestStreakValue').textContent=bestStreak()+'日';$('categoryAnalytics').innerHTML=groupStats().map(x=>`<div class="analytics-row"><strong>${esc(x.system)}</strong><div class="progress-track"><span style="width:${x.accuracy??0}%"></span></div><span>${x.accuracy===null?'—':x.accuracy+'%'}</span></div>`).join('');const rank=TERMS.filter(t=>getTermState(t.id).wrong>0).sort((a,b)=>getTermState(b.id).wrong-getTermState(a.id).wrong).slice(0,10);$('mistakeRanking').innerHTML=rank.length?rank.map(stackTerm).join(''):'<p class="empty">誤答履歴はありません。</p>';bindTermLinks();}
function renderSettings(){$('dailyGoalInput').value=state.settings.dailyGoal||10;$('examDateInput').value=state.settings.examDate||'';$('themeInput').value=state.settings.theme||'system';}
function saveSettings(){state.settings.dailyGoal=clamp(Number($('dailyGoalInput').value)||10,1,100);state.settings.examDate=$('examDateInput').value;state.settings.theme=$('themeInput').value;saveState();showToast('設定を保存しました');}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`FE_Learning_OS_backup_${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function importData(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const x=JSON.parse(reader.result);if(!x||x.version!==2)throw new Error();state=x;saveState();showToast('バックアップを読み込みました');}catch(err){alert('このバックアップファイルは読み込めません。');}};reader.readAsText(file);e.target.value='';}
function resetData(){if(confirm('学習履歴・メモ・設定をすべて削除しますか？')){localStorage.removeItem(STORAGE_KEY);state=defaultState();saveState();showToast('学習データを削除しました');}}
function copyText(text,msg='コピーしました'){if(navigator.clipboard&&location.protocol!=='file:')navigator.clipboard.writeText(text).then(()=>showToast(msg)).catch(()=>fallbackCopy(text,msg));else fallbackCopy(text,msg);}
function fallbackCopy(text,msg){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast(msg);}
function copyWeakPrompt(){const weak=TERMS.filter(t=>getTermState(t.id).wrong>0).sort((a,b)=>getTermState(b.id).wrong-getTermState(a.id).wrong).slice(0,10);const summary=weak.length?weak.map(t=>`${t['用語']}（誤答${getTermState(t.id).wrong}回）`).join('、'):'まだ誤答データなし';copyText(`私は基本情報技術者試験を勉強しています。現在の弱点候補は「${summary}」です。これらの共通する勘違いを分析し、優先順位を付けて、30分の復習メニューと確認問題を作ってください。説明は大学生向けで、用語の違いを明確にしてください。`,'弱点分析用プロンプトをコピーしました');}

setup();
})();
