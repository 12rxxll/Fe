(() => {
'use strict';
const CORE_TERMS = Array.isArray(window.FE_TERMS) ? window.FE_TERMS : [];
const SYLLABUS_TERMS = Array.isArray(window.FE_SYLLABUS_TERMS) ? window.FE_SYLLABUS_TERMS : [];
const KMAP_DATA = window.FE_KNOWLEDGE_MAP || null;
const KNOWLEDGE_TERMS = knowledgeMapTermsToGlossary(KMAP_DATA);
const TERMS = mergeTerms(CORE_TERMS, SYLLABUS_TERMS, KNOWLEDGE_TERMS);
const SUBJECT_A = Array.isArray(window.FE_SUBJECT_A_QUESTIONS) ? window.FE_SUBJECT_A_QUESTIONS : [];
const STORAGE_KEY = 'fe-learning-os-v2';
const DATA_SCHEMA = 5;
const DAY = 86400000;
const defaultState = () => ({version:2,schemaVersion:DATA_SCHEMA,createdAt:new Date().toISOString(),settings:{dailyGoal:10,examDate:'',theme:'system'},terms:{},attempts:[],sessions:[],subjectA:{questions:{},attempts:[],sessions:[]}});
let needsMigrationSave = false;
let state = loadState();
let currentView = 'home';
let visibleTermCount = 40;
let reviewFilter = 'due';
let quiz = null;
let deferredInstall = null;
let pendingServiceWorker = null;
let refreshingForUpdate = false;
let knowledgeMapService = null;
let selectedKnowledgeTermId = '';
let knowledgeMapDefaultsApplied = false;
let knowledgeMapMode = 'overview';
const knowledgeExpandedCategories = new Set();
const knowledgeCategoryLimits = new Map();
const termById = new Map(TERMS.map(t => [String(t.id), t]));
const termByName = new Map(TERMS.map(t => [normalize(t['用語']), t]));

const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const qs = sel => document.querySelector(sel);
function normalize(v){return String(v ?? '').trim().toLowerCase();}
function termKey(t){return normalize(t?.['用語']).replace(/\s+/g,'');}
function mergeTerms(...groups){const out=[],seen=new Set();groups.flat().forEach(t=>{const key=termKey(t);if(!key||seen.has(key))return;seen.add(key);out.push(t);});return out;}
function esc(v){return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function localDate(d=new Date()){const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);return x.toISOString().slice(0,10);}
function addDays(dateStr,days){const d=new Date((dateStr||localDate())+'T12:00:00');d.setDate(d.getDate()+days);return localDate(d);}
function diffDays(from,to=localDate()){if(!from)return 0;return Math.round((new Date(to+'T12:00:00')-new Date(from+'T12:00:00'))/DAY);}
function daysSince(date){return date?Math.max(0,diffDays(date)):999;}
function clamp(n,a,b){return Math.max(a,Math.min(b,n));}
function unique(a){return [...new Set(a.filter(Boolean))];}
function knowledgeMapTermsToGlossary(data){
  if(!data||!Array.isArray(data.terms))return [];
  const categories=new Map((Array.isArray(data.categories)?data.categories:[]).map(c=>[c.id,c]));
  const subjects=new Map((Array.isArray(data.subjects)?data.subjects:[]).map(s=>[s.id,s]));
  const relations=Array.isArray(data.relations)?data.relations:[];
  const namesById=new Map(data.terms.map(t=>[t.id,t.name]));
  return data.terms.map(t=>{
    const category=categories.get(t.categoryId)||{},parent=categories.get(category.parentCategoryId)||{},subject=subjects.get(category.subjectId||parent.subjectId)||{};
    const related=relations.filter(r=>r.sourceTermId===t.id||r.targetTermId===t.id).map(r=>namesById.get(r.sourceTermId===t.id?r.targetTermId:r.sourceTermId)).filter(Boolean);
    return {
      id:`km-${t.id}`,
      用語:t.name,
      系:subject.name||'テクノロジ系',
      大分類:parent.name||'コンピュータシステム',
      中分類:category.name||'知識マップ',
      小分類:category.description||'知識マップ初期データ',
      英語:'',
      基本解説:t.detailedDescription||t.shortDescription||'知識マップで管理する用語。',
      試験での着眼点:`重要度${t.importance}/5、難易度${t.difficulty}/5。前提語と関連語を合わせて確認する。`,
      関連語:unique(related).slice(0,8).join(' / '),
      検索語:unique([t.name,...(Array.isArray(t.aliases)?t.aliases:[]),category.name,parent.name,subject.name]).join(' '),
      出典:'知識マップ初期データ'
    };
  });
}
function getSystems(){return unique(TERMS.map(t=>t['系']));}
function emptyTermState(){return {mastery:0,correct:0,wrong:0,knowledgeCorrect:0,knowledgeWrong:0,streak:0,consecutiveIncorrect:0,ease:2.5,interval:0,repetitions:0,due:null,nextReview:null,last:null,lastCorrect:null,lastWrong:null,learnedAt:null,updatedAt:null,reviewPriority:0,bookmark:false,note:'',weakReasons:[]};}
function migrateTermState(value={}){const s=Object.assign(emptyTermState(),value||{});s.mastery=clamp(Number(s.mastery)||0,0,5);s.correct=Math.max(0,Number(s.correct)||0);s.wrong=Math.max(0,Number(s.wrong)||0);s.knowledgeCorrect=Math.max(0,Number(s.knowledgeCorrect)||0);s.knowledgeWrong=Math.max(0,Number(s.knowledgeWrong)||0);s.streak=Math.max(0,Number(s.streak)||0);s.consecutiveIncorrect=Math.max(0,Number(s.consecutiveIncorrect)||0);s.ease=Math.max(1.3,Number(s.ease)||2.5);s.interval=Math.max(0,Number(s.interval)||0);s.repetitions=Math.max(0,Number(s.repetitions)||0);s.due=s.due||s.nextReview||null;s.nextReview=s.nextReview||s.due||null;s.last=s.last||s.lastCorrect||s.lastWrong||null;s.reviewPriority=Math.max(0,Number(s.reviewPriority)||0);s.weakReasons=Array.isArray(s.weakReasons)?s.weakReasons:[];return s;}
function migrateState(s,sourceSchema=2){if((Number(sourceSchema)||2)<DATA_SCHEMA)needsMigrationSave=true;s.schemaVersion=DATA_SCHEMA;s.terms=s.terms&&typeof s.terms==='object'?s.terms:{};Object.keys(s.terms).forEach(id=>{s.terms[id]=migrateTermState(s.terms[id]);});s.attempts=Array.isArray(s.attempts)?s.attempts:[];s.sessions=Array.isArray(s.sessions)?s.sessions:[];s.subjectA=s.subjectA&&typeof s.subjectA==='object'?s.subjectA:{questions:{},attempts:[],sessions:[]};s.subjectA.questions=s.subjectA.questions&&typeof s.subjectA.questions==='object'?s.subjectA.questions:{};s.subjectA.attempts=Array.isArray(s.subjectA.attempts)?s.subjectA.attempts:[];s.subjectA.sessions=Array.isArray(s.subjectA.sessions)?s.subjectA.sessions:[];return s;}
function termStateNeedsMigration(s){return !('nextReview' in s)||!('lastCorrect' in s)||!('lastWrong' in s)||!('reviewPriority' in s)||!('knowledgeCorrect' in s)||!('knowledgeWrong' in s)||!('consecutiveIncorrect' in s)||!('weakReasons' in s);}
function readTermState(id){id=String(id);if(!state.terms[id])return emptyTermState();if(termStateNeedsMigration(state.terms[id]))state.terms[id]=migrateTermState(state.terms[id]);return state.terms[id];}
function getTermState(id){id=String(id);if(!state.terms[id]) state.terms[id]=emptyTermState();else if(termStateNeedsMigration(state.terms[id])) state.terms[id]=migrateTermState(state.terms[id]);return state.terms[id];}
function emptySubjectState(){return {correct:0,wrong:0,last:null,lastCorrect:null,lastWrong:null};}
function getSubjectState(id){id=String(id);if(!state.subjectA)state.subjectA={questions:{},attempts:[],sessions:[]};if(!state.subjectA.questions[id])state.subjectA.questions[id]=emptySubjectState();return state.subjectA.questions[id];}
function loadState(){try{const s=JSON.parse(localStorage.getItem(STORAGE_KEY));if(s&&s.version===2)return migrateState(Object.assign(defaultState(),s,{settings:Object.assign(defaultState().settings,s.settings||{})}),s.schemaVersion);}catch(e){}return defaultState();}
function refreshReviewPriorities(){Object.keys(state.terms||{}).forEach(id=>{const t=termById.get(String(id));if(t)state.terms[id].reviewPriority=reviewPriority(t);});}
function saveState(render=true){refreshReviewPriorities();localStorage.setItem(STORAGE_KEY,JSON.stringify(state));if(render) renderAll();}
function showToast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>el.classList.remove('show'),2200);}
function applyTheme(){let theme=state.settings.theme||'system';if(theme==='system')theme=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=theme;}
function todayAttempts(){return state.attempts.filter(a=>a.date===localDate());}
function reviewDate(s){return s.due||s.nextReview||null;}
function dueTerms(){const today=localDate();return TERMS.filter(t=>{const s=readTermState(t.id),due=reviewDate(s);return due&&due<=today;});}
function studiedTerms(){return TERMS.filter(t=>readTermState(t.id).mastery>0);}
function attemptsFor(id){return state.attempts.filter(a=>String(a.id)===String(id));}
function accuracy(arr=state.attempts){return arr.length?Math.round(arr.filter(a=>a.correct).length/arr.length*100):null;}
function daysWithActivity(){return unique(state.attempts.map(a=>a.date)).sort();}
function currentStreak(){const set=new Set(daysWithActivity());let d=new Date(localDate()+'T12:00:00');if(!set.has(localDate(d))){d.setDate(d.getDate()-1);}let n=0;while(set.has(localDate(d))){n++;d.setDate(d.getDate()-1);}return n;}
function bestStreak(){const days=daysWithActivity();if(!days.length)return 0;let best=1,run=1;for(let i=1;i<days.length;i++){const a=new Date(days[i-1]+'T12:00:00'),b=new Date(days[i]+'T12:00:00');if(Math.round((b-a)/DAY)===1)run++;else run=1;best=Math.max(best,run);}return best;}
function examStatus(){const value=state.settings.examDate;if(!value)return '試験日未設定';const today=new Date(localDate()+'T12:00:00'),exam=new Date(value+'T12:00:00');if(Number.isNaN(exam.getTime()))return '試験日未設定';const days=Math.ceil((exam-today)/DAY);if(days<0)return `試験日から${Math.abs(days)}日経過`;if(days===0)return '試験日当日';return `試験まで${days}日`;}
function isUnlearnedTerm(t){const s=readTermState(t.id);return s.mastery===0&&s.correct+s.wrong===0;}
function isForgettingTerm(t){const s=readTermState(t.id);if(isUnlearnedTerm(t))return false;const stale=daysSince(s.last)>=Math.max(3,(s.interval||3)*2),lowMastery=s.mastery<=2&&daysSince(s.last)>=1;return (s.wrong>0&&s.streak<3)||lowMastery||stale;}
function reviewStatus(t){const s=readTermState(t.id),due=reviewDate(s),today=localDate();if(isUnlearnedTerm(t))return {key:'unlearned',label:'未学習',className:'gray'};if(due&&due<=today)return {key:'due',label:'復習期限',className:''};if(isForgettingTerm(t))return {key:'forgetting',label:'忘れかけ',className:'bad'};if(s.mastery>=4&&s.streak>=3)return {key:'mastered',label:'習得済み',className:'good'};return {key:'learning',label:'学習中',className:'gray'};}
function reviewPriority(t){const s=readTermState(t.id),due=reviewDate(s),today=localDate(),overdue=due?Math.max(0,diffDays(due,today)):0,lastGap=daysSince(s.last),total=s.correct+s.wrong,acc=total?s.correct/total:.5;const dueBoost=due&&due<=today?36+overdue*4:0,masteryRisk=(5-s.mastery)*9,wrongRisk=s.wrong*7,accuracyRisk=(1-acc)*18,staleRisk=!isUnlearnedTerm(t)?Math.min(28,Math.max(0,lastGap-(s.interval||3))*2):0,streakRelief=Math.min(s.streak,6)*4;return Math.max(0,Math.round(dueBoost+masteryRisk+wrongRisk+accuracyRisk+staleRisk-streakRelief));}
function priorityReviewTerms(system=''){const dueIds=new Set(dueTerms().map(t=>String(t.id)));return TERMS.filter(t=>(!system||t['系']===system)&&!isUnlearnedTerm(t)&&(dueIds.has(String(t.id))||isForgettingTerm(t))).sort((a,b)=>reviewPriority(b)-reviewPriority(a));}
function nextReviewDate(){const dates=TERMS.map(t=>reviewDate(readTermState(t.id))).filter(Boolean).sort(),today=localDate();return dates.find(d=>d<=today)||dates.find(d=>d>today)||null;}
function formatReviewDate(value){if(!value)return '未設定';const today=localDate();if(value<today)return '期限超過';if(value===today)return '今日';return value.slice(5).replace('-','/');}
function termScore(t){const s=readTermState(t.id);const total=s.correct+s.wrong;const acc=total?s.correct/total:.5;return (1-s.mastery/5)*3 + s.wrong*1.2 + (1-acc)*4 + (reviewDate(s)&&reviewDate(s)<=localDate()?3:0) + reviewPriority(t)/12;}
function readiness(){const coverage=TERMS.length?studiedTerms().length/TERMS.length:0;const acc=(accuracy()??0)/100;return Math.round((coverage*.45+acc*.55)*100);}
function groupStats(){return getSystems().map(system=>{const terms=TERMS.filter(t=>t['系']===system);const ids=new Set(terms.map(t=>String(t.id)));const attempts=state.attempts.filter(a=>ids.has(String(a.id))),correct=attempts.filter(a=>a.correct).length,wrong=attempts.length-correct;const studied=terms.filter(t=>readTermState(t.id).mastery>0).length;return {system,terms:terms.length,studied,attempts:attempts.length,correct,wrong,accuracy:accuracy(attempts)};});}
function firstSentence(text,limit=74){const value=String(text||'').trim();if(!value)return '説明未登録';const end=value.search(/[。．.!?]/);const sentence=end>=0?value.slice(0,end+1):value;return sentence.length>limit?sentence.slice(0,limit-1)+'…':sentence;}
function weakTerms(system=''){return TERMS.filter(t=>(!system||t['系']===system)&&readTermState(t.id).wrong>0).sort((a,b)=>termScore(b)-termScore(a));}
function unlearnedTerms(system=''){return TERMS.filter(t=>(!system||t['系']===system)&&readTermState(t.id).mastery===0);}
function recommendedTerms(length=10,system=''){const due=priorityReviewTerms(system);const weak=weakTerms(system);const fresh=sample(unlearnedTerms(system),Math.max(length,12));const fallback=sample(TERMS.filter(t=>!system||t['系']===system),length);const result=[],seen=new Set();[due,weak,fresh,fallback].forEach(group=>group.forEach(t=>{if(result.length<length&&!seen.has(String(t.id))){seen.add(String(t.id));result.push(t);}}));return result;}
function todayTaskItems(daily,done){const queue=priorityReviewTerms().length,due=dueTerms().length,weak=weakTerms().length,unlearned=unlearnedTerms().length,remaining=Math.max(daily-done,0);const items=[];if(queue>0)items.push({label:`今日の復習 ${queue}語を優先`,meta:due?`期限 ${due}語`:'忘れかけ対策',kind:'due'});if(weak>0)items.push({label:`誤答が残る${Math.min(weak,10)}語を確認`,meta:'苦手対策',kind:'weak'});if(remaining>0)items.push({label:`今日の目標まであと${remaining}問`,meta:'おすすめ演習',kind:'quiz'});if(unlearned>0)items.push({label:`未学習語を少し追加`,meta:`残り${unlearned}語`,kind:'new'});return items.slice(0,4);}
function quizWeakSystems(results){const counts={};results.filter(r=>!r.correct).forEach(r=>{const system=r.system||(termById.get(String(r.id))||{})['系'];if(system)counts[system]=(counts[system]||0)+1;});return Object.entries(counts).sort((a,b)=>b[1]-a[1]);}
function nextActionText(pct,wrongCount){if(wrongCount>0)return '間違えた用語をすぐ復習すると定着しやすいです。';if(pct>=85)return '良い流れです。未学習語を混ぜたおすすめ演習で範囲を広げましょう。';return 'もう一度おすすめ演習で、復習期限と未学習語をバランスよく進めましょう。';}
function learningStatusCounts(){const counts={unlearned:0,learning:0,mastered:0};TERMS.forEach(t=>{const s=readTermState(t.id);if(isUnlearnedTerm(t))counts.unlearned++;else if(s.mastery>=4&&s.streak>=3)counts.mastered++;else counts.learning++;});return counts;}
function weakSystemStats(){return groupStats().map(x=>Object.assign({},x,{weakScore:x.wrong*2+(x.accuracy===null?0:100-x.accuracy)+Math.max(0,x.terms-x.studied)/x.terms*12})).sort((a,b)=>b.weakScore-a.weakScore);}
function studyAdvice(){const due=priorityReviewTerms().length,weak=weakSystemStats()[0],unlearned=unlearnedTerms().length;if(due>0)return `まず復習対象${due}語を処理し、その後におすすめ演習を10問進めましょう。`;if(weak&&weak.wrong>0)return `${weak.system}の誤答が目立ちます。分野を絞って苦手優先の演習を行いましょう。`;if(unlearned>0)return `未学習語が${unlearned}語あります。おすすめ演習で新しい用語を少しずつ混ぜましょう。`;return '習得済みを維持するため、短い復習を継続しましょう。';}
function getKnowledgeService(){if(!knowledgeMapService&&KMAP_DATA&&window.FEKnowledgeMap){knowledgeMapService=window.FEKnowledgeMap.createKnowledgeMapService(KMAP_DATA,{terms:TERMS,readTermState,attemptsFor,reviewDate,daysSince});const validation=knowledgeMapService.validateData();if(!validation.ok)console.warn('Knowledge map validation warnings',validation.errors);}return knowledgeMapService;}
function formatProgressCount(value){const n=Number(value)||0;return Number.isInteger(n)?String(n):n.toFixed(1).replace(/\.0$/,'');}
function formatMastery(value){const n=clamp(Number(value)||0,0,5);return Number.isInteger(n)?String(n):n.toFixed(1).replace(/\.0$/,'');}
function addWeakReason(s,reason){s.weakReasons=Array.isArray(s.weakReasons)?s.weakReasons:[];if(reason&&!s.weakReasons.includes(reason))s.weakReasons.push(reason);if(s.weakReasons.length>6)s.weakReasons=s.weakReasons.slice(-6);}
function updateWeightedTermProgress(appTermId,{correct,role='related',weight=0.3,source='knowledge',questionId='',countAsDirect=false}={}){
  const term=termById.get(String(appTermId));if(!term)return false;
  const s=getTermState(appTermId),today=localDate(),w=clamp(Number(weight)||0.3,0.05,1),primary=role==='primary';
  s.last=today;s.learnedAt=s.learnedAt||today;s.updatedAt=today;
  if(countAsDirect){if(correct)s.correct++;else s.wrong++;}
  else if(correct)s.knowledgeCorrect=Number(s.knowledgeCorrect||0)+w;
  else s.knowledgeWrong=Number(s.knowledgeWrong||0)+w;
  if(correct){s.streak=primary?Math.max(1,Number(s.streak||0)+1):Number(s.streak||0);s.consecutiveIncorrect=0;s.lastCorrect=today;const gain=(primary?1.1:role==='related'?0.45:0.35)*w;s.mastery=clamp(Math.max(s.mastery,primary?2:1)+gain,0,5);}
  else{s.streak=primary?0:Number(s.streak||0);s.consecutiveIncorrect=Number(s.consecutiveIncorrect||0)+1;s.lastWrong=today;const loss=(primary?0.9:role==='prerequisite'?0.45:0.3)*w;s.mastery=clamp(Math.max(s.mastery,1)-loss,0,5);addWeakReason(s,role==='prerequisite'?'前提用語の理解不足が疑われる':primary?'関連問題で誤答':'関連問題で誤答');}
  if(primary){scheduleReview(appTermId,correct?4:1);}
  else if(!correct){s.due=today;s.nextReview=today;s.reviewPriority=termById.has(String(appTermId))?reviewPriority(term):0;}
  else if(!reviewDate(s)){s.due=addDays(today,role==='related'?3:2);s.nextReview=s.due;s.reviewPriority=reviewPriority(term);}
  return true;
}
function applySubjectQuestionTermProgress(questionId,correct){
  const svc=getKnowledgeService();if(!svc)return [];
  const links=svc.getQuestionTermLinks(questionId),updated=[];
  links.forEach(link=>{if(link.term?.appTermId&&updateWeightedTermProgress(link.term.appTermId,{correct,role:link.role,weight:link.weight,source:'subjectA-map',questionId,countAsDirect:link.role==='primary'}))updated.push(link.term);});
  return updated;
}
function applyKnowledgeRelatedProgress(appTermId,correct,questionId=''){
  const svc=getKnowledgeService();if(!svc)return [];
  const knowledgeTerms=svc.getTermsForAppTermId(appTermId),updated=[],seen=new Set([String(appTermId)]);
  knowledgeTerms.forEach(term=>{
    svc.getRelations(term.id,'related').forEach(relation=>{const target=svc.getTerm(relation.targetTermId);if(target?.appTermId&&!seen.has(String(target.appTermId))){seen.add(String(target.appTermId));if(updateWeightedTermProgress(target.appTermId,{correct,role:'related',weight:0.35,source:'term-map',questionId}))updated.push(target);}});
    svc.getRelations(term.id,'prerequisite').forEach(relation=>{const target=svc.getTerm(relation.targetTermId);if(target?.appTermId&&!seen.has(String(target.appTermId))){seen.add(String(target.appTermId));if(updateWeightedTermProgress(target.appTermId,{correct,role:'prerequisite',weight:correct?0.25:0.55,source:'term-map',questionId}))updated.push(target);}});
  });
  return updated;
}
function activityDays(){const days=[];for(let i=13;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const date=localDate(d);days.push({date,count:state.attempts.filter(a=>a.date===date).length,label:d.getDate()});}return days;}
function renderActivityChart(el){const days=activityDays(),max=Math.max(1,...days.map(x=>x.count));el.innerHTML=days.map(x=>`<div class="activity-day" title="${x.date}: ${x.count}問"><div class="activity-bar" style="height:${Math.max(3,x.count/max*86)}px"></div><small>${x.label}</small></div>`).join('');return days;}
function syncNavigationState(){
  $$('.view').forEach(v=>{const active=v.id===`view-${currentView}`;v.classList.toggle('active',active);v.setAttribute('aria-hidden',active?'false':'true');});
  $$('[data-nav]').forEach(b=>{const active=b.dataset.nav===currentView;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
}
function syncReviewTabs(){$$('[data-review-filter]').forEach(b=>{const active=b.dataset.reviewFilter===reviewFilter;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');});}
function navTo(view){currentView=view;syncNavigationState();window.scrollTo({top:0,behavior:'smooth'});renderAll();}
function startDueReview(){const queue=priorityReviewTerms();if(queue.length>0){navTo('quiz');startQuiz({mode:'due',length:Math.min(20,Math.max(5,queue.length))});return;}navTo('review');}
function showUpdateBanner(worker){pendingServiceWorker=worker;$('updateBanner').classList.remove('hidden');}
function registerServiceWorker(){if(!('serviceWorker' in navigator)||!location.protocol.startsWith('http'))return;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshingForUpdate)return;refreshingForUpdate=true;location.reload();});navigator.serviceWorker.register('./sw.js').then(reg=>{if(reg.waiting&&navigator.serviceWorker.controller)showUpdateBanner(reg.waiting);reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdateBanner(worker);});});}).catch(()=>{});}

function setup(){
  $('todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date());
  getSystems().forEach(s=>{$('systemFilter').add(new Option(s,s));$('quizSystem').add(new Option(s,s));});
  syncNavigationState();syncReviewTabs();
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.nav)));
  $('quickStartButton').addEventListener('click',()=>{navTo('quiz');$('quizSource').value='terms';$('quizLength').value='10';startQuiz({source:'terms',mode:'weak'});});
  $('recommendedQuizButton').addEventListener('click',()=>{navTo('quiz');$('quizSource').value='terms';$('quizMode').value='recommended';$('quizLength').value='10';startQuiz({source:'terms',mode:'recommended',length:10});});
  $('homeReviewButton').addEventListener('click',startDueReview);
  $('termSearch').addEventListener('input',()=>{visibleTermCount=40;renderTerms();});
  $('systemFilter').addEventListener('change',()=>{visibleTermCount=40;renderTerms();});
  $('masteryFilter').addEventListener('change',()=>{visibleTermCount=40;renderTerms();});
  $('loadMoreTerms').addEventListener('click',()=>{visibleTermCount+=40;renderTerms();});
  $('knowledgeSearch').addEventListener('input',renderKnowledgeMap);
  $('knowledgeStatusFilter').addEventListener('change',renderKnowledgeMap);
  $$('[data-map-mode]').forEach(button=>button.addEventListener('click',()=>{knowledgeMapMode=button.dataset.mapMode||'overview';renderKnowledgeMap();}));
  $('knowledgeExpandAllButton').addEventListener('click',()=>{const svc=getKnowledgeService();if(svc)svc.categories.filter(category=>!category.parentCategoryId).forEach(category=>knowledgeExpandedCategories.add(category.id));renderKnowledgeMap();});
  $('knowledgeCollapseAllButton').addEventListener('click',()=>{knowledgeExpandedCategories.clear();knowledgeCategoryLimits.clear();renderKnowledgeMap();});
  $('knowledgeResetViewButton').addEventListener('click',()=>{$('knowledgeSearch').value='';$('knowledgeStatusFilter').value='';knowledgeCategoryLimits.clear();renderKnowledgeMap();});
  $('focusRecommendationButton').addEventListener('click',()=>{const svc=getKnowledgeService(),rec=svc?.recommendNext(1)[0];if(rec){knowledgeMapMode='tree';selectedKnowledgeTermId=rec.term.id;expandKnowledgeCategoryPath(rec.term.categoryId,svc);renderKnowledgeMap();renderKnowledgeDetail(rec.term.id);}});
  $('startQuizButton').addEventListener('click',()=>startQuiz());
  $('startReviewButton').addEventListener('click',startDueReview);
  $$('[data-review-filter]').forEach(b=>b.addEventListener('click',()=>{reviewFilter=b.dataset.reviewFilter;syncReviewTabs();renderReview();}));
  $('saveSettingsButton').addEventListener('click',saveSettings);
  $('exportButton').addEventListener('click',exportData);
  $('importInput').addEventListener('change',importData);
  $('resetButton').addEventListener('click',resetData);
  $('copyGeneralPromptButton').addEventListener('click',copyWeakPrompt);
  $('reloadUpdateButton').addEventListener('click',()=>{if(pendingServiceWorker)pendingServiceWorker.postMessage({type:'SKIP_WAITING'});});
  $('appTermCount').textContent=`${TERMS.length}語`;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installButton').classList.remove('hidden');});
  $('installButton').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installButton').classList.add('hidden');}else{showToast('Safariの共有メニューから「ホーム画面に追加」を選択してください');}});
  if(window.matchMedia){const darkPreference=matchMedia('(prefers-color-scheme: dark)');darkPreference.addEventListener?.('change',()=>{if((state.settings.theme||'system')==='system')applyTheme();});}
  registerServiceWorker();
  if(needsMigrationSave){saveState(false);needsMigrationSave=false;}
  applyTheme();
  const initialView=new URLSearchParams(location.search).get('view');
  if(['home','study','quiz','review','progress','map','settings'].includes(initialView))navTo(initialView);else renderAll();
}

function renderAll(){applyTheme();renderHome();if(currentView==='study')renderTerms();if(currentView==='review')renderReview();if(currentView==='progress')renderProgress();if(currentView==='map')renderKnowledgeMap();if(currentView==='settings')renderSettings();}
function renderHome(){
  const daily=state.settings.dailyGoal||10, done=todayAttempts().length,pct=clamp(done/daily*100,0,100);
  $('dailyProgressText').textContent=`${done} / ${daily}`;$('dailyProgressBar').style.width=pct+'%';
  const remaining=Math.max(daily-done,0),due=priorityReviewTerms().length,dueToday=dueTerms().length,studied=studiedTerms().length,acc=accuracy();
  $('homePlanTitle').textContent=due>0?'復習から始める':remaining>0?`今日の目標まであと${remaining}問`:'今日の目標を達成しました';
  $('homePlanText').textContent=due>0?`期限${dueToday}語と忘れかけ語を優先度順に復習しましょう。`:remaining>0?'10問単位で演習し、間違えた用語は自動で復習候補に入ります。':'余力があれば未学習語か苦手語を少し進めましょう。';
  $('homeReviewButton').textContent=due>0?`復習 ${due}語`:'復習を見る';
  $('examCountdownText').textContent=examStatus();
  $('streakValue').textContent=currentStreak()+'日';$('accuracyValue').textContent=acc===null?'—':acc+'%';
  $('studiedValue').textContent=studied;$('studiedCaption').textContent=`全${TERMS.length}語`;$('dueValue').textContent=due;
  const tasks=todayTaskItems(daily,done);$('todayTaskSummary').textContent=tasks.length?`${tasks.length}件`:'完了';$('todayTasks').innerHTML=tasks.length?tasks.map(x=>`<div class="task-item ${esc(x.kind)}"><span>${esc(x.label)}</span><small>${esc(x.meta)}</small></div>`).join(''):'<p class="empty compact">今日の目標は達成済みです。必要ならおすすめ演習で範囲を広げられます。</p>';
  const ready=readiness();$('readinessValue').textContent=ready+'%';$('readinessBar').style.width=ready+'%';
  $('homeReadinessRing').textContent=ready+'%';$('homeReadinessRing').parentElement.style.setProperty('--ring',`${ready*3.6}deg`);
  renderActivity();
  const cats=groupStats();$('homeCategoryProgress').innerHTML=cats.map(c=>{const p=Math.round(c.studied/c.terms*100);return `<div class="stack-item"><div class="stack-item-main"><strong>${esc(c.system)}</strong><small>${c.studied}/${c.terms}語・正答率 ${c.accuracy===null?'—':c.accuracy+'%'}</small><div class="mini-progress"><span style="width:${p}%"></span></div></div><b>${p}%</b></div>`;}).join('');
  const weak=TERMS.filter(t=>{const s=readTermState(t.id);return s.wrong>0||s.mastery>0;}).sort((a,b)=>termScore(b)-termScore(a)).slice(0,5);
  $('weakList').innerHTML=weak.length?weak.map(t=>stackTerm(t)).join(''):'<p class="empty">問題を解くと弱点が表示されます。</p>';
}
function renderActivity(){renderActivityChart($('activityChart'));}
function statusBadge(t){const st=reviewStatus(t);return `<span class="badge ${st.className}">${esc(st.label)}</span>`;}
function stackTerm(t){const s=readTermState(t.id);return `<button class="stack-item term-link text-button" data-term-id="${esc(t.id)}"><span class="stack-item-main"><strong>${esc(t['用語'])}</strong><small>${esc(t['系'])}・正解${s.correct}/誤答${s.wrong}・次回 ${esc(formatReviewDate(reviewDate(s)))}</small></span><b>Lv.${formatMastery(s.mastery)}</b></button>`;}

function filteredTerms(){const q=normalize($('termSearch').value),system=$('systemFilter').value,mf=$('masteryFilter').value;return TERMS.filter(t=>{const s=readTermState(t.id);if(system&&t['系']!==system)return false;if(mf==='unlearned'&&s.mastery!==0)return false;if(mf==='weak'&&!(s.wrong>0||s.mastery===1||s.mastery===2))return false;if(mf==='learned'&&s.mastery===0)return false;if(mf==='bookmarked'&&!s.bookmark)return false;if(q&&!normalize(Object.values(t).join(' ')).includes(q))return false;return true;});}
function renderTerms(){const all=filteredTerms(),show=all.slice(0,visibleTermCount);$('termCountLabel').textContent=`${all.length}語`;$('termList').innerHTML=show.length?show.map(termCard).join(''):'<div class="panel empty">該当する用語はありません。</div>';$('loadMoreTerms').classList.toggle('hidden',show.length>=all.length);bindTermLinks();}
function sourceBadge(t){return t['出典']?`<span class="badge gray">${esc(t['出典'])}</span>`:'';}
function termCard(t){const s=readTermState(t.id);return `<button class="term-card term-link" data-term-id="${esc(t.id)}"><div class="term-card-header"><div><h3>${esc(t['用語'])}</h3><small>${esc(t['系'])} › ${esc(t['中分類'])}</small></div><span class="bookmark ${s.bookmark?'active':''}">${s.bookmark?'★':'☆'}</span></div><p>${esc(t['基本解説'])}</p><div class="badges"><span class="badge gray">理解 Lv.${formatMastery(s.mastery)}</span>${statusBadge(t)}${sourceBadge(t)}${s.wrong?`<span class="badge bad">誤答 ${s.wrong}</span>`:''}</div></button>`;}
function bindTermLinks(){$$('.term-link').forEach(b=>b.onclick=()=>openTerm(b.dataset.termId));}
function openTerm(id){const t=termById.get(String(id));if(!t)return;const s=readTermState(t.id);const rel=String(t['関連語']||'').split('/').map(x=>x.trim()).filter(Boolean);$('termDialogContent').innerHTML=`<div class="dialog-head"><div><p class="eyebrow">${esc(t['系'])} / ${esc(t['中分類'])}</p><h2>${esc(t['用語'])}</h2><p class="subtle">${esc(t['英語'])}</p></div><button class="close-button" data-close-dialog type="button">×</button></div><div class="badges"><span class="badge gray">${esc(t['大分類'])}</span><span class="badge gray">${esc(t['小分類'])}</span><span class="badge gray">理解 Lv.${formatMastery(s.mastery)}</span>${sourceBadge(t)}${s.bookmark?'<span class="badge good">保存済み</span>':''}</div><section class="detail-section"><h3>短い説明</h3><p class="lead-copy">${esc(firstSentence(t['基本解説'],92))}</p></section><section class="detail-section"><h3>詳しい説明</h3><p>${esc(t['基本解説'])||'解説未登録'}</p><p class="help"><b>試験での着眼点:</b> ${esc(t['試験での着眼点'])||'—'}</p></section><section class="detail-section"><h3>関連語</h3><div class="badges">${rel.length?rel.map(r=>`<button class="badge gray related-term" data-name="${esc(r)}" type="button">${esc(r)}</button>`).join(''):'—'}</div></section><section class="detail-section"><h3>理解度</h3><div class="mastery-row">${[0,1,2,3,4,5].map(n=>`<button class="${s.mastery===n?'active':''}" data-mastery="${n}" type="button">${n}</button>`).join('')}</div><p class="help">0:未学習 / 3:説明できる / 5:他人に教えられる</p></section><section class="detail-section"><h3>自分用メモ</h3><textarea id="termNote" class="note-area" placeholder="覚え方や間違えた点を記録">${esc(s.note)}</textarea><button id="saveNoteButton" class="secondary full" type="button">メモを保存</button></section><section class="detail-section"><h3>ChatGPT用プロンプト</h3><div class="prompt-grid"><button id="copyExplainPromptButton" class="secondary" type="button">初心者向けに説明</button><button id="copyMistakePromptButton" class="secondary" type="button">間違えた理由を分析</button><button id="copyRelatedQuestionsButton" class="secondary" type="button">関連問題を3問作成</button><button id="copyTodayWeakButton" class="secondary" type="button">今日の弱点を整理</button></div><p class="help">用語名、分野、誤答回数など最小限の情報だけを使います。</p></section><div class="dialog-actions"><button id="bookmarkButton" class="secondary" type="button">${s.bookmark?'★ 保存解除':'☆ 保存'}</button></div>`;
  const dialog=$('termDialog');if(!dialog.open)dialog.showModal();
  qs('[data-close-dialog]').onclick=()=>dialog.close();
  $$('[data-mastery]').forEach(b=>b.onclick=()=>{setMastery(t.id,Number(b.dataset.mastery));openTerm(t.id);});
  $$('.related-term').forEach(b=>b.onclick=()=>{const x=termByName.get(normalize(b.dataset.name));if(x)openTerm(x.id);else showToast('関連語の詳細は見つかりませんでした');});
  $('saveNoteButton').onclick=()=>{const writable=getTermState(t.id);writable.note=$('termNote').value.trim();saveState(false);showToast('メモを保存しました');};
  $('bookmarkButton').onclick=()=>{const writable=getTermState(t.id);writable.bookmark=!writable.bookmark;saveState(false);openTerm(t.id);};
  $('copyExplainPromptButton').onclick=()=>copyTermPrompt(t,'explain');
  $('copyMistakePromptButton').onclick=()=>copyTermPrompt(t,'mistake');
  $('copyRelatedQuestionsButton').onclick=()=>copyTermPrompt(t,'questions');
  $('copyTodayWeakButton').onclick=copyWeakPrompt;
}
function setMastery(id,n){const s=getTermState(id),today=localDate();s.mastery=n;s.last=today;s.learnedAt=s.learnedAt||today;s.updatedAt=today;s.due=n===0?null:addDays(today,[0,1,2,4,7,14][n]);s.nextReview=s.due;s.reviewPriority=termById.has(String(id))?reviewPriority(termById.get(String(id))):0;saveState(false);renderAll();}

const relationLabels={prerequisite:'前提',related:'関連',comparison:'比較',derived:'派生',included:'包含'};
function knowledgeSearchText(term,svc){const connected=svc.getConnectedTerms(term.id).map(x=>x.name).join(' '),app=term.appTerm||{};return normalize([term.name,term.shortDescription,term.detailedDescription,term.example,term.aliases?.join(' '),connected,app['基本解説'],app['関連語']].join(' '));}
function knowledgeTermVisible(term,svc){const q=normalize($('knowledgeSearch').value),status=$('knowledgeStatusFilter').value,progress=svc.progressForTerm(term.id);if(status&&progress.status!==status)return false;if(q&&!knowledgeSearchText(term,svc).includes(q))return false;return true;}
function knowledgeFilterActive(){return Boolean(normalize($('knowledgeSearch').value)||$('knowledgeStatusFilter').value);}
function ensureKnowledgeDefaults(svc){
  if(knowledgeMapDefaultsApplied)return;
  ['cat-computer-elements'].forEach(id=>{if(svc.getCategory(id))knowledgeExpandedCategories.add(id);});
  knowledgeMapDefaultsApplied=true;
}
function expandKnowledgeCategoryPath(categoryId,svc){svc.getCategoryPath(categoryId).forEach(category=>knowledgeExpandedCategories.add(category.id));}
function syncKnowledgeMapMode(){
  const overviewMode=knowledgeMapMode!=='tree';
  $$('[data-map-mode]').forEach(button=>{
    const active=(button.dataset.mapMode||'overview')===knowledgeMapMode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',active?'true':'false');
  });
  qs('.map-controls')?.classList.toggle('hidden',overviewMode);
  qs('.map-layout')?.classList.toggle('hidden',overviewMode);
}
function renderKnowledgeMap(){
  const svc=getKnowledgeService();
  if(!svc){$('knowledgeMapTree').innerHTML='<div class="empty">知識マップデータを読み込めませんでした。</div>';return;}
  ensureKnowledgeDefaults(svc);
  syncKnowledgeMapMode();
  const summary=svc.mapSummary(),counts=summary.statusCounts;
  $('knowledgeMapCount').textContent=`${summary.termCount}語 / ${summary.categoryCount}カテゴリ / ${summary.relationCount}関係`;
  $('mapMasteryValue').textContent=summary.masteryScore+'%';
  $('mapReviewValue').textContent=counts.review;
  $('mapWeakValue').textContent=counts.weak;
  $('mapMasteredValue').textContent=counts.mastered;
  renderKnowledgeRecommendation(svc);
  renderKnowledgeOverview(svc,summary);
  if(knowledgeMapMode!=='tree'){
    $('knowledgeMapTree').innerHTML='';
    bindKnowledgeMapActions();
    return;
  }
  const html=svc.getSubjectTree().map(node=>renderKnowledgeSubject(node.subject,node.categories,svc)).join('');
  $('knowledgeMapTree').innerHTML=html||'<div class="empty">条件に合うノードはありません。</div>';
  bindKnowledgeMapActions();
  if(selectedKnowledgeTermId)renderKnowledgeDetail(selectedKnowledgeTermId);
}
function renderKnowledgeRecommendation(svc){
  const rec=svc.recommendNext(1)[0];
  $('mapRecommendation').innerHTML=rec?`<button class="map-recommendation-card stack-item text-button" data-map-term-id="${esc(rec.term.id)}" type="button"><span class="stack-item-main"><strong>${esc(rec.term.name)}</strong><small>${esc(rec.reason)}・習熟度 ${rec.progress.masteryScore}%</small></span><span class="knowledge-node-marker">${esc(rec.progress.statusMarker)}</span></button>`:'<p class="empty compact">推薦できる用語はまだありません。</p>';
}
function renderKnowledgeSubject(subject,categories,svc){
  const children=categories.map(category=>renderKnowledgeCategory(category,svc,0)).filter(Boolean).join('');
  if(!children)return '';
  const progress=svc.subjectProgress(subject.id),counts=progress.statusCounts;
  return `<div class="knowledge-subject" role="group"><div class="knowledge-subject-title"><span><strong>${esc(subject.name)}</strong><small>${progress.termCount}語・平均 ${progress.masteryScore}%・苦手 ${counts.weak}</small></span><small>${esc(subject.description)}</small></div>${children}</div>`;
}
function renderKnowledgeCategory(category,svc,depth=0){
  const filtered=knowledgeFilterActive();
  const childHtml=svc.getChildCategories(category.id).map(child=>renderKnowledgeCategory(child,svc,depth+1)).filter(Boolean).join('');
  const visibleTerms=svc.getTermsByCategory(category.id).filter(term=>knowledgeTermVisible(term,svc));
  if(!childHtml&&!visibleTerms.length)return '';
  const open=filtered||knowledgeExpandedCategories.has(category.id);
  const progress=svc.categoryProgress(category.id);
  const counts=progress.statusCounts,limit=knowledgeCategoryLimits.get(category.id)||(filtered?100:48),shownTerms=visibleTerms.slice(0,limit),remaining=visibleTerms.length-shownTerms.length;
  const termHtml=shownTerms.map(term=>renderKnowledgeNode(term,svc)).join('');
  return `<section class="knowledge-category" data-depth="${depth}"><button class="knowledge-category-toggle" data-map-category-id="${esc(category.id)}" type="button" aria-expanded="${open?'true':'false'}"><span><strong>${esc(category.name)}</strong><small>${progress.termCount}語・平均 ${progress.masteryScore}%・要復習 ${counts.review}・苦手 ${counts.weak}</small></span><b aria-hidden="true">${open?'−':'+'}</b></button>${open?`<div class="knowledge-children">${childHtml}${termHtml?`<div class="knowledge-term-list">${termHtml}</div>`:''}${remaining>0?`<button class="secondary full compact" data-map-load-category="${esc(category.id)}" type="button">このカテゴリをさらに${Math.min(48,remaining)}語表示（残り${remaining}語）</button>`:''}</div>`:''}</section>`;
}
function renderKnowledgeNode(term,svc){
  const progress=svc.progressForTerm(term.id),selected=selectedKnowledgeTermId===term.id?' selected':'',appMissing=term.appTermId?'':'・未接続';
  return `<button class="knowledge-node state-${esc(progress.status)}${selected}" data-map-term-id="${esc(term.id)}" type="button" role="treeitem" aria-label="${esc(term.name)} ${esc(progress.statusLabel)} 習熟度${progress.masteryScore}%"><span class="knowledge-node-marker" aria-hidden="true">${esc(progress.statusMarker)}</span><span class="knowledge-node-title"><strong>${esc(term.name)}</strong><small>${esc(progress.statusLabel)}${appMissing}・重要${term.importance}/難度${term.difficulty}</small></span><span class="knowledge-node-score">${progress.masteryScore}%</span></button>`;
}
function renderKnowledgeOverview(svc,summary){
  const panel=$('knowledgeOverviewPanel');
  if(!panel)return;
  panel.classList.toggle('hidden',knowledgeMapMode!=='overview');
  if(knowledgeMapMode!=='overview')return;
  const tree=svc.getSubjectTree();
  const subjects=svc.subjects.slice().sort((a,b)=>a.displayOrder-b.displayOrder);
  panel.innerHTML=`<div class="overview-head"><div><p class="eyebrow">Overview</p><h3>全体図</h3><p class="help">基本情報技術者の用語を、分野と大分類ごとの進み具合で整理しています。</p></div><strong>${summary.termCount}語</strong></div><div class="knowledge-overview-grid">${subjects.map(subject=>{const p=svc.subjectProgress(subject.id),c=p.statusCounts;return `<article class="overview-card"><span>${esc(subject.name)}</span><strong>${p.masteryScore}%</strong><div class="progress-track"><span style="width:${p.masteryScore}%"></span></div><small>${p.termCount}語・未学習 ${c.unlearned}・苦手 ${c.weak}・習得 ${c.mastered}</small></article>`;}).join('')}</div><div class="overview-subject-list">${tree.map(node=>{const subjectProgress=svc.subjectProgress(node.subject.id);return `<section class="overview-subject-section"><div class="overview-subject-heading"><div><h3>${esc(node.subject.name)}</h3><small>${subjectProgress.termCount}語・平均 ${subjectProgress.masteryScore}%</small></div><b>${subjectProgress.masteryScore}%</b></div><div class="overview-category-grid">${node.categories.map(category=>{const p=svc.categoryProgress(category.id),c=p.statusCounts;return `<button class="overview-category text-button" data-map-overview-category="${esc(category.id)}" type="button"><span><strong>${esc(category.name)}</strong><small>${p.termCount}語・要復習 ${c.review}・苦手 ${c.weak}</small></span><b>${p.masteryScore}%</b></button>`;}).join('')}</div></section>`;}).join('')}</div>`;
}
function bindKnowledgeMapActions(){
  $$('[data-map-term-id]').forEach(button=>{button.onclick=()=>{knowledgeMapMode='tree';selectedKnowledgeTermId=button.dataset.mapTermId;const svc=getKnowledgeService(),term=svc?.getTerm(selectedKnowledgeTermId);if(term)expandKnowledgeCategoryPath(term.categoryId,svc);renderKnowledgeMap();renderKnowledgeDetail(selectedKnowledgeTermId);};button.ondblclick=()=>startKnowledgeTermStudy(button.dataset.mapTermId);});
  $$('[data-map-category-id]').forEach(button=>button.onclick=()=>{const id=button.dataset.mapCategoryId;if(knowledgeExpandedCategories.has(id))knowledgeExpandedCategories.delete(id);else knowledgeExpandedCategories.add(id);renderKnowledgeMap();});
  $$('[data-map-load-category]').forEach(button=>button.onclick=()=>{const id=button.dataset.mapLoadCategory;knowledgeCategoryLimits.set(id,(knowledgeCategoryLimits.get(id)||48)+48);knowledgeExpandedCategories.add(id);renderKnowledgeMap();});
  $$('[data-map-overview-category]').forEach(button=>button.onclick=()=>{const svc=getKnowledgeService(),id=button.dataset.mapOverviewCategory;knowledgeMapMode='tree';expandKnowledgeCategoryPath(id,svc);renderKnowledgeMap();setTimeout(()=>qs(`[data-map-category-id="${CSS.escape(id)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);});
}
function renderKnowledgeDetail(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const progress=svc.progressForTerm(term.id),prereq=svc.getPrerequisites(term.id),connected=svc.getConnectedTerms(term.id).filter(x=>!prereq.some(p=>p.id===x.id)),reasons=svc.weakReasons(term.id),relations=svc.getRelations(term.id);
  $('knowledgeDetailPanel').innerHTML=`<div class="map-detail-head"><div><p class="eyebrow">${esc((term.appTerm||{})['系']||'テクノロジ系')} / ${esc((term.appTerm||{})['中分類']||'知識マップ')}</p><h3>${esc(term.name)}</h3><p class="subtle">${esc(progress.statusLabel)}・重要度${term.importance}・難易度${term.difficulty}</p></div><div class="map-detail-score"><strong>${progress.masteryScore}%</strong><small>習熟度</small></div></div><div class="progress-track"><span style="width:${progress.masteryScore}%"></span></div><div class="badges"><span class="badge gray">${esc(progress.statusMarker)} ${esc(progress.statusLabel)}</span><span class="badge gray">正解 ${formatProgressCount(progress.correctAttempts)}</span><span class="badge gray">誤答 ${formatProgressCount(progress.wrongAttempts)}</span>${progress.nextReviewAt?`<span class="badge ${progress.nextReviewAt<=localDate()?'bad':'gray'}">次回 ${esc(formatReviewDate(progress.nextReviewAt))}</span>`:''}</div><section class="map-detail-section"><h4>短い説明</h4><p class="lead-copy">${esc(term.shortDescription)}</p></section><section class="map-detail-section"><h4>詳しい説明</h4><p>${esc(term.detailedDescription)}</p><p class="help"><b>具体例:</b> ${esc(term.example)}</p></section><section class="map-detail-section"><h4>前提用語</h4><div class="map-relation-list">${prereq.length?prereq.map(x=>relationTermButton(x,svc)).join(''):'<span class="subtle">前提はありません。</span>'}</div></section><section class="map-detail-section"><h4>関連用語</h4><div class="map-relation-list">${connected.length?connected.slice(0,12).map(x=>relationTermButton(x,svc)).join(''):'<span class="subtle">関連語はまだ登録されていません。</span>'}</div></section><section class="map-detail-section"><h4>苦手理由</h4><p class="help">${reasons.length?esc(reasons.join('、')):'現在は明確な苦手理由はありません。'}</p></section><section class="map-detail-section"><h4>関係タイプ</h4><div class="badges">${relations.length?relations.map(r=>`<span class="badge gray">${esc(relationLabels[r.relationType]||r.relationType)}: ${esc(svc.getTerm(r.targetTermId)?.name||r.targetTermId)}</span>`).join(''):'<span class="badge gray">登録なし</span>'}</div></section><div class="dialog-actions"><button id="mapStudyButton" class="secondary" type="button" ${term.appTermId?'':'disabled'}>この用語を学習する</button><button id="mapPracticeButton" class="primary" type="button" ${term.appTermId?'':'disabled'}>確認問題を解く</button><button id="mapRelatedPracticeButton" class="secondary" type="button">関連語も練習</button></div>`;
  $$('.map-related-term').forEach(button=>button.onclick=()=>{selectedKnowledgeTermId=button.dataset.mapTermId;renderKnowledgeMap();renderKnowledgeDetail(button.dataset.mapTermId);});
  $('mapStudyButton').onclick=()=>startKnowledgeTermStudy(term.id);
  $('mapPracticeButton').onclick=()=>startKnowledgeTermPractice(term.id,false);
  $('mapRelatedPracticeButton').onclick=()=>startKnowledgeTermPractice(term.id,true);
}
function relationTermButton(term,svc){const p=svc.progressForTerm(term.id);return `<button class="badge gray map-related-term" data-map-term-id="${esc(term.id)}" type="button">${esc(p.statusMarker)} ${esc(term.name)}</button>`;}
function startKnowledgeTermStudy(termId){const term=getKnowledgeService()?.getTerm(termId);if(!term||!term.appTermId){showToast('既存の用語データに接続されていません');return;}openTerm(term.appTermId);}
function startKnowledgeTermPractice(termId,includeRelated=false){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const candidates=includeRelated?[term,...svc.getConnectedTerms(term.id)]:[term],seen=new Set(),appTerms=[];
  candidates.forEach(item=>{if(item.appTerm&&!seen.has(String(item.appTerm.id))){seen.add(String(item.appTerm.id));appTerms.push(item.appTerm);}});
  if(!appTerms.length){showToast('このノードに対応する問題を作れません');return;}
  navTo('quiz');$('quizSource').value='terms';$('quizMode').value='recommended';$('quizType').value='mixed';
  const selected=appTerms.slice(0,Math.min(8,appTerms.length));
  quiz={source:'terms',mode:'knowledge',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(t=>makeQuestion(t,'mixed')),results:[],startedAt:Date.now()};
  $('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();
}

function selectPool(mode,system,length=10){let pool=TERMS.filter(t=>!system||t['系']===system);if(mode==='recommended')return recommendedTerms(length,system);if(mode==='due'){pool=priorityReviewTerms(system);}else if(mode==='unlearned'){const u=pool.filter(t=>readTermState(t.id).mastery===0);if(u.length>=4)pool=u;}else if(mode==='weak'){pool=pool.sort((a,b)=>termScore(b)-termScore(a)).slice(0,Math.max(30,Math.ceil(pool.length*.25)));}return pool.length?pool:TERMS.filter(t=>!system||t['系']===system);}
function subjectPool(mode,system,length=10){let pool=SUBJECT_A.filter(q=>!system||q.system===system);if(mode==='weak'){const weak=pool.filter(q=>getSubjectState(q.id).wrong>0).sort((a,b)=>getSubjectState(b.id).wrong-getSubjectState(a.id).wrong);if(weak.length)pool=weak;}else if(mode==='unlearned'){const fresh=pool.filter(q=>getSubjectState(q.id).correct+getSubjectState(q.id).wrong===0);if(fresh.length)pool=fresh;}else if(mode==='mock'){return sample(pool,Math.min(Math.max(length,20),pool.length));}else if(mode==='recommended'||mode==='due'){const weak=pool.filter(q=>getSubjectState(q.id).wrong>0).sort((a,b)=>getSubjectState(b.id).wrong-getSubjectState(a.id).wrong),fresh=pool.filter(q=>getSubjectState(q.id).correct+getSubjectState(q.id).wrong===0),seen=new Set(),result=[];[weak,fresh,sample(pool,length)].forEach(group=>group.forEach(q=>{if(result.length<length&&!seen.has(q.id)){seen.add(q.id);result.push(q);}}));return result;}return sample(pool,Math.min(length,pool.length));}
function sample(arr,n){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,n);}
function startQuiz(overrides={}){const source=overrides.source||$('quizSource').value,mode=overrides.mode||$('quizMode').value,system=overrides.system??$('quizSystem').value,length=Number(overrides.length||$('quizLength').value);let type=overrides.type||$('quizType').value;if(source==='subjectA')return startSubjectQuiz({mode,system,length,type});if(type==='mock')type='mixed';const pool=selectPool(mode,system,length);const chosen=mode==='recommended'?pool.slice(0,Math.min(length,pool.length)):sample(pool,Math.min(length,pool.length));quiz={source:'terms',mode,system,type,length:chosen.length,index:0,correct:0,answered:false,items:chosen.map(t=>makeQuestion(t,type)),results:[],startedAt:Date.now()};$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();}
function startSubjectQuiz({mode='random',system='',length=10,type='mixed'}={}){const actualMode=type==='mock'?'mock':mode,pool=subjectPool(actualMode,system,length);if(!pool.length){showToast('科目Aの問題がありません');return;}quiz={source:'subjectA',mode:actualMode,system,type,length:pool.length,index:0,correct:0,answered:false,items:pool.map(makeSubjectQuestion),results:[],startedAt:Date.now()};$('quizSource').value='subjectA';$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();}
function distractorsFor(target){let pool=TERMS.filter(t=>t.id!==target.id&&t['中分類']&&t['中分類']===target['中分類']);if(pool.length<3)pool=TERMS.filter(t=>t.id!==target.id&&t['大分類']===target['大分類']);if(pool.length<3)pool=TERMS.filter(t=>t.id!==target.id&&t['系']===target['系']);return sample(pool,3);}
function makeQuestion(target,type){let qtype=type==='mixed'?(Math.random()<.5?'description':'term'):type;const ds=distractorsFor(target);if(qtype==='term')return {target,qtype,prompt:`「${target['用語']}」の説明として最も適切なものはどれですか。`,options:sample([target,...ds],4).map(t=>({id:t.id,label:t['基本解説']||`${t['用語']}に関する概念`}))};return {target,qtype,prompt:target['基本解説']||target['試験での着眼点'],options:sample([target,...ds],4).map(t=>({id:t.id,label:t['用語']}))};}
function makeSubjectQuestion(q){return {source:'subjectA',target:q,qtype:'subjectA',prompt:q.question,options:q.choices.map((label,i)=>({id:String(i),label}))};}
function renderQuizQuestion(){if(!quiz)return;if(quiz.index>=quiz.items.length){finishQuiz();return;}const q=quiz.items[quiz.index],metaSystem=q.source==='subjectA'?q.target.system:q.target['系'],metaCategory=q.source==='subjectA'?q.target.category:q.target['中分類'];quiz.answered=false;$('quizSessionStatus').textContent=`${quiz.index+1} / ${quiz.length}`;$('quizArea').innerHTML=`<article class="quiz-card"><div class="quiz-meta"><span>${esc(metaSystem)} › ${esc(metaCategory)}</span><span>${quiz.index+1}/${quiz.length}</span></div><div class="progress-track" style="margin-top:10px"><span style="width:${quiz.index/quiz.length*100}%"></span></div><p class="quiz-question">${esc(q.prompt)}</p><div class="option-list">${q.options.map((o,i)=>`<button class="option" data-answer-id="${esc(o.id)}" type="button"><span>${String.fromCharCode(65+i)}.</span> ${esc(o.label)}</button>`).join('')}</div><div id="quizFeedback"></div></article>`;$$('[data-answer-id]').forEach(b=>b.onclick=()=>answerQuestion(b.dataset.answerId,b));}
function answerExplanation(q,id,correct){const selected=termById.get(String(id));const target=q.target;const reason=target['試験での着眼点']||target['基本解説']||'定義と使いどころを確認しましょう。';const selectedText=selected&&String(selected.id)!==String(target.id)?`<div class="explanation-block"><h4>選んだ選択肢との違い</h4><p>選んだ「${esc(selected['用語'])}」は「${esc(firstSentence(selected['基本解説'],96))}」です。正解の「${esc(target['用語'])}」とは、問われている対象・目的・使いどころが異なります。</p></div>`:`<div class="explanation-block"><h4>見分けポイント</h4><p>近い用語が選択肢に並ぶため、説明文の主語、目的、使われる場面を先に確認すると判断しやすくなります。</p></div>`;return `<div class="explanation-block"><h4>正解理由</h4><p><b>${esc(target['用語'])}</b> は ${esc(firstSentence(target['基本解説'],120))}</p><p>${esc(reason)}</p></div>${selectedText}`;}
function answerSubjectQuestion(id,button){
  if(!quiz||quiz.answered)return;
  quiz.answered=true;
  const q=quiz.items[quiz.index],target=q.target,correct=Number(id)===Number(target.answer),today=localDate(),s=getSubjectState(target.id);
  if(correct){quiz.correct++;s.correct++;s.lastCorrect=today;}else{s.wrong++;s.lastWrong=today;}
  s.last=today;
  state.subjectA.attempts.push({id:target.id,correct,date:today,ts:Date.now(),mode:quiz.mode,system:target.system,category:target.category});
  quiz.results.push({id:target.id,correct,source:'subjectA',system:target.system});
  const linkedTerms=applySubjectQuestionTermProgress(target.id,correct);
  $$('[data-answer-id]').forEach(b=>{b.disabled=true;if(Number(b.dataset.answerId)===Number(target.answer))b.classList.add('correct');});
  if(!correct)button.classList.add('wrong');
  saveState(false);
  const linkedHtml=linkedTerms.length?`<div class="explanation-block"><h4>知識マップ反映</h4><p>${linkedTerms.map(t=>esc(t.name)).join('、')} の習熟度と復習予定を更新しました。</p></div>`:'';
  $('quizFeedback').innerHTML=`<div class="explanation"><strong>${correct?'正解':'不正解'}</strong><p><b>正解：</b>${esc(target.choices[target.answer])}</p><div class="explanation-block"><h4>解説</h4><p>${esc(target.explanation)}</p></div><div class="explanation-block"><h4>関連語</h4><div class="badges">${target.relatedTerms.map(x=>`<span class="badge gray">${esc(x)}</span>`).join('')}</div></div>${linkedHtml}<div class="quiz-actions"><button id="nextQuestionButton" class="primary" type="button">${quiz.index+1>=quiz.length?'結果を見る':'次の問題'}</button></div></div>`;
  $('nextQuestionButton').onclick=()=>{quiz.index++;renderQuizQuestion();};
}
function answerQuestion(id,button){
  if(!quiz||quiz.answered)return;
  const q=quiz.items[quiz.index];
  if(q.source==='subjectA')return answerSubjectQuestion(id,button);
  quiz.answered=true;
  const correct=String(id)===String(q.target.id),today=localDate();
  if(correct)quiz.correct++;
  const s=getTermState(q.target.id);
  s.last=today;s.learnedAt=s.learnedAt||today;s.updatedAt=today;
  if(correct){s.correct++;s.streak++;s.consecutiveIncorrect=0;s.lastCorrect=today;s.mastery=Math.max(s.mastery,2);}
  else{s.wrong++;s.streak=0;s.consecutiveIncorrect=Number(s.consecutiveIncorrect||0)+1;s.lastWrong=today;s.mastery=Math.min(Math.max(s.mastery,1),2);}
  state.attempts.push({id:String(q.target.id),correct,date:today,ts:Date.now(),mode:quiz.mode,type:q.qtype,system:q.target['系']});
  quiz.results.push({id:q.target.id,correct,source:'terms',system:q.target['系']});
  $$('[data-answer-id]').forEach(b=>{b.disabled=true;if(String(b.dataset.answerId)===String(q.target.id))b.classList.add('correct');});
  if(!correct)button.classList.add('wrong');
  scheduleReview(q.target.id,correct?4:1);
  const linkedTerms=applyKnowledgeRelatedProgress(q.target.id,correct,String(q.target.id));
  saveState(false);
  const linkedHtml=linkedTerms.length?`<div class="explanation-block"><h4>知識マップ反映</h4><p>関連・前提用語 ${linkedTerms.map(t=>esc(t.name)).join('、')} にも小さく反映しました。</p></div>`:'';
  $('quizFeedback').innerHTML=`<div class="explanation"><strong>${correct?'正解':'不正解'}</strong><p><b>正解：</b>${esc(q.target['用語'])}</p>${answerExplanation(q,id,correct)}${linkedHtml}<div class="rating-row"><button data-rating="1">もう一度</button><button data-rating="3">難しい</button><button data-rating="4">理解</button><button data-rating="5">簡単</button></div><div class="quiz-actions"><button id="nextQuestionButton" class="primary" type="button">${quiz.index+1>=quiz.length?'結果を見る':'次の問題'}</button></div></div>`;
  $$('[data-rating]').forEach(b=>b.onclick=()=>{scheduleReview(q.target.id,Number(b.dataset.rating));saveState(false);$$('[data-rating]').forEach(x=>x.disabled=true);showToast('復習間隔を更新しました');});
  $('nextQuestionButton').onclick=()=>{quiz.index++;renderQuizQuestion();};
}
function scheduleReview(id,quality){const s=getTermState(id),today=localDate();s.updatedAt=today;if(quality<3){s.repetitions=0;s.interval=1;s.ease=Math.max(1.3,s.ease-.2);s.due=addDays(today,1);s.nextReview=s.due;s.reviewPriority=termById.has(String(id))?reviewPriority(termById.get(String(id))):0;return;}s.repetitions=(s.repetitions||0)+1;if(s.repetitions===1)s.interval=1;else if(s.repetitions===2)s.interval=3;else s.interval=Math.max(1,Math.round((s.interval||3)*(s.ease||2.5)));s.ease=Math.max(1.3,(s.ease||2.5)+(0.1-(5-quality)*(0.08+(5-quality)*0.02)));s.due=addDays(today,s.interval);s.nextReview=s.due;s.mastery=clamp(Math.max(s.mastery,quality===5?4:3),0,5);s.reviewPriority=termById.has(String(id))?reviewPriority(termById.get(String(id))):0;}
function finishQuiz(){const pct=Math.round(quiz.correct/quiz.length*100),wrong=quiz.length-quiz.correct,duration=Math.round((Date.now()-quiz.startedAt)/1000),weak=quizWeakSystems(quiz.results),session={date:localDate(),ts:Date.now(),source:quiz.source,mode:quiz.mode,total:quiz.length,correct:quiz.correct,durationSec:duration};if(quiz.source==='subjectA')state.subjectA.sessions.push(session);else state.sessions.push(session);saveState(false);$('quizArea').classList.add('hidden');$('quizSetup').classList.remove('hidden');$('quizSessionStatus').textContent='';$('resultDialogContent').innerHTML=`<div class="dialog-head"><div><p class="eyebrow">Session complete</p><h2>演習結果</h2></div><button class="close-button" data-close-result type="button">×</button></div><div class="result-score"><strong>${pct}%</strong><span>${quiz.correct} / ${quiz.length}問正解</span></div><div class="result-breakdown"><div><strong>${quiz.correct}</strong><small>正解</small></div><div><strong>${wrong}</strong><small>誤答</small></div><div><strong>${duration}秒</strong><small>所要時間</small></div></div><section class="result-insight"><h3>次のおすすめ</h3><p>${esc(nextActionText(pct,wrong))}</p><p class="help"><b>苦手分野:</b> ${weak.length?'誤答が出た分野を優先して復習しましょう。':'今回の結果では大きな偏りはありません。'}</p><div class="badges">${weak.length?weak.map(([system,count])=>`<span class="badge bad">${esc(system)} ${count}問</span>`).join(''):'<span class="badge good">大きな苦手分野なし</span>'}</div></section><div class="dialog-actions"><button id="retryWeakButton" class="secondary" type="button" ${wrong?'':'disabled'}>間違えた問題を復習</button><button id="nextRecommendedButton" class="primary" type="button">おすすめ演習へ</button></div>`;const d=$('resultDialog'),source=quiz.source;d.showModal();qs('[data-close-result]').onclick=()=>{d.close();renderAll();};$('retryWeakButton').onclick=()=>{const ids=new Set(quiz.results.filter(r=>!r.correct).map(r=>String(r.id)));d.close();if(!ids.size){showToast('間違えた問題はありません');return;}if(source==='subjectA'){const selected=SUBJECT_A.filter(q=>ids.has(String(q.id)));quiz={source:'subjectA',mode:'retry',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(makeSubjectQuestion),results:[],startedAt:Date.now()};}else{const selected=TERMS.filter(t=>ids.has(String(t.id)));quiz={source:'terms',mode:'retry',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(t=>makeQuestion(t,'mixed')),results:[],startedAt:Date.now()};}$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();};$('nextRecommendedButton').onclick=()=>{d.close();if(source==='subjectA'){startQuiz({source:'subjectA',mode:'recommended',length:10});return;}$('quizSource').value='terms';$('quizMode').value='recommended';startQuiz({source:'terms',mode:'recommended',length:10});};renderAll();}

function reviewCard(t){const s=readTermState(t.id),priority=reviewPriority(t),status=reviewStatus(t);return `<button class="stack-item review-card term-link text-button" data-term-id="${esc(t.id)}"><span class="stack-item-main"><strong>${esc(t['用語'])}</strong><small>${esc(status.label)}・次回 ${esc(formatReviewDate(reviewDate(s)))}・誤答${s.wrong}・連続正解${s.streak}</small><span class="badges">${statusBadge(t)}<span class="badge gray">Lv.${formatMastery(s.mastery)}</span></span></span><span class="review-priority"><b>${priority}</b><small>優先度</small></span></button>`;}
function reviewTerms(){if(reviewFilter==='wrong')return TERMS.filter(t=>readTermState(t.id).wrong>0).sort((a,b)=>reviewPriority(b)-reviewPriority(a)||readTermState(b.id).wrong-readTermState(a.id).wrong);if(reviewFilter==='bookmark')return TERMS.filter(t=>readTermState(t.id).bookmark).sort((a,b)=>reviewPriority(b)-reviewPriority(a));return priorityReviewTerms();}
function renderReview(){const list=reviewTerms(),queue=priorityReviewTerms(),top=queue[0];$('reviewCountLabel').textContent=`${list.length}語`;$('reviewHeroCount').textContent=`${queue.length}語`;$('nextReviewDate').textContent=formatReviewDate(nextReviewDate());$('reviewTopPriority').textContent=top?reviewPriority(top):'—';$('startReviewButton').disabled=queue.length===0;$('reviewList').innerHTML=list.length?list.slice(0,100).map(reviewCard).join(''):'<div class="panel empty">現在の対象はありません。</div>';bindTermLinks();}
function statusSegment(label,count,total,kind){const raw=total?count/total*100:0,pct=Math.round(raw),width=count?Math.max(2,pct):0,display=count&&pct===0?'&lt;1%':pct+'%';return `<div class="status-segment ${esc(kind)}"><div><strong>${esc(label)}</strong><span>${count}語 / ${display}</span></div><div class="progress-track"><span style="width:${width}%"></span></div></div>`;}
function renderProgress(){const total=state.attempts.length,c=state.attempts.filter(a=>a.correct).length,ready=readiness();$('totalAnswersValue').textContent=total;$('totalCorrectValue').textContent=c;$('studyDaysValue').textContent=daysWithActivity().length;$('bestStreakValue').textContent=bestStreak()+'日';$('progressReadinessValue').textContent=ready+'%';$('progressReadinessBar').style.width=ready+'%';$('studyAdviceText').textContent=`参考値です。${studyAdvice()}`;const status=learningStatusCounts(),termTotal=TERMS.length;$('learningStatusSummary').innerHTML=[statusSegment('未学習',status.unlearned,termTotal,'unlearned'),statusSegment('学習中',status.learning,termTotal,'learning'),statusSegment('習得済み',status.mastered,termTotal,'mastered')].join('');const days=renderActivityChart($('progressActivityChart')),sum=days.reduce((a,b)=>a+b.count,0),active=days.filter(x=>x.count>0).length;$('progressActivitySummary').textContent=`14日間で${sum}問、学習日は${active}日です。`;const weakSystems=weakSystemStats().filter(x=>x.attempts>0||x.studied>0).slice(0,3);$('weakAreaSummary').innerHTML=weakSystems.length?weakSystems.map(x=>`<div class="stack-item"><span class="stack-item-main"><strong>${esc(x.system)}</strong><small>正答率 ${x.accuracy===null?'—':x.accuracy+'%'}・誤答 ${x.wrong}・学習済み ${x.studied}/${x.terms}語</small></span><b>${Math.round(x.weakScore)}</b></div>`).join(''):'<p class="empty">まだ苦手分野を判定できる履歴がありません。</p>';$('categoryAnalytics').innerHTML=groupStats().map(x=>`<div class="analytics-row"><strong>${esc(x.system)}</strong><div class="progress-track"><span style="width:${x.accuracy??0}%"></span></div><span>${x.accuracy===null?'—':x.accuracy+'%'}</span><small>${x.correct}/${x.attempts}問正解・${x.studied}/${x.terms}語学習</small></div>`).join('');const rank=TERMS.filter(t=>readTermState(t.id).wrong>0).sort((a,b)=>readTermState(b.id).wrong-readTermState(a.id).wrong||reviewPriority(b)-reviewPriority(a)).slice(0,10);$('mistakeRanking').innerHTML=rank.length?rank.map(stackTerm).join(''):'<p class="empty">誤答履歴はありません。</p>';bindTermLinks();}
function renderSettings(){$('dailyGoalInput').value=state.settings.dailyGoal||10;$('examDateInput').value=state.settings.examDate||'';$('themeInput').value=state.settings.theme||'system';}
function saveSettings(){state.settings.dailyGoal=clamp(Number($('dailyGoalInput').value)||10,1,100);state.settings.examDate=$('examDateInput').value;state.settings.theme=$('themeInput').value;saveState();showToast('設定を保存しました');}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`FE_Learning_OS_backup_${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function importData(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const x=JSON.parse(reader.result);if(!x||x.version!==2)throw new Error();state=migrateState(Object.assign(defaultState(),x,{settings:Object.assign(defaultState().settings,x.settings||{})}),x.schemaVersion);saveState();showToast('バックアップを読み込みました');}catch(err){alert('このバックアップファイルは読み込めません。');}};reader.readAsText(file);e.target.value='';}
function resetData(){if(confirm('学習履歴・メモ・設定をすべて削除しますか？')){localStorage.removeItem(STORAGE_KEY);state=defaultState();saveState();showToast('学習データを削除しました');}}
function copyText(text,msg='コピーしました'){if(navigator.clipboard&&location.protocol!=='file:')navigator.clipboard.writeText(text).then(()=>showToast(msg)).catch(()=>fallbackCopy(text,msg));else fallbackCopy(text,msg);}
function fallbackCopy(text,msg){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast(msg);}
function compactWeakSummary(limit=5){const today=localDate(),todayWrong=state.attempts.filter(a=>a.date===today&&!a.correct).map(a=>termById.get(String(a.id))).filter(Boolean),weak=TERMS.filter(t=>readTermState(t.id).wrong>0).sort((a,b)=>readTermState(b.id).wrong-readTermState(a.id).wrong);const merged=[],seen=new Set();[todayWrong,weak].forEach(group=>group.forEach(t=>{if(merged.length<limit&&!seen.has(String(t.id))){seen.add(String(t.id));merged.push(t);}}));return merged.length?merged.map(t=>`${t['用語']}（${t['系']}、誤答${readTermState(t.id).wrong}回）`).join('、'):'まだ誤答データなし';}
function copyTermPrompt(t,kind){const s=readTermState(t.id),base=`基本情報技術者試験の用語「${t['用語']}」（${t['系']} / ${t['中分類']}）について。`;const rel=String(t['関連語']||'').split('/').map(x=>x.trim()).filter(Boolean).slice(0,5).join('、')||'関連語なし';const prompts={explain:`${base}初心者向けに、1. 一言での定義 2. 具体例 3. 試験で問われるポイント 4. 関連語との違い、の順で説明してください。関連語: ${rel}。`,mistake:`${base}私はこの用語で誤答が${s.wrong}回あります。よくある勘違いを3つ挙げ、正しい見分け方と短い確認問題を1問作ってください。個人情報は含めず、FE試験向けに説明してください。`,questions:`${base}関連問題をオリジナルで3問作ってください。各問は4択、正解、解説、関連語を付けてください。過去問の転載はしないでください。関連語: ${rel}。`};copyText(prompts[kind]||prompts.explain,'質問文をコピーしました');}
function copyWeakPrompt(){const summary=compactWeakSummary(5);copyText(`私は基本情報技術者試験を勉強しています。今日の弱点候補は「${summary}」です。個人情報や詳細な学習履歴は使わず、1. 共通する勘違い 2. 優先順位 3. 30分の復習メニュー 4. 確認問題3問、の順で整理してください。`,'弱点整理プロンプトをコピーしました');}

setup();
})();
