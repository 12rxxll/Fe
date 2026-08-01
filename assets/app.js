(() => {
'use strict';
const CORE_TERMS = Array.isArray(window.FE_TERMS) ? window.FE_TERMS : [];
const SYLLABUS_TERMS = Array.isArray(window.FE_SYLLABUS_TERMS) ? window.FE_SYLLABUS_TERMS : [];
const KMAP_DATA = window.FE_KNOWLEDGE_MAP || null;
const KNOWLEDGE_TERMS = knowledgeMapTermsToGlossary(KMAP_DATA);
const TERMS = mergeTerms(CORE_TERMS, SYLLABUS_TERMS, KNOWLEDGE_TERMS);
const SUBJECT_A = Array.isArray(window.FE_SUBJECT_A_QUESTIONS) ? window.FE_SUBJECT_A_QUESTIONS : [];
const STORAGE_KEY = 'fe-learning-os-v2';
const DATA_SCHEMA = 15;
const DAY = 86400000;
const NOTE_MIN_CHARS = 10;
const NOTE_BATCH_MAX_TERMS = 20;
const NOTE_BATCH_MAX_CHARS = 8000;
const NOTE_REVISION_HISTORY_LIMIT = 10;
const CHATGPT_URL = 'https://chatgpt.com/';
const MEMORIZATION_DEFAULTS = {
  enabled:false,
  sensorEnabled:false,
  showThreshold:25,
  hideThreshold:10,
  holdMs:500,
  manualMode:'hold',
  panelVisible:true
};
const defaultMemorizationSettings = () => Object.assign({}, MEMORIZATION_DEFAULTS);
const DETAIL_ACCORDION_KEYS = ['info','review','progress'];
const isDetailAccordionKey = key => DETAIL_ACCORDION_KEYS.includes(String(key));
const defaultUiState = () => ({quizSetup:{source:'terms',mode:'recommended',system:'',length:'10',type:'mixed'},map:{scrollY:0,selectedTermId:'',mapMode:'overview',expandedRelatedTermIds:[],openDetailAccordions:[]}});
const defaultState = () => ({version:2,schemaVersion:DATA_SCHEMA,createdAt:new Date().toISOString(),settings:{dailyGoal:10,examDate:'',theme:'system',memorization:defaultMemorizationSettings()},terms:{},knowledgeNotes:{},termNotes:{},noteRevisionHistory:{},memorizationRatings:{},quizDraft:null,uiState:defaultUiState(),chatgptSubmissionBatches:[],attempts:[],sessions:[],subjectA:{questions:{},attempts:[],sessions:[]}});
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
let knowledgeNoteSaveTimer = null;
let knowledgeFeedbackSaveTimer = null;
let activeKnowledgeNoteTermId = '';
let knowledgeNoteComposing = false;
let knowledgeCompositionBlockUntil = 0;
let pendingNoteSubmission = null;
let chatgptReviewFilter = 'all';
let expandedChatgptReviewTermId = '';
let pendingFeedbackApplyTermId = '';
let memorizationRotationPauseUntil = 0;
let knowledgeUiSaveTimer = null;
let settingsAutoSaveTimer = null;
const memorizationRuntime = {
  enabled:false,
  sensorWanted:false,
  sensorListening:false,
  sensorState:'センサ未開始',
  sensorMessage:'ボタン操作のみで使えます',
  baselineBeta:null,
  baselineGamma:null,
  currentBeta:null,
  currentGamma:null,
  tiltMagnitude:0,
  smoothTilt:0,
  samples:[],
  tiltHoldStart:0,
  lastToggleAt:0,
  sensorRevealTermId:'',
  manualRevealTermId:'',
  manualToggleTermId:'',
  allVisible:false,
  panelCollapsed:true,
  visibleTermIds:new Set(),
  observer:null
};
const knowledgeExpandedCategories = new Set();
const knowledgeCategoryLimits = new Map();
const knowledgeExpandedRelatedTerms = new Set();
const knowledgeDetailAccordionOpen = new Set();
const chatgptSelectedTermIds = new Set();
let knowledgeHighlightTimer = null;
let highlightedKnowledgeTermId = '';
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
function parseLocalDateValue(value){
  const raw=String(value||'').trim();
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if(!match)return null;
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),date=new Date(y,m-1,d,12,0,0,0);
  if(date.getFullYear()!==y||date.getMonth()!==m-1||date.getDate()!==d)return null;
  return date;
}
function normalizeExamDateValue(value){const date=parseLocalDateValue(value);return date?localDate(date):'';}
function examDateInfo(value=state.settings.examDate){
  const normalized=normalizeExamDateValue(value);
  if(!normalized)return {value:'',valid:false,set:false,label:'未設定',remaining:'未設定',days:null,past:false,message:''};
  const days=diffDays(localDate(),normalized);
  return {value:normalized,valid:true,set:true,label:new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'long',day:'numeric'}).format(parseLocalDateValue(normalized)),remaining:days<0?`試験日から${Math.abs(days)}日経過`:days===0?'試験日当日':`試験まであと ${days}日`,days,past:days<0,message:days<0?'過去の日付が設定されています。残り日数は計算対象外です。':''};
}
function preferredQuizLength(goal=state.settings.dailyGoal){const n=clamp(Number(goal)||10,1,100);if(n<=5)return '5';if(n<=10)return '10';return '20';}
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
function emptyTermNoteRecord(content=''){return {content:String(content||''),updatedAt:null,writingStatus:'empty',reviewStatus:'unreviewed',reviewedAt:null,lastSubmittedContent:'',lastSubmittedHash:'',lastSubmittedAt:null,lastSubmissionBatchId:null,feedbackMemo:'',feedbackAppliedAt:null,feedbackApplyMode:'',feedbackAppliedContent:''};}
function migrateTermNoteRecord(value={}){const s=typeof value==='string'?{content:value}:Object.assign(emptyTermNoteRecord(),value||{});s.content=String(s.content||'');s.updatedAt=s.updatedAt||null;s.writingStatus=s.writingStatus||'empty';s.reviewStatus=['unreviewed','correct','needs_fix','insufficient','needs_recheck'].includes(s.reviewStatus)?s.reviewStatus:'unreviewed';s.reviewedAt=s.reviewedAt||null;s.lastSubmittedContent=String(s.lastSubmittedContent||'');s.lastSubmittedHash=String(s.lastSubmittedHash||'');s.lastSubmittedAt=s.lastSubmittedAt||null;s.lastSubmissionBatchId=s.lastSubmissionBatchId||null;s.feedbackMemo=String(s.feedbackMemo||'');s.feedbackAppliedAt=s.feedbackAppliedAt||null;s.feedbackApplyMode=['append','replace','merge','undo'].includes(s.feedbackApplyMode)?s.feedbackApplyMode:'';s.feedbackAppliedContent=String(s.feedbackAppliedContent||'');return s;}
function migrateNoteRevisionHistory(value={}){
  const raw=value&&typeof value==='object'?value:{},out={};
  Object.keys(raw).forEach(termId=>{
    const rows=Array.isArray(raw[termId])?raw[termId]:[];
    out[termId]=rows.map(item=>({
      id:String(item?.id||`note-revision-${Date.now().toString(36)}`),
      changedAt:item?.changedAt||null,
      previousContent:String(item?.previousContent||''),
      newContent:String(item?.newContent||''),
      source:String(item?.source||'chatgpt-feedback'),
      applyMode:String(item?.applyMode||'')
    })).filter(item=>item.changedAt).slice(0,NOTE_REVISION_HISTORY_LIMIT);
  });
  return out;
}
function migrateSubmissionBatch(value={}){const s=Object.assign({id:'',createdAt:null,termIds:[],termNames:[],category:'',firstTerm:'',lastTerm:'',itemCount:0,totalCharacters:0,promptHash:'',status:'prepared'},value||{});s.termIds=Array.isArray(s.termIds)?s.termIds.map(String):[];s.termNames=Array.isArray(s.termNames)?s.termNames.map(String):[];s.itemCount=Math.max(0,Number(s.itemCount)||s.termIds.length);s.totalCharacters=Math.max(0,Number(s.totalCharacters)||0);s.status=String(s.status||'prepared');return s;}
function emptyMemorizationRating(){return {lastRating:null,ratedAt:null,knownCount:0,unsureCount:0,unknownCount:0};}
function migrateMemorizationRating(value={}){
  const s=Object.assign(emptyMemorizationRating(),value&&typeof value==='object'?value:{});
  s.lastRating=['known','unsure','unknown'].includes(s.lastRating)?s.lastRating:null;
  s.ratedAt=s.ratedAt||null;
  s.knownCount=Math.max(0,Number(s.knownCount)||0);
  s.unsureCount=Math.max(0,Number(s.unsureCount)||0);
  s.unknownCount=Math.max(0,Number(s.unknownCount)||0);
  return s;
}
function migrateQuizItem(value={}){
  const s=value&&typeof value==='object'?value:null;
  if(!s||!s.target||!Array.isArray(s.options)||!s.options.length)return null;
  s.options=s.options.map(option=>({id:String(option.id),label:String(option.label||'')})).filter(option=>option.label);
  s.qtype=String(s.qtype||'mixed');
  s.prompt=String(s.prompt||'');
  s.userAnswer=s.userAnswer===undefined||s.userAnswer===null?null:String(s.userAnswer);
  s.correct=s.correct===undefined||s.correct===null?null:Boolean(s.correct);
  s.graded=Boolean(s.graded);
  s.answeredAt=s.answeredAt||null;
  s.linkedTermNames=Array.isArray(s.linkedTermNames)?s.linkedTermNames.map(String):[];
  return s.options.length?s:null;
}
function migrateQuizDraft(value={}){
  const s=value&&typeof value==='object'?value:null;
  if(!s||s.completed||!Array.isArray(s.items)||!s.items.length)return null;
  const items=s.items.map(migrateQuizItem).filter(Boolean);
  if(!items.length)return null;
  const source=s.source==='subjectA'?'subjectA':'terms',length=items.length,index=clamp(Number(s.index)||0,0,length-1);
  return {
    sessionId:String(s.sessionId||`quiz-${Date.now().toString(36)}`),
    startedAt:Number(s.startedAt)||Date.now(),
    updatedAt:Number(s.updatedAt)||Date.now(),
    source,
    mode:String(s.mode||'recommended'),
    system:String(s.system||''),
    type:String(s.type||'mixed'),
    length,
    index,
    correct:Math.max(0,Number(s.correct)||items.filter(item=>item.graded&&item.correct).length),
    answered:Boolean(s.answered&&items[index]?.graded),
    questionIds:Array.isArray(s.questionIds)?s.questionIds.map(String):items.map(quizItemTargetId),
    items,
    results:Array.isArray(s.results)?s.results.map(r=>({id:String(r.id),correct:Boolean(r.correct),source:r.source==='subjectA'?'subjectA':'terms',system:String(r.system||'')})):items.filter(item=>item.graded).map(item=>({id:quizItemTargetId(item),correct:Boolean(item.correct),source,system:quizItemSystem(item)})),
    completed:false
  };
}
function migrateUiState(value={}){
  const raw=value&&typeof value==='object'?value:{},defaults=defaultUiState();
  const quizSetup=raw.quizSetup&&typeof raw.quizSetup==='object'?raw.quizSetup:{};
  const map=raw.map&&typeof raw.map==='object'?raw.map:{};
  return {
    quizSetup:{
      source:quizSetup.source==='subjectA'?'subjectA':'terms',
      mode:['recommended','random','weak','due','unlearned'].includes(quizSetup.mode)?quizSetup.mode:'recommended',
      system:String(quizSetup.system||''),
      length:['5','10','20'].includes(String(quizSetup.length))?String(quizSetup.length):defaults.quizSetup.length,
      type:['mixed','description','term','mock'].includes(quizSetup.type)?quizSetup.type:'mixed'
    },
    map:{
      scrollY:Math.max(0,Number(map.scrollY)||0),
      selectedTermId:String(map.selectedTermId||''),
      mapMode:map.mapMode==='tree'?'tree':'overview',
      expandedRelatedTermIds:Array.isArray(map.expandedRelatedTermIds)?map.expandedRelatedTermIds.map(String).slice(0,80):[],
      openDetailAccordions:defaults.map.openDetailAccordions.slice()
    }
  };
}
function migrateMemorizationSettings(value={}){
  const raw=value&&typeof value==='object'?value:{},s=Object.assign(defaultMemorizationSettings(),raw);
  s.enabled=Boolean(s.enabled);
  s.sensorEnabled=Boolean(s.sensorEnabled);
  if(!s.enabled)s.sensorEnabled=false;
  s.showThreshold=clamp(Number(s.showThreshold)||MEMORIZATION_DEFAULTS.showThreshold,12,60);
  s.hideThreshold=clamp(Number(s.hideThreshold)||MEMORIZATION_DEFAULTS.hideThreshold,3,Math.max(4,s.showThreshold-1));
  s.holdMs=clamp(Number(s.holdMs)||MEMORIZATION_DEFAULTS.holdMs,200,2000);
  s.manualMode=s.manualMode==='tap'?'tap':'hold';
  s.panelVisible=s.panelVisible!==false;
  return s;
}
function migrateState(s,sourceSchema=2){
  if((Number(sourceSchema)||2)<DATA_SCHEMA)needsMigrationSave=true;
  s.schemaVersion=DATA_SCHEMA;
  const rawSettings=s.settings&&typeof s.settings==='object'?s.settings:{};
  s.settings=Object.assign(defaultState().settings,rawSettings);
  s.settings.dailyGoal=clamp(Number(s.settings.dailyGoal)||10,1,100);
  s.settings.examDate=normalizeExamDateValue(s.settings.examDate||s.examDate||s.targetExamDate||'');
  s.settings.theme=['system','light','dark'].includes(s.settings.theme)?s.settings.theme:'system';
  s.settings.memorization=migrateMemorizationSettings(s.settings.memorization);
  s.terms=s.terms&&typeof s.terms==='object'?s.terms:{};
  Object.keys(s.terms).forEach(id=>{s.terms[id]=migrateTermState(s.terms[id]);});
  s.knowledgeNotes=s.knowledgeNotes&&typeof s.knowledgeNotes==='object'?s.knowledgeNotes:{};
  s.termNotes=s.termNotes&&typeof s.termNotes==='object'?s.termNotes:{};
  Object.keys(s.termNotes).forEach(id=>{s.termNotes[id]=migrateTermNoteRecord(s.termNotes[id]);});
  s.noteRevisionHistory=migrateNoteRevisionHistory(s.noteRevisionHistory);
  s.memorizationRatings=s.memorizationRatings&&typeof s.memorizationRatings==='object'?s.memorizationRatings:{};
  Object.keys(s.memorizationRatings).forEach(id=>{s.memorizationRatings[id]=migrateMemorizationRating(s.memorizationRatings[id]);});
  s.quizDraft=migrateQuizDraft(s.quizDraft);
  s.uiState=migrateUiState(s.uiState);
  s.chatgptSubmissionBatches=Array.isArray(s.chatgptSubmissionBatches)?s.chatgptSubmissionBatches.map(migrateSubmissionBatch):[];
  s.attempts=Array.isArray(s.attempts)?s.attempts:[];
  s.sessions=Array.isArray(s.sessions)?s.sessions:[];
  s.subjectA=s.subjectA&&typeof s.subjectA==='object'?s.subjectA:{questions:{},attempts:[],sessions:[]};
  s.subjectA.questions=s.subjectA.questions&&typeof s.subjectA.questions==='object'?s.subjectA.questions:{};
  s.subjectA.attempts=Array.isArray(s.subjectA.attempts)?s.subjectA.attempts:[];
  s.subjectA.sessions=Array.isArray(s.subjectA.sessions)?s.subjectA.sessions:[];
  return s;
}
function termStateNeedsMigration(s){return !('nextReview' in s)||!('lastCorrect' in s)||!('lastWrong' in s)||!('reviewPriority' in s)||!('knowledgeCorrect' in s)||!('knowledgeWrong' in s)||!('consecutiveIncorrect' in s)||!('weakReasons' in s);}
function readTermState(id){id=String(id);if(!state.terms[id])return emptyTermState();if(termStateNeedsMigration(state.terms[id]))state.terms[id]=migrateTermState(state.terms[id]);return state.terms[id];}
function getTermState(id){id=String(id);if(!state.terms[id]) state.terms[id]=emptyTermState();else if(termStateNeedsMigration(state.terms[id])) state.terms[id]=migrateTermState(state.terms[id]);return state.terms[id];}
function emptySubjectState(){return {correct:0,wrong:0,last:null,lastCorrect:null,lastWrong:null};}
function getSubjectState(id){id=String(id);if(!state.subjectA)state.subjectA={questions:{},attempts:[],sessions:[]};if(!state.subjectA.questions[id])state.subjectA.questions[id]=emptySubjectState();return state.subjectA.questions[id];}
function loadState(){try{const s=JSON.parse(localStorage.getItem(STORAGE_KEY));if(s&&s.version===2)return migrateState(Object.assign(defaultState(),s,{settings:Object.assign(defaultState().settings,s.settings||{})}),s.schemaVersion);}catch(e){}return defaultState();}
function refreshReviewPriorities(){Object.keys(state.terms||{}).forEach(id=>{const t=termById.get(String(id));if(t)state.terms[id].reviewPriority=reviewPriority(t);});}
function saveState(render=true){refreshReviewPriorities();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){console.warn('Local storage is unavailable; changes remain in memory for this session.',e);}if(render) renderAll();}
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
function examStatus(){const info=examDateInfo();return info.set?info.remaining:'試験日未設定';}
function memorizationRatingTotal(termId){const r=getMemorizationRatingRecord(termId,false);return r.knownCount+r.unsureCount+r.unknownCount;}
function isUnlearnedTerm(t){const s=readTermState(t.id);return s.mastery===0&&s.correct+s.wrong===0&&memorizationRatingTotal(t.id)===0;}
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
function studyPaceText(){
  const info=examDateInfo();
  if(!info.set)return '';
  if(info.past)return '試験予定日は過去日です。設定を見直してください。';
  if(info.days===0)return '今日は試験予定日です。復習と弱点確認に絞りましょう。';
  const remaining=unlearnedTerms().length,perDay=Math.max(1,Math.ceil(remaining/Math.max(1,info.days)));
  return `試験まで${info.days}日、未学習語は1日約${perDay}語が目安です。`;
}
function studyAdvice(){const due=priorityReviewTerms().length,weak=weakSystemStats()[0],unlearned=unlearnedTerms().length,pace=studyPaceText(),suffix=pace?` ${pace}`:'';if(due>0)return `まず復習対象${due}語を処理し、その後におすすめ演習を${preferredQuizLength()}問進めましょう。${suffix}`;if(weak&&weak.wrong>0)return `${weak.system}の誤答が目立ちます。分野を絞って苦手優先の演習を行いましょう。${suffix}`;if(unlearned>0)return `未学習語が${unlearned}語あります。おすすめ演習で新しい用語を少しずつ混ぜましょう。${suffix}`;return `習得済みを維持するため、短い復習を継続しましょう。${suffix}`;}
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
function uiState(){state.uiState=migrateUiState(state.uiState);return state.uiState;}
function saveQuizSetupUiState(){
  const ui=uiState(),getValue=id=>$(id)?.value||'';
  ui.quizSetup={source:getValue('quizSource')||'terms',mode:getValue('quizMode')||'recommended',system:getValue('quizSystem'),length:getValue('quizLength')||'10',type:getValue('quizType')||'mixed'};
  saveState(false);
}
function applyQuizSetupUiState(){
  const setup=uiState().quizSetup,setIfValid=(id,value)=>{const el=$(id);if(el&&[...el.options].some(option=>option.value===String(value)))el.value=String(value);};
  setIfValid('quizSource',setup.source);
  setIfValid('quizMode',setup.mode);
  setIfValid('quizSystem',setup.system);
  setIfValid('quizLength',setup.length);
  setIfValid('quizType',setup.type);
}
function saveKnowledgeUiState({save=false}={}){
  const map=uiState().map;
  map.scrollY=currentView==='map'?Math.max(0,window.scrollY||0):map.scrollY;
  map.selectedTermId=selectedKnowledgeTermId||'';
  map.mapMode=knowledgeMapMode||'overview';
  map.expandedRelatedTermIds=[...knowledgeExpandedRelatedTerms].slice(0,80);
  map.openDetailAccordions=[];
  if(save)saveState(false);
}
function queueKnowledgeUiStateSave(){
  if(currentView!=='map')return;
  clearTimeout(knowledgeUiSaveTimer);
  knowledgeUiSaveTimer=setTimeout(()=>saveKnowledgeUiState({save:true}),250);
}
function applyKnowledgeUiState(){
  const map=uiState().map;
  knowledgeMapMode=map.mapMode||knowledgeMapMode;
  selectedKnowledgeTermId=map.selectedTermId||selectedKnowledgeTermId;
  knowledgeExpandedRelatedTerms.clear();
  map.expandedRelatedTermIds.forEach(id=>knowledgeExpandedRelatedTerms.add(id));
  knowledgeDetailAccordionOpen.clear();
  if(selectedKnowledgeTermId){const svc=getKnowledgeService(),term=svc?.getTerm(selectedKnowledgeTermId);if(term)expandKnowledgeCategoryPath(term.categoryId,svc);}
}
function restoreKnowledgeScroll(){
  const y=Number(uiState().map.scrollY)||0;
  if(currentView==='map'&&y>0)setTimeout(()=>window.scrollTo({top:y,behavior:'auto'}),0);
}
function navTo(view){
  if(currentView==='map')saveKnowledgeUiState({save:true});
  currentView=(view==='study'||view==='terms')?'map':view;
  if(currentView==='map')applyKnowledgeUiState();
  syncNavigationState();
  renderAll();
  if(currentView==='map')restoreKnowledgeScroll();else window.scrollTo({top:0,behavior:'smooth'});
}
function startDueReview(){const queue=priorityReviewTerms();if(queue.length>0){navTo('quiz');startQuiz({mode:'due',length:Math.min(20,Math.max(5,queue.length))});return;}navTo('review');}
function showUpdateBanner(worker){pendingServiceWorker=worker;$('updateBanner').classList.remove('hidden');}
function registerServiceWorker(){if(!('serviceWorker' in navigator)||!location.protocol.startsWith('http'))return;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshingForUpdate)return;refreshingForUpdate=true;location.reload();});navigator.serviceWorker.register('./sw.js').then(reg=>{if(reg.waiting&&navigator.serviceWorker.controller)showUpdateBanner(reg.waiting);reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdateBanner(worker);});});}).catch(()=>{});}

function setup(){
  $('todayLabel').textContent=new Intl.DateTimeFormat('ja-JP',{month:'long',day:'numeric',weekday:'short'}).format(new Date());
  getSystems().forEach(s=>{$('quizSystem').add(new Option(s,s));$('knowledgeSubjectFilter').add(new Option(s,s));$('reviewSystemFilter')?.add(new Option(s,s));});
  applyQuizSetupUiState();
  syncNavigationState();syncReviewTabs();
  $$('[data-nav]').forEach(b=>b.addEventListener('click',()=>navTo(b.dataset.nav)));
  ['quizSource','quizMode','quizSystem','quizLength','quizType'].forEach(id=>$(id).addEventListener('change',saveQuizSetupUiState));
  $('quickStartButton').addEventListener('click',()=>{const length=preferredQuizLength();navTo('quiz');$('quizSource').value='terms';$('quizLength').value=length;startQuiz({source:'terms',mode:'weak',length:Number(length)});});
  $('recommendedQuizButton').addEventListener('click',()=>{const length=preferredQuizLength();navTo('quiz');$('quizSource').value='terms';$('quizMode').value='recommended';$('quizLength').value=length;startQuiz({source:'terms',mode:'recommended',length:Number(length)});});
  $('homeReviewButton').addEventListener('click',startDueReview);
  $('knowledgeSearch').addEventListener('input',renderKnowledgeMap);
  $('knowledgeSubjectFilter').addEventListener('change',renderKnowledgeMap);
  $('knowledgeStatusFilter').addEventListener('change',renderKnowledgeMap);
  $('knowledgeWritingFilter').addEventListener('change',renderKnowledgeMap);
  $$('[data-map-mode]').forEach(button=>button.addEventListener('click',()=>{knowledgeMapMode=button.dataset.mapMode||'overview';renderKnowledgeMap();saveKnowledgeUiState({save:true});}));
  $('knowledgeExpandAllButton').addEventListener('click',()=>{const svc=getKnowledgeService();if(svc)svc.categories.filter(category=>!category.parentCategoryId).forEach(category=>knowledgeExpandedCategories.add(category.id));renderKnowledgeMap();});
  $('knowledgeCollapseAllButton').addEventListener('click',()=>{knowledgeExpandedCategories.clear();knowledgeCategoryLimits.clear();renderKnowledgeMap();});
  $('knowledgeResetViewButton').addEventListener('click',()=>{$('knowledgeSearch').value='';$('knowledgeSubjectFilter').value='';$('knowledgeStatusFilter').value='';$('knowledgeWritingFilter').value='';knowledgeCategoryLimits.clear();renderKnowledgeMap();});
  $('focusRecommendationButton').addEventListener('click',()=>{const svc=getKnowledgeService(),rec=svc?.recommendNext(1)[0];if(rec){knowledgeMapMode='tree';selectedKnowledgeTermId=rec.term.id;expandKnowledgeCategoryPath(rec.term.categoryId,svc);renderKnowledgeMap();renderKnowledgeDetail(rec.term.id);saveKnowledgeUiState({save:true});}});
  $('prepareUnsubmittedNotesButton').addEventListener('click',()=>prepareNoteSubmission('unsubmitted'));
  $('prepareSelectedNoteButton').addEventListener('click',()=>prepareNoteSubmission('selected'));
  $('prepareChosenNotesButton').addEventListener('click',()=>prepareNoteSubmission('custom'));
  $('prepareSubjectNotesButton').addEventListener('click',()=>prepareNoteSubmission('subject'));
  $('addChatgptTermButton').addEventListener('click',addChatGPTSelectedTerm);
  $('chatgptSubjectFilter').addEventListener('change',()=>renderNoteSubmissionPanel(getKnowledgeService()));
  $('includeSubmittedNotes').addEventListener('change',()=>renderNoteSubmissionPanel(getKnowledgeService()));
  bindMemorizationControls();
  $('startQuizButton').addEventListener('click',()=>startQuiz());
  $('quizDraftPanel').addEventListener('click',handleQuizDraftPanelClick);
  $('startReviewButton').addEventListener('click',()=>startReviewMode('due'));
  $('startDueReviewButton').addEventListener('click',()=>startReviewMode('due'));
  $('startWrongReviewButton').addEventListener('click',()=>startReviewMode('wrong'));
  $('startWeakReviewButton').addEventListener('click',()=>startReviewMode('weak'));
  $('resumeReviewButton').addEventListener('click',resumeReviewFromReviewScreen);
  $('openWritingReviewButton').addEventListener('click',()=>{qs('#writingReviewPanel')?.classList.remove('hidden');qs('#writingReviewPanel')?.scrollIntoView({behavior:'smooth',block:'start'});});
  $('reviewSystemFilter').addEventListener('change',renderReview);
  $$('[data-review-filter]').forEach(b=>b.addEventListener('click',()=>{reviewFilter=b.dataset.reviewFilter;syncReviewTabs();renderReview();}));
  $$('[data-chatgpt-review-filter]').forEach(b=>b.addEventListener('click',()=>{chatgptReviewFilter=b.dataset.chatgptReviewFilter||'all';syncChatGPTReviewFilterTabs();renderChatGPTReviewList(getKnowledgeService());}));
  $('saveSettingsButton').addEventListener('click',()=>saveSettings());
  $('clearExamDateButton').addEventListener('click',clearExamDateSetting);
  ['dailyGoalInput','examDateInput','themeInput','memorizationDefaultInput','memorizationSensorDefaultInput','memorizationShowThresholdInput','memorizationHideThresholdInput','memorizationHoldMsInput','memorizationManualModeInput','memorizationPanelVisibleInput'].forEach(id=>$(id)?.addEventListener('change',()=>saveSettings({silent:true})));
  $('dailyGoalInput').addEventListener('input',queueSettingsAutoSave);
  $('examDateInput').addEventListener('input',queueSettingsAutoSave);
  $('exportButton').addEventListener('click',exportData);
  $('importInput').addEventListener('change',importData);
  $('resetButton').addEventListener('click',resetData);
  $('copyGeneralPromptButton').addEventListener('click',copyWeakPrompt);
  $('reloadUpdateButton').addEventListener('click',()=>{if(pendingServiceWorker)pendingServiceWorker.postMessage({type:'SKIP_WAITING'});});
  document.addEventListener('keydown',handleKnowledgeNoteKeydown);
  document.addEventListener('compositionstart',handleKnowledgeCompositionStart,true);
  document.addEventListener('compositionend',handleKnowledgeCompositionEnd,true);
  document.addEventListener('visibilitychange',handleMemorizationVisibilityChange);
  window.addEventListener('orientationchange',handleMemorizationOrientationChange);
  window.addEventListener('popstate',handleAppPopState);
  window.addEventListener('scroll',queueKnowledgeUiStateSave,{passive:true});
  $('appTermCount').textContent=`${TERMS.length}語`;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installButton').classList.remove('hidden');});
  $('installButton').addEventListener('click',async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installButton').classList.add('hidden');}else{showToast('Safariの共有メニューから「ホーム画面に追加」を選択してください');}});
  if(window.matchMedia){const darkPreference=matchMedia('(prefers-color-scheme: dark)');darkPreference.addEventListener?.('change',()=>{if((state.settings.theme||'system')==='system')applyTheme();});}
  registerServiceWorker();
  if(needsMigrationSave){saveState(false);needsMigrationSave=false;}
  hydrateMemorizationRuntime();
  applyTheme();
  const initialView=new URLSearchParams(location.search).get('view');
  if(['home','study','terms','quiz','review','progress','map','settings'].includes(initialView))navTo(initialView);else renderAll();
}

function renderAll(){applyTheme();renderHome();if(currentView==='quiz')renderQuizView();if(currentView==='review')renderReview();if(currentView==='progress')renderProgress();if(currentView==='map')renderKnowledgeMap();if(currentView==='settings')renderSettings();}
function renderHome(){
  const daily=state.settings.dailyGoal||10, done=todayAttempts().length,pct=clamp(done/daily*100,0,100);
  $('dailyProgressText').textContent=`${done} / ${daily}`;$('dailyProgressBar').style.width=pct+'%';
  const remaining=Math.max(daily-done,0),due=priorityReviewTerms().length,dueToday=dueTerms().length,studied=studiedTerms().length,acc=accuracy();
  $('homePlanTitle').textContent=due>0?'復習から始める':remaining>0?`今日の目標まであと${remaining}問`:'今日の目標を達成しました';
  const quizLength=preferredQuizLength();
  $('homePlanText').textContent=due>0?`期限${dueToday}語と忘れかけ語を優先度順に復習しましょう。`:remaining>0?`${quizLength}問単位で演習し、間違えた用語は自動で復習候補に入ります。`:'余力があれば未学習語か苦手語を少し進めましょう。';
  $('quickStartButton').textContent=`${quizLength}問スタート`;
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

function filteredTerms(){return TERMS;}
function renderTerms(){navTo('map');}
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
function knowledgeTermSubject(term,svc){const category=svc.getCategory(term.categoryId),subject=svc.subjects.find(x=>category&&x.id===category.subjectId);return (term.appTerm&&term.appTerm['系'])||(subject&&subject.name)||'';}
function knowledgeTermVisible(term,svc){const q=normalize($('knowledgeSearch').value),subject=$('knowledgeSubjectFilter').value,status=$('knowledgeStatusFilter').value,writingFilter=$('knowledgeWritingFilter').value,progress=svc.progressForTerm(term.id),writing=writingProgressForTerm(term);if(subject&&knowledgeTermSubject(term,svc)!==subject)return false;if(status&&progress.status!==status)return false;if(writingFilter&&writing.key!==writingFilter)return false;if(q&&!knowledgeSearchText(term,svc).includes(q))return false;return true;}
function knowledgeFilterActive(){return Boolean(normalize($('knowledgeSearch').value)||$('knowledgeSubjectFilter').value||$('knowledgeStatusFilter').value||$('knowledgeWritingFilter').value);}
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
  const writingStats=writingTestStats(svc.terms,svc);
  $('knowledgeMapCount').textContent=`${summary.termCount}語 / ${summary.categoryCount}カテゴリ / ${summary.relationCount}関係`;
  $('mapMasteryValue').textContent=summary.masteryScore+'%';
  $('mapWritingValue').textContent=writingStats.writingRate+'%';
  $('mapReviewValue').textContent=counts.review;
  $('mapWeakValue').textContent=counts.weak;
  $('mapMasteredValue').textContent=counts.mastered;
  renderKnowledgeRecommendation(svc);
  renderNoteSubmissionPanel(svc);
  renderMemorizationPanel();
  renderKnowledgeOverview(svc,summary);
  if(knowledgeMapMode!=='tree'){
    $('knowledgeMapTree').innerHTML='';
    bindKnowledgeMapActions();
    applyMemorizationCovers();
    return;
  }
  const html=svc.getSubjectTree().map(node=>renderKnowledgeSubject(node.subject,node.categories,svc)).join('');
  $('knowledgeMapTree').innerHTML=html||'<div class="empty">条件に合うノードはありません。</div>';
  bindKnowledgeMapActions();
  if(selectedKnowledgeTermId)renderKnowledgeDetail(selectedKnowledgeTermId);
  applyMemorizationCovers();
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
function knowledgeHashTermId(){
  const hash=decodeURIComponent(location.hash||'');
  return hash.startsWith('#term-')?hash.slice(6):'';
}
function renderKnowledgeNode(term,svc){
  const progress=svc.progressForTerm(term.id),selected=selectedKnowledgeTermId===term.id?' selected':'',highlighted=highlightedKnowledgeTermId===term.id||knowledgeHashTermId()===term.id?' is-highlighted':'',appMissing=term.appTermId?'':'・未接続';
  const writing=writingProgressForTerm(term),test=testProgressForTerm(term,svc);
  const node=`<button id="term-${esc(term.id)}" class="knowledge-node state-${esc(progress.status)}${selected}${highlighted}" data-map-term-id="${esc(term.id)}" type="button" role="treeitem" aria-expanded="${selected?'true':'false'}" aria-label="${esc(term.name)} 記述 ${esc(writing.label)} テスト ${esc(test.label)}"><span class="knowledge-node-marker" aria-hidden="true">${esc(progress.statusMarker)}</span><span class="knowledge-node-title"><strong>${esc(term.name)}</strong><small>記述:${esc(writing.label)}・テスト:${esc(test.summary)}${appMissing}</small></span><span class="knowledge-node-score">${progress.masteryScore}%</span></button>`;
  return selected?node+renderKnowledgeInlineDetail(term,svc):node;
}
function knowledgeWritingQuestion(term,svc){
  const text=normalize([term.name,term.shortDescription,term.detailedDescription,term.example].join(' ')),connected=svc.getConnectedTerms(term.id).slice(0,3).map(x=>x.name);
  if(/変換|計算|率|cpi|mips|flops|補数|小数|平均/.test(text))return `『${term.name}』を使う計算方法と注意点を、FEで問われるポイントとして説明してください。`;
  if(/比較|違い|risc|cisc|raid|方式/.test(text)||connected.length)return `『${term.name}』とは何ですか？ 関連用語${connected.length?`（${connected.join('、')}）`:''}との違いも含めて説明してください。`;
  if(/仕組み|構造|動作|制御|記憶|通信|処理/.test(text))return `『${term.name}』は、どのような仕組みですか？ FEで問われるポイントを自分の言葉で説明してください。`;
  if(/用途|利用|使/.test(text))return `『${term.name}』は、どのような場面で使われますか？ FEで問われるポイントを自分の言葉で説明してください。`;
  return `『${term.name}』とは何ですか？ FEで問われるポイントを、自分の言葉で説明してください。`;
}
function noteReviewOption(value,label,current){return `<option value="${esc(value)}" ${current===value?'selected':''}>${esc(label)}</option>`;}
function noteReviewOptions(current){
  const extra=current==='needs_recheck'?noteReviewOption('needs_recheck','再確認待ち',current):'';
  return `${noteReviewOption('unreviewed','未確認',current)}${noteReviewOption('correct','正しい',current)}${noteReviewOption('needs_fix','一部修正が必要',current)}${noteReviewOption('insufficient','理解不足',current)}${extra}`;
}
function noteReviewDisplay(record){
  const status=record?.reviewStatus||'unreviewed',applied=Boolean(record?.feedbackAppliedAt);
  if(status==='correct')return {key:'confirmed',label:'確認済み',className:'good'};
  if(status==='needs_fix')return {key:'needs_fix',label:applied?'要修正・反映済み':'要修正',className:'bad'};
  if(status==='insufficient')return {key:'insufficient',label:applied?'再学習・反映済み':'再学習',className:'bad'};
  if(status==='needs_recheck')return {key:'needs_recheck',label:'再確認待ち',className:''};
  return {key:'unreviewed',label:'未確認',className:'gray'};
}
function getMemorizationRatingRecord(termId,create=false){
  termId=String(termId||'');
  if(!state.memorizationRatings||typeof state.memorizationRatings!=='object')state.memorizationRatings={};
  let record=state.memorizationRatings[termId];
  if(record)record=state.memorizationRatings[termId]=migrateMemorizationRating(record);
  if(!record&&create)record=state.memorizationRatings[termId]=emptyMemorizationRating();
  return record||emptyMemorizationRating();
}
function memorizationRatingLabel(value){return ({known:'覚えていた',unsure:'あいまい',unknown:'覚えていなかった'})[value]||'未評価';}
function renderMemorizationRatingSection(term){
  const record=getMemorizationRatingRecord(term.id,false),last=memorizationRatingLabel(record.lastRating),lastDate=record.ratedAt?formatDateTime(record.ratedAt):'未記録';
  return `<div class="memorization-rating" data-memorization-rating-panel="${esc(term.id)}"><div><strong>暗記自己評価</strong><small>テスト正答率とは別に保存します。最終: ${esc(last)} / ${esc(lastDate)}</small></div><div class="memorization-rating-actions" role="group" aria-label="${esc(term.name)}の暗記自己評価">${['known','unsure','unknown'].map(value=>`<button class="secondary ${record.lastRating===value?'active':''}" data-memorization-rating-term="${esc(term.id)}" data-memorization-rating="${value}" type="button">${esc(memorizationRatingLabel(value))}</button>`).join('')}</div><small class="subtle">累計: 覚えていた ${record.knownCount} / あいまい ${record.unsureCount} / 覚えていなかった ${record.unknownCount}</small></div>`;
}
function renderKnowledgeNoteSection(term,svc,heading='h5'){
  const writing=writingProgressForTerm(term),test=testProgressForTerm(term,svc);
  return `<section class="map-detail-section knowledge-note-section"><div class="knowledge-note-title-row"><div><strong>${esc(term.name)}</strong><small>記述: ${esc(writing.label)} / テスト: ${esc(test.summary)}</small></div><div class="note-inline-nav" role="group" aria-label="用語移動"><button class="secondary" data-note-move="-1" data-note-move-term="${esc(term.id)}" type="button">前の用語</button><button class="secondary" data-note-move="1" data-note-move-term="${esc(term.id)}" type="button">次の用語</button></div></div><${heading}>自分の言葉でまとめる</${heading}><p class="knowledge-note-question">${esc(knowledgeWritingQuestion(term,svc))}</p><div class="memorization-note-wrap" data-memorization-term="${esc(term.id)}"><textarea class="knowledge-note-area" data-map-note-term="${esc(term.id)}" placeholder="定義・仕組み・FEで重要な点を、自分の言葉で書いてください">${esc(readKnowledgeTermNote(term))}</textarea><div class="memorization-cover" data-memorization-cover="${esc(term.id)}" aria-hidden="true"><strong>あなたの記述は隠れています</strong><span>マップ上部の暗記モードで表示を切り替えます。</span></div></div><p class="help" data-map-note-status>自動保存: 入力すると保存します。</p></section>`;
}
function splitRelatedNames(value){return String(value||'').split(/[\/、,，]/).map(name=>name.trim()).filter(Boolean);}
function mapTermByName(svc,name){const key=normalize(name);return svc.terms.find(term=>normalize(term.name)===key)||null;}
function relatedEntriesForTerm(term,svc,limit=24){
  const prereqIds=new Set(svc.getPrerequisites(term.id).map(item=>item.id));
  const seen=new Set();
  const entries=[];
  const addEntry=(name,mapTerm=null)=>{
    const key=normalize(name);if(!key||seen.has(key))return;
    seen.add(key);
    if(mapTerm&&mapTerm.id!==term.id&&!prereqIds.has(mapTerm.id))entries.push({name:mapTerm.name,term:mapTerm,registered:true});
    else if(!mapTerm)entries.push({name,term:null,registered:false});
  };
  svc.getConnectedTerms(term.id).filter(item=>!prereqIds.has(item.id)).forEach(item=>addEntry(item.name,item));
  splitRelatedNames(term.appTerm?.['関連語']).forEach(name=>addEntry(name,mapTermByName(svc,name)));
  return entries.slice(0,limit);
}
function relatedEntryHtml(entry,svc){
  if(!entry.registered||!entry.term)return `<div class="related-term-item missing" aria-disabled="true"><div><strong>${esc(entry.name)}</strong><small>マップ未登録</small></div><span class="badge gray">未登録</span></div>`;
  const progress=svc.progressForTerm(entry.term.id),total=progress.totalAttempts,accuracy=total?Math.round(progress.correctAttempts/total*100):0;
  return `<button class="related-term-item text-button" data-map-related-jump="${esc(entry.term.id)}" type="button"><div><strong>${esc(entry.term.name)}</strong><small>${esc(progress.statusLabel)} / 重要${entry.term.importance} / 難易度${entry.term.difficulty} / 正答率${accuracy}%</small></div><span class="knowledge-node-marker">${esc(progress.statusMarker)}</span></button>`;
}
function renderRelatedAccordion(term,svc,heading='h5'){
  const open=knowledgeExpandedRelatedTerms.has(term.id),entries=relatedEntriesForTerm(term,svc,24);
  if(!open)return '';
  return `<section class="map-detail-section related-accordion" data-related-panel="${esc(term.id)}"><${heading}>関連用語</${heading}><div class="related-term-list" aria-label="${esc(term.name)}の関連用語">${entries.length?entries.map(entry=>relatedEntryHtml(entry,svc)).join(''):'<p class="empty compact">関連用語は登録されていません</p>'}</div></section>`;
}
function renderKnowledgeDetailAccordion(key,title,bodyHtml,scope){
  const open=knowledgeDetailAccordionOpen.has(key),panelId=`knowledge-${scope}-${key}-accordion`;
  return `<section class="knowledge-detail-accordion ${open?'is-open':'is-closed'}" data-detail-accordion-key="${esc(key)}"><button class="knowledge-detail-accordion-toggle" data-knowledge-detail-accordion="${esc(key)}" type="button" aria-expanded="${open?'true':'false'}" aria-controls="${esc(panelId)}"><span>${esc(title)}</span><b aria-hidden="true">${open?'−':'+'}</b></button><div id="${esc(panelId)}" class="knowledge-detail-accordion-body" ${open?'':'hidden'}>${bodyHtml}</div></section>`;
}
function renderKnowledgeInfoAccordion(term,svc,scope){
  const prereq=svc.getPrerequisites(term.id),reasons=svc.weakReasons(term.id),entries=relatedEntriesForTerm(term,svc,18);
  const body=`<div class="knowledge-accordion-grid"><div class="knowledge-detail-field"><strong>詳しい説明</strong><p>${esc(term.detailedDescription||term.shortDescription||'説明は未登録です。')}</p>${term.example?`<p class="help"><b>具体例:</b> ${esc(term.example)}</p>`:''}<button class="secondary compact explain-chatgpt-button" data-term-explain-chatgpt="${esc(term.id)}" type="button">ChatGPTに説明を聞く</button></div><div class="knowledge-mini-stats"><span><strong>重要度</strong><b>${esc(term.importance)}/5</b></span><span><strong>難易度</strong><b>${esc(term.difficulty)}/5</b></span></div><div class="knowledge-detail-field"><strong>前提用語</strong><div class="map-relation-list">${prereq.length?prereq.slice(0,10).map(x=>relationTermButton(x,svc)).join(''):'<span class="subtle">前提はありません。</span>'}</div></div><div class="knowledge-detail-field"><strong>関連用語</strong><div class="related-term-list">${entries.length?entries.map(entry=>relatedEntryHtml(entry,svc)).join(''):'<p class="empty compact">関連用語は登録されていません。</p>'}</div></div><div class="knowledge-detail-field"><strong>苦手理由</strong><p class="help">${reasons.length?esc(reasons.join('、')):'現在は明確な苦手理由はありません。'}</p></div></div>`;
  return renderKnowledgeDetailAccordion('info','説明・関連情報',body,scope);
}
function renderKnowledgeReviewAccordion(term,svc,scope){
  const progress=svc.progressForTerm(term.id),test=testProgressForTerm(term,svc),nextReview=progress.nextReviewAt?formatReviewDate(progress.nextReviewAt):'未設定';
  const body=`<div class="knowledge-accordion-grid">${renderMemorizationRatingSection(term)}<div class="knowledge-review-grid"><div class="knowledge-review-item"><strong>問題演習</strong><button class="primary" data-map-practice-term="${esc(term.id)}" type="button" ${term.appTermId?'':'disabled'}>確認問題を解く</button></div><div class="knowledge-review-item"><strong>テスト結果</strong><span>${esc(test.summary)}</span><small>正解 ${formatProgressCount(progress.correctAttempts)} / 誤答 ${formatProgressCount(progress.wrongAttempts)}</small></div><div class="knowledge-review-item"><strong>次回復習日</strong><span>${esc(nextReview)}</span></div></div></div>`;
  return renderKnowledgeDetailAccordion('review','復習・問題',body,scope);
}
function renderKnowledgeProgressAccordion(term,svc,scope){
  const progress=svc.progressForTerm(term.id),writing=writingProgressForTerm(term),test=testProgressForTerm(term,svc),total=progress.totalAttempts;
  const lastStudy=progress.lastStudiedAt?formatReviewDate(progress.lastStudiedAt):'未記録',lastAnswer=progress.lastAnsweredAt?formatReviewDate(progress.lastAnsweredAt):'未記録';
  const body=`<div class="knowledge-accordion-grid"><div class="progress-split compact"><div><span>記述進捗</span><div class="progress-track"><span style="width:${writing.score}%"></span></div><small>${esc(writing.label)}</small></div><div><span>テスト進捗</span><div class="progress-track"><span style="width:${test.score}%"></span></div><small>${esc(test.summary)}</small></div></div><div class="knowledge-review-grid"><div class="knowledge-review-item"><strong>出題回数</strong><span>${formatProgressCount(total)}回</span></div><div class="knowledge-review-item"><strong>連続正解</strong><span>${formatProgressCount(progress.consecutiveCorrect)}回</span></div><div class="knowledge-review-item"><strong>連続不正解</strong><span>${formatProgressCount(progress.consecutiveIncorrect)}回</span></div><div class="knowledge-review-item"><strong>最終学習日</strong><span>${esc(lastStudy)}</span></div><div class="knowledge-review-item"><strong>最終回答日</strong><span>${esc(lastAnswer)}</span></div></div></div>`;
  return renderKnowledgeDetailAccordion('progress','詳細進捗',body,scope);
}
function renderKnowledgeDetailContent(term,svc,heading='h5',scope='inline'){
  return `${renderKnowledgeNoteSection(term,svc,heading)}<div class="knowledge-detail-accordion-list">${renderKnowledgeInfoAccordion(term,svc,scope)}${renderKnowledgeReviewAccordion(term,svc,scope)}${renderKnowledgeProgressAccordion(term,svc,scope)}</div>`;
}
function renderKnowledgeInlineDetail(term,svc){
  return `<article class="knowledge-inline-detail" data-knowledge-detail-root data-map-inline-detail="${esc(term.id)}" aria-label="${esc(term.name)}の記述カード">${renderKnowledgeDetailContent(term,svc,'h5','inline')}</article>`;
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
function knowledgeHistorySnapshot(){
  return {view:currentView,scrollY:window.scrollY||0,selectedTermId:selectedKnowledgeTermId,mapMode:knowledgeMapMode,expandedRelatedTermIds:[...knowledgeExpandedRelatedTerms],openDetailAccordions:[...knowledgeDetailAccordionOpen]};
}
function restoreKnowledgeSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=='object')return false;
  currentView=snapshot.view||'map';
  selectedKnowledgeTermId=String(snapshot.selectedTermId||'');
  knowledgeMapMode=snapshot.mapMode||'tree';
  knowledgeExpandedRelatedTerms.clear();
  (Array.isArray(snapshot.expandedRelatedTermIds)?snapshot.expandedRelatedTermIds:[]).forEach(id=>knowledgeExpandedRelatedTerms.add(String(id)));
  knowledgeDetailAccordionOpen.clear();
  (Array.isArray(snapshot.openDetailAccordions)?snapshot.openDetailAccordions:[]).filter(isDetailAccordionKey).forEach(key=>knowledgeDetailAccordionOpen.add(String(key)));
  if(selectedKnowledgeTermId){const svc=getKnowledgeService(),term=svc?.getTerm(selectedKnowledgeTermId);if(term)expandKnowledgeCategoryPath(term.categoryId,svc);}
  syncNavigationState();
  renderAll();
  setTimeout(()=>window.scrollTo({top:Number(snapshot.scrollY)||0,behavior:'auto'}),0);
  saveKnowledgeUiState({save:true});
  return true;
}
function handleAppPopState(event){if(restoreKnowledgeSnapshot(event.state?.feLearningReturn))return;}
function pushKnowledgeJumpHistory(targetTermId){
  if(!history?.pushState||!history?.replaceState)return;
  try{
    history.replaceState(Object.assign({},history.state||{},{feLearningReturn:knowledgeHistorySnapshot()}),'',location.href);
    const url=new URL(location.href);url.hash=`term-${encodeURIComponent(targetTermId)}`;
    history.pushState({feLearningJumpTarget:targetTermId},'',url);
  }catch(err){}
}
function revealKnowledgeTermForJump(term,svc){
  if(knowledgeTermVisible(term,svc))return;
  $('knowledgeSearch').value='';
  $('knowledgeStatusFilter').value='';
  $('knowledgeWritingFilter').value='';
  $('knowledgeSubjectFilter').value='';
}
function selectKnowledgeTerm(termId,{scroll=false,highlight=false,recordHistory=false}={}){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term){showToast('マップ内に対象用語が見つかりません');return false;}
  if(recordHistory)pushKnowledgeJumpHistory(term.id);
  if(recordHistory||scroll||highlight)revealKnowledgeTermForJump(term,svc);
  knowledgeMapMode='tree';
  selectedKnowledgeTermId=term.id;
  if(highlight)highlightedKnowledgeTermId=term.id;
  clearMemorizationReveal();
  expandKnowledgeCategoryPath(term.categoryId,svc);
  renderKnowledgeMap();
  renderKnowledgeDetail(term.id);
  saveKnowledgeUiState({save:true});
  if(scroll||highlight){
    highlightKnowledgeTerm(term.id,{scroll,highlight});
    setTimeout(()=>highlightKnowledgeTerm(term.id,{scroll:false,highlight}),120);
  }
  return true;
}
function highlightKnowledgeTerm(termId,{scroll=true,highlight=true}={}){
  const node=qs(`.knowledge-node[data-map-term-id="${CSS.escape(termId)}"]`);
  if(!node){showToast('マップ内に対象用語が見つかりません');return;}
  if(scroll)node.scrollIntoView({behavior:'smooth',block:'center'});
  if(!highlight)return;
  highlightedKnowledgeTermId=termId;
  clearTimeout(knowledgeHighlightTimer);
  $$('.knowledge-node.is-highlighted').forEach(item=>item.classList.remove('is-highlighted'));
  node.classList.add('is-highlighted');
  knowledgeHighlightTimer=setTimeout(()=>{highlightedKnowledgeTermId='';node.classList.remove('is-highlighted');},2600);
}
function jumpToRelatedKnowledgeTerm(termId){
  const id=String(termId||'');
  if(!selectKnowledgeTerm(id,{scroll:true,recordHistory:true}))return;
  highlightedKnowledgeTermId=id;
  renderKnowledgeMap();
  renderKnowledgeDetail(id);
  setTimeout(()=>highlightKnowledgeTerm(id,{scroll:true,highlight:true}),80);
}
function toggleRelatedTerms(termId){
  termId=String(termId||'');
  if(!termId)return;
  if(knowledgeExpandedRelatedTerms.has(termId))knowledgeExpandedRelatedTerms.delete(termId);else knowledgeExpandedRelatedTerms.add(termId);
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(term)expandKnowledgeCategoryPath(term.categoryId,svc);
  renderKnowledgeMap();
  if(selectedKnowledgeTermId)renderKnowledgeDetail(selectedKnowledgeTermId);
  saveKnowledgeUiState({save:true});
}
function toggleKnowledgeDetailAccordion(key){
  key=String(key||'');
  if(!isDetailAccordionKey(key))return;
  if(knowledgeDetailAccordionOpen.has(key))knowledgeDetailAccordionOpen.delete(key);else knowledgeDetailAccordionOpen.add(key);
  renderKnowledgeMap();
  if(selectedKnowledgeTermId)renderKnowledgeDetail(selectedKnowledgeTermId);
  saveKnowledgeUiState({save:true});
}
function bindKnowledgeMapActions(){
  $$('[data-map-term-id]').forEach(button=>{button.onclick=()=>selectKnowledgeTerm(button.dataset.mapTermId);});
  $$('[data-map-category-id]').forEach(button=>button.onclick=()=>{const id=button.dataset.mapCategoryId;if(knowledgeExpandedCategories.has(id))knowledgeExpandedCategories.delete(id);else knowledgeExpandedCategories.add(id);renderKnowledgeMap();});
  $$('[data-map-load-category]').forEach(button=>button.onclick=()=>{const id=button.dataset.mapLoadCategory;knowledgeCategoryLimits.set(id,(knowledgeCategoryLimits.get(id)||48)+48);knowledgeExpandedCategories.add(id);renderKnowledgeMap();});
  $$('[data-map-overview-category]').forEach(button=>button.onclick=()=>{const svc=getKnowledgeService(),id=button.dataset.mapOverviewCategory;knowledgeMapMode='tree';expandKnowledgeCategoryPath(id,svc);renderKnowledgeMap();setTimeout(()=>qs(`[data-map-category-id="${CSS.escape(id)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),0);});
  $$('[data-map-collapse-detail]').forEach(button=>button.onclick=()=>{selectedKnowledgeTermId='';clearMemorizationReveal();renderKnowledgeMap();const panel=$('knowledgeDetailPanel');if(panel)panel.innerHTML='<p class="empty">用語ノードを選択すると詳細を表示します。</p>';saveKnowledgeUiState({save:true});});
  $$('[data-map-practice-term]').forEach(button=>button.onclick=()=>startKnowledgeTermPractice(button.dataset.mapPracticeTerm,false));
  $$('[data-map-related-toggle]').forEach(button=>button.onclick=()=>toggleRelatedTerms(button.dataset.mapRelatedToggle));
  $$('[data-map-related-jump]').forEach(button=>button.onclick=()=>jumpToRelatedKnowledgeTerm(button.dataset.mapRelatedJump));
  $$('[data-knowledge-detail-accordion]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();toggleKnowledgeDetailAccordion(button.dataset.knowledgeDetailAccordion);});
  $$('[data-term-explain-chatgpt]').forEach(button=>button.onclick=()=>openKnowledgeTermExplainChatGPT(button.dataset.termExplainChatgpt));
  $$('[data-map-note-term]').forEach(area=>bindKnowledgeNoteArea(area));
  $$('[data-note-move]').forEach(button=>bindKnowledgeNoteMoveButton(button));
  updateInlineNoteNavButtons();
  $$('[data-note-review-term]').forEach(select=>bindKnowledgeReviewSelect(select));
  $$('[data-note-feedback-term]').forEach(area=>bindKnowledgeFeedbackArea(area));
  $$('[data-memorization-rating-term]').forEach(button=>bindMemorizationRatingButton(button));
  observeMemorizationTerms();
  applyMemorizationCovers();
}
function renderKnowledgeDetail(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const panel=$('knowledgeDetailPanel');if(!panel)return;
  panel.innerHTML=`<div class="knowledge-detail-card" data-knowledge-detail-root aria-label="${esc(term.name)}の記述カード">${renderKnowledgeDetailContent(term,svc,'h4','panel')}</div>`;
  $$('#knowledgeDetailPanel [data-map-related-jump]').forEach(button=>button.onclick=()=>jumpToRelatedKnowledgeTerm(button.dataset.mapRelatedJump));
  $$('#knowledgeDetailPanel [data-map-practice-term]').forEach(button=>button.onclick=()=>startKnowledgeTermPractice(button.dataset.mapPracticeTerm,false));
  $$('#knowledgeDetailPanel [data-knowledge-detail-accordion]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();toggleKnowledgeDetailAccordion(button.dataset.knowledgeDetailAccordion);});
  $$('#knowledgeDetailPanel [data-term-explain-chatgpt]').forEach(button=>button.onclick=()=>openKnowledgeTermExplainChatGPT(button.dataset.termExplainChatgpt));
  $$('#knowledgeDetailPanel [data-map-note-term]').forEach(area=>bindKnowledgeNoteArea(area));
  $$('#knowledgeDetailPanel [data-note-move]').forEach(button=>bindKnowledgeNoteMoveButton(button));
  updateInlineNoteNavButtons();
  $$('#knowledgeDetailPanel [data-note-review-term]').forEach(select=>bindKnowledgeReviewSelect(select));
  $$('#knowledgeDetailPanel [data-note-feedback-term]').forEach(area=>bindKnowledgeFeedbackArea(area));
  $$('#knowledgeDetailPanel [data-memorization-rating-term]').forEach(button=>bindMemorizationRatingButton(button));
  observeMemorizationTerms();
  applyMemorizationCovers();
}
function relationTermButton(term,svc){const p=svc.progressForTerm(term.id);return `<button class="badge gray map-related-term" data-map-related-jump="${esc(term.id)}" type="button">${esc(p.statusMarker)} ${esc(term.name)}</button>`;}
function normalizeNoteContent(text){return String(text||'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();}
function compactNoteLength(text){return normalizeNoteContent(text).replace(/\s/g,'').length;}
function simpleHash(text){let h=2166136261,s=normalizeNoteContent(text);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
function legacyKnowledgeNote(term){if(!term)return '';if(term.appTermId)return readTermState(term.appTermId).note||'';const item=(state.knowledgeNotes||{})[term.id];return typeof item==='string'?item:(item&&item.note)||'';}
function getTermNoteRecord(term,create=false){
  if(!term)return emptyTermNoteRecord();
  if(!state.termNotes||typeof state.termNotes!=='object')state.termNotes={};
  let record=state.termNotes[term.id];
  if(record)record=state.termNotes[term.id]=migrateTermNoteRecord(record);
  if(!record&&create){record=state.termNotes[term.id]=emptyTermNoteRecord(legacyKnowledgeNote(term));if(record.content)record.updatedAt=new Date().toISOString();}
  return record||emptyTermNoteRecord(legacyKnowledgeNote(term));
}
function readKnowledgeTermNote(term){return getTermNoteRecord(term,false).content||'';}
function saveKnowledgeTermNote(termId,value){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const note=String(value||''),now=new Date().toISOString(),record=getTermNoteRecord(term,true);
  const previousHash=simpleHash(record.content),nextHash=simpleHash(note);
  record.content=note;record.updatedAt=now;
  if(previousHash!==nextHash&&record.lastSubmittedHash&&nextHash!==record.lastSubmittedHash){record.reviewStatus='unreviewed';record.reviewedAt=null;}
  record.writingStatus=writingStatusForRecord(record).key;
  if(term.appTermId){const writable=getTermState(term.appTermId);writable.note=note;writable.updatedAt=localDate();}
  else {if(!state.knowledgeNotes||typeof state.knowledgeNotes!=='object')state.knowledgeNotes={};state.knowledgeNotes[term.id]={note,updatedAt:now};}
  saveState(false);
  if(currentView==='map')updateNoteSubmissionIndicators();
}
function writingStatusForRecord(record){
  const content=normalizeNoteContent(record.content),hash=simpleHash(content),len=compactNoteLength(content);
  if(!len)return {key:'empty',label:'未記入',score:0,className:'gray'};
  if(record.reviewStatus==='correct')return {key:'confirmed',label:'確認済み',score:100,className:'good'};
  if(record.reviewStatus==='needs_fix')return {key:'revise',label:'要修正',score:65,className:'bad'};
  if(record.reviewStatus==='insufficient')return {key:'insufficient',label:'理解不足',score:40,className:'bad'};
  if(record.reviewStatus==='needs_recheck')return {key:'written',label:'再確認待ち',score:70,className:''};
  if(record.lastSubmittedHash&&record.lastSubmittedHash===hash)return {key:'pending',label:'確認待ち',score:75,className:''};
  if(len>=NOTE_MIN_CHARS)return {key:'written',label:'記入済み',score:55,className:'good'};
  return {key:'short',label:'下書き',score:25,className:'gray'};
}
function writingProgressForTerm(term){return writingStatusForRecord(getTermNoteRecord(term,false));}
function testProgressForTerm(term,svc){
  const p=svc.progressForTerm(term.id),total=p.totalAttempts,acc=total?Math.round(p.correctAttempts/total*100):0;
  if(!total)return {key:'untested',label:'未出題',score:0,summary:'未出題',className:'gray'};
  if(p.status==='weak')return {key:'weak',label:'苦手',score:Math.max(12,acc),summary:`${formatProgressCount(p.correctAttempts)}/${formatProgressCount(total)}正解 ${acc}%`,className:'bad'};
  if(p.status==='mastered')return {key:'mastered',label:'習得済み',score:p.masteryScore,summary:`${formatProgressCount(p.correctAttempts)}/${formatProgressCount(total)}正解 ${acc}%`,className:'good'};
  return {key:'learning',label:'学習中',score:p.masteryScore,summary:`${formatProgressCount(p.correctAttempts)}/${formatProgressCount(total)}正解 ${acc}%`,className:''};
}
function writingDoneForTerm(term){return ['written','pending','confirmed','revise','insufficient'].includes(writingProgressForTerm(term).key);}
function testAttemptedForTerm(term,svc){return testProgressForTerm(term,svc).key!=='untested';}
function testMasteredForTerm(term,svc){return testProgressForTerm(term,svc).key==='mastered';}
function percent(count,total){return total?Math.round(count/total*100):0;}
function writingTestStats(terms,svc){
  const total=terms.length,stats={total,writingDone:0,writingPending:0,writingConfirmed:0,writingNeedsFix:0,testAttempted:0,testMastered:0,bothDone:0,writingOnly:0,testOnly:0,bothUntouched:0};
  terms.forEach(term=>{
    const writing=writingProgressForTerm(term),done=writingDoneForTerm(term),attempted=testAttemptedForTerm(term,svc),mastered=testMasteredForTerm(term,svc);
    if(done)stats.writingDone++;
    if(writing.key==='pending')stats.writingPending++;
    if(writing.key==='confirmed')stats.writingConfirmed++;
    if(writing.key==='revise'||writing.key==='insufficient')stats.writingNeedsFix++;
    if(attempted)stats.testAttempted++;
    if(mastered)stats.testMastered++;
    if(done&&mastered)stats.bothDone++;
    else if(done&&!attempted)stats.writingOnly++;
    else if(!done&&attempted)stats.testOnly++;
    if(!done&&!attempted)stats.bothUntouched++;
  });
  stats.writingRate=percent(stats.writingDone,total);
  stats.testAttemptedRate=percent(stats.testAttempted,total);
  stats.testMasteredRate=percent(stats.testMastered,total);
  return stats;
}
function renderWritingTestSummary(){
  const svc=getKnowledgeService();if(!svc)return;
  const stats=writingTestStats(svc.terms,svc),total=stats.total;
  $('writingTestSummary').innerHTML=[
    statusSegment('記述進捗',stats.writingDone,total,'learning'),
    statusSegment('テスト習熟',stats.testMastered,total,'mastered'),
    statusSegment('両方完了',stats.bothDone,total,'mastered'),
    statusSegment('記述だけ',stats.writingOnly,total,'learning'),
    statusSegment('テストだけ',stats.testOnly,total,'review'),
    statusSegment('両方未完了',stats.bothUntouched,total,'unlearned')
  ].join('');
  $('writingSubjectSummary').innerHTML=svc.subjects.map(subject=>{
    const terms=svc.termsForSubject(subject.id),s=writingTestStats(terms,svc);
    return `<div class="analytics-row"><strong>${esc(subject.name)}</strong><div class="progress-split compact"><div><span>記述</span><div class="progress-track"><span style="width:${s.writingRate}%"></span></div><small>${s.writingDone}/${s.total}語 ${s.writingRate}%</small></div><div><span>テスト</span><div class="progress-track"><span style="width:${s.testMasteredRate}%"></span></div><small>習得 ${s.testMastered}/${s.total}語 ${s.testMasteredRate}%</small></div></div><small>確認待ち ${s.writingPending}語・要修正 ${s.writingNeedsFix}語・出題済み ${s.testAttempted}語</small></div>`;
  }).join('');
}
function knowledgeTermPathLabel(term,svc){return svc.getCategoryPath(term.categoryId).map(x=>x.name).join(' > ')||knowledgeTermSubject(term,svc)||'知識マップ';}
function noteReviewItem(term,svc){
  const record=getTermNoteRecord(term,false),content=normalizeNoteContent(record.content),chars=compactNoteLength(content);
  if(chars<NOTE_MIN_CHARS)return null;
  const hash=simpleHash(content),path=knowledgeTermPathLabel(term,svc),subject=knowledgeTermSubject(term,svc)||path.split(' > ')[0]||'未分類';
  return {term,record,termId:term.id,name:term.name,question:knowledgeWritingQuestion(term,svc),content,hash,chars,path,subject};
}
function noteSubmissionStats(svc=getKnowledgeService()){
  if(!svc)return {neverSubmitted:0,updated:0,submittedSame:0,sendable:0};
  return svc.terms.map(term=>noteReviewItem(term,svc)).filter(Boolean).reduce((stats,item)=>{
    const last=String(item.record.lastSubmittedHash||'');
    stats.sendable++;
    if(!last)stats.neverSubmitted++;
    else if(last===item.hash)stats.submittedSame++;
    else stats.updated++;
    return stats;
  },{neverSubmitted:0,updated:0,submittedSame:0,sendable:0});
}
function chatGPTReviewRows(svc=getKnowledgeService()){
  if(!svc)return [];
  return svc.terms.map(term=>{
    const record=getTermNoteRecord(term,false),writing=writingStatusForRecord(record),content=normalizeNoteContent(record.content),hash=simpleHash(content),last=String(record.lastSubmittedHash||''),review=noteReviewDisplay(record),category=svc.getCategoryPath(term.categoryId).map(item=>item.name).join(' > ')||'知識マップ';
    const sendable=compactNoteLength(content)>=NOTE_MIN_CHARS,updated=Boolean(last&&hash!==last),neverSubmitted=sendable&&!last,pending=Boolean(last&&hash===last&&(record.reviewStatus==='unreviewed'||record.reviewStatus==='needs_recheck'));
    let filterKey='all';
    if(neverSubmitted||updated)filterKey='unsubmitted';
    else if(pending)filterKey='pending';
    else if(record.reviewStatus==='needs_fix'||record.reviewStatus==='insufficient')filterKey='needs_fix';
    else if(record.reviewStatus==='correct')filterKey='confirmed';
    return {term,record,writing,content,hash,last,review,category,sendable,updated,neverSubmitted,pending,filterKey,hasFeedback:Boolean(normalizeNoteContent(record.feedbackMemo)),applied:Boolean(record.feedbackAppliedAt)};
  }).filter(row=>row.content&&(row.sendable||row.last||row.record.reviewStatus!=='unreviewed'||row.hasFeedback));
}
function chatGPTReviewStats(svc=getKnowledgeService()){
  return chatGPTReviewRows(svc).reduce((stats,row)=>{
    if(row.neverSubmitted||row.updated)stats.unsubmitted++;
    if(row.pending)stats.pending++;
    if(row.record.reviewStatus==='needs_fix'||row.record.reviewStatus==='insufficient')stats.needsFix++;
    if(row.record.reviewStatus==='correct')stats.confirmed++;
    if(row.record.reviewStatus==='needs_recheck')stats.needsRecheck++;
    return stats;
  },{unsubmitted:0,pending:0,needsFix:0,confirmed:0,needsRecheck:0});
}
function syncChatGPTReviewFilterTabs(){
  $$('[data-chatgpt-review-filter]').forEach(button=>{
    const active=(button.dataset.chatgptReviewFilter||'all')===chatgptReviewFilter;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',active?'true':'false');
  });
}
function chatGPTReviewFilterMatch(row){
  if(chatgptReviewFilter==='all')return true;
  if(chatgptReviewFilter==='unsubmitted')return row.neverSubmitted||row.updated;
  if(chatgptReviewFilter==='pending')return row.pending||row.record.reviewStatus==='needs_recheck';
  if(chatgptReviewFilter==='needs_fix')return row.record.reviewStatus==='needs_fix'||row.record.reviewStatus==='insufficient';
  if(chatgptReviewFilter==='confirmed')return row.record.reviewStatus==='correct';
  return true;
}
function selectedChatGPTSubject(){return $('chatgptSubjectFilter')?.value||'';}
function termsForChatGPTScope(scope,svc){
  if(scope==='selected')return selectedKnowledgeTermId?(svc.getTerm(selectedKnowledgeTermId)?[svc.getTerm(selectedKnowledgeTermId)]:[]):[];
  if(scope==='subject'){const subject=selectedChatGPTSubject();return subject?svc.terms.filter(term=>knowledgeTermSubject(term,svc)===subject):[];}
  if(scope==='custom')return [...chatgptSelectedTermIds].map(id=>svc.getTerm(id)).filter(Boolean);
  return svc.terms;
}
function collectNoteSubmissionItems(scope='unsubmitted',includeSubmitted=false,svc=getKnowledgeService()){
  if(!svc)return {items:[],excludedCount:0,sendableCount:0,scope};
  const selected=selectedKnowledgeTermId?svc.getTerm(selectedKnowledgeTermId):null,terms=termsForChatGPTScope(scope,svc);
  const sendable=terms.map(term=>noteReviewItem(term,svc)).filter(Boolean);
  const items=sendable.filter(item=>includeSubmitted||item.hash!==String(item.record.lastSubmittedHash||''));
  return {items,excludedCount:sendable.length-items.length,sendableCount:sendable.length,scope,selectedMissing:scope==='selected'&&!selected};
}
function splitNoteItems(items){
  const batches=[];let current=[],chars=0;
  items.forEach(item=>{
    const itemChars=item.name.length+item.question.length+item.content.length+80;
    if(current.length&&(current.length>=NOTE_BATCH_MAX_TERMS||chars+itemChars>NOTE_BATCH_MAX_CHARS)){batches.push({items:current,totalCharacters:chars});current=[];chars=0;}
    current.push(item);chars+=itemChars;
  });
  if(current.length)batches.push({items:current,totalCharacters:chars});
  return batches;
}
function formatDateTime(value){if(!value)return '未記録';return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function summarizeItemSubjects(items){const values=unique(items.map(item=>item.subject));return values.length>3?`${values.slice(0,3).join('、')}ほか`:values.join('、')||'未分類';}
function buildNoteBatchPrompt(batch,index,total,createdAt){
  const items=batch.items,first=items[0],last=items[items.length-1],subject=summarizeItemSubjects(items),range=`${first.name} 〜 ${last.name}`,batchLabel=total>1?`送信分割: 第${index+1}回 / 全${total}回\n`:''; 
  return `あなたはFE試験対策の講師です。
以下は、学習者が各用語について自分の言葉で書いた説明です。

各項目について、次の観点で判定してください。

1. 問いに正しく答えているか
2. 明確な誤りがないか
3. FE試験で必要な内容が不足していないか
4. 混同しやすい関連用語は何か
5. 「正しい」「一部修正が必要」「理解不足」の3段階で判定
6. 修正が必要な場合は、どこが違うか具体的に説明
7. 最後に、FE向けの短い模範回答を示す

出力形式:
用語:
判定:
正しい点:
修正点:
不足している点:
関連用語:
模範回答:

対象範囲:
分野: ${subject}
用語数: ${items.length}
範囲: ${range}
生成日時: ${formatDateTime(createdAt)}
${batchLabel}
---
${items.map(item=>`用語: ${item.name}
問い:
「${item.question}」

自分の記述:
「${item.content}」
---`).join('\n')}`;
}
function buildKnowledgeTermExplainPrompt(term,svc){
  const prereq=svc.getPrerequisites(term.id).map(item=>item.name).slice(0,10);
  const related=unique(relatedEntriesForTerm(term,svc,12).map(entry=>entry.name).filter(Boolean)).slice(0,12);
  const description=normalizeNoteContent(term.detailedDescription||term.shortDescription||'説明は未登録です。');
  const example=normalizeNoteContent(term.example||'');
  return `あなたはFE試験対策の講師です。
「${term.name}」について、以下の順で説明してください。

1. 初心者向けの短い定義
2. FEで問われやすいポイント
3. 計算方法または仕組み
4. 間違えやすい点
5. 関連用語との違い
6. 確認問題を1問

現在アプリに登録されている説明:
「${description}」
${example?`\n具体例:\n「${example}」`:''}

前提用語:
${prereq.length?prereq.join('、'):'前提用語は未登録'}

関連用語:
${related.length?related.join('、'):'関連用語は未登録'}

重要度: ${term.importance}/5
難易度: ${term.difficulty}/5

注意:
- 基本情報技術者試験の範囲に絞って説明してください。
- 過去問の問題文は転載せず、オリジナルの確認問題を作ってください。`;
}
function openKnowledgeTermExplainChatGPT(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);
  if(!term){showToast('用語が見つかりません');return;}
  const prompt=buildKnowledgeTermExplainPrompt(term,svc);
  copyText(prompt,'ChatGPT用の説明質問をコピーしました');
  const opened=window.open(CHATGPT_URL,'_blank','noopener');
  if(!opened)showToast('質問文をコピーしました。ChatGPTに貼り付けてください');
}
function batchStatusLabel(status){return {prepared:'準備済み',copied:'ChatGPTへコピー済み',openedInChatGPT:'ChatGPTを開きました',completed:'確認済み',cancelled:'キャンセル'}[status]||status;}
function renderChatGPTTargetPicker(svc=getKnowledgeService()){
  if(!svc||!$('chatgptSubjectFilter'))return;
  const subjectSelect=$('chatgptSubjectFilter'),currentSubject=subjectSelect.value;
  subjectSelect.innerHTML='<option value="">すべての分野</option>'+svc.subjects.map(subject=>`<option value="${esc(subject.name)}">${esc(subject.name)}</option>`).join('');
  if([...subjectSelect.options].some(option=>option.value===currentSubject))subjectSelect.value=currentSubject;
  const subject=subjectSelect.value,termSelect=$('chatgptTermSelect');
  if(termSelect){
    const terms=svc.terms.filter(term=>!subject||knowledgeTermSubject(term,svc)===subject).map(term=>noteReviewItem(term,svc)).filter(Boolean).slice(0,500);
    termSelect.innerHTML='<option value="">用語を選択</option>'+terms.map(item=>`<option value="${esc(item.termId)}">${esc(item.name)} / ${esc(item.subject)}</option>`).join('');
  }
  renderChatGPTSelectedTerms(svc);
}
function renderChatGPTSelectedTerms(svc=getKnowledgeService()){
  const box=$('chatgptSelectedTerms');if(!box||!svc)return;
  const terms=[...chatgptSelectedTermIds].map(id=>svc.getTerm(id)).filter(Boolean);
  box.innerHTML=terms.length?terms.map(term=>`<span class="selected-term-chip"><span class="selected-term-chip-name">${esc(term.name)}</span><button data-remove-chatgpt-term="${esc(term.id)}" type="button" aria-label="${esc(term.name)}を対象から外す">×</button></span>`).join(''):'<p class="empty compact">選択した用語はありません。</p>';
  $$('[data-remove-chatgpt-term]').forEach(button=>button.onclick=()=>{chatgptSelectedTermIds.delete(button.dataset.removeChatgptTerm);renderNoteSubmissionPanel(svc);});
}
function addChatGPTSelectedTerm(){
  const id=$('chatgptTermSelect')?.value||'';
  if(!id){showToast('追加する用語を選択してください');return;}
  chatgptSelectedTermIds.add(id);
  renderNoteSubmissionPanel(getKnowledgeService());
}
function renderNoteSubmissionPanel(svc=getKnowledgeService()){
  if(!$('noteBatchReadyCount')||!svc)return;
  const include=$('includeSubmittedNotes')?.checked||false,unsubmitted=collectNoteSubmissionItems('unsubmitted',include,svc),deduped=collectNoteSubmissionItems('unsubmitted',false,svc),submitted=collectNoteSubmissionItems('unsubmitted',true,svc).sendableCount-deduped.items.length,selected=collectNoteSubmissionItems('selected',include,svc);
  const subject=collectNoteSubmissionItems('subject',include,svc),custom=collectNoteSubmissionItems('custom',include,svc),stats=noteSubmissionStats(svc);
  const reviewStats=chatGPTReviewStats(svc);
  $('noteBatchReadyCount').textContent=`${unsubmitted.items.length}語`;
  $('chatgptBatchStats').innerHTML=`<span><b>${stats.neverSubmitted}</b><small>未送信</small></span><span><b>${stats.updated}</b><small>更新あり</small></span><span><b>${stats.submittedSame}</b><small>前回送信済み</small></span>`;
  if($('chatgptReviewStats'))$('chatgptReviewStats').innerHTML=`<span><b>${reviewStats.pending}</b><small>確認待ち</small></span><span><b>${reviewStats.needsFix}</b><small>要修正</small></span><span><b>${reviewStats.confirmed}</b><small>確認済み</small></span>`;
  if($('writingReviewPendingCount'))$('writingReviewPendingCount').textContent=reviewStats.pending+reviewStats.needsRecheck;
  if($('writingReviewFixCount'))$('writingReviewFixCount').textContent=reviewStats.needsFix;
  $('noteBatchSummary').textContent=`未送信・更新分 ${unsubmitted.items.length}語。前回送信済みの同一内容 ${Math.max(0,submitted)}語は${include?'含めます':'除外しています'}。`;
  $('prepareUnsubmittedNotesButton').disabled=unsubmitted.items.length===0;
  $('prepareSelectedNoteButton').disabled=selected.items.length===0;
  $('prepareSubjectNotesButton').disabled=subject.items.length===0;
  $('prepareChosenNotesButton').disabled=custom.items.length===0;
  renderChatGPTTargetPicker(svc);
  const history=(state.chatgptSubmissionBatches||[]).slice(0,5);
  $('chatgptBatchHistory').innerHTML=history.length?history.map(batch=>`<div class="stack-item"><span class="stack-item-main"><strong>${esc(formatDateTime(batch.createdAt))} ${esc(batch.category||'知識マップ')}</strong><small>${esc(batch.firstTerm||'')} 〜 ${esc(batch.lastTerm||'')}・${batch.itemCount}語・状態: ${esc(batchStatusLabel(batch.status))}</small></span></div>`).join(''):'<p class="empty compact">送信履歴はまだありません。</p>';
  renderChatGPTReviewList(svc);
}
function feedbackApplyModeLabel(mode){return {append:'追記',replace:'置き換え',merge:'編集統合',undo:'元に戻す'}[mode]||'未反映';}
function latestFeedbackRevision(termId){const rows=state.noteRevisionHistory?.[termId];return Array.isArray(rows)?rows.find(row=>row.source==='chatgpt-feedback'):null;}
function renderChatGPTReviewList(svc=getKnowledgeService()){
  const list=$('chatgptReviewList');if(!list||!svc)return;
  syncChatGPTReviewFilterTabs();
  const priority={needs_fix:0,insufficient:1,needs_recheck:2,unreviewed:3,correct:4};
  const rows=chatGPTReviewRows(svc).filter(chatGPTReviewFilterMatch).sort((a,b)=>(priority[a.record.reviewStatus]??9)-(priority[b.record.reviewStatus]??9)||String(b.record.updatedAt||'').localeCompare(String(a.record.updatedAt||''))).slice(0,80);
  list.innerHTML=rows.length?rows.map(row=>{
    const expanded=expandedChatgptReviewTermId===row.term.id,review=row.review,revision=latestFeedbackRevision(row.term.id),canUndo=row.applied&&revision,statusParts=[`記述: ${row.writing.label}`,`確認: ${review.label}`,row.hasFeedback?'修正メモあり':'修正メモなし'];
    if(row.updated)statusParts.push('更新あり');
    if(row.applied)statusParts.push(`反映済み ${feedbackApplyModeLabel(row.record.feedbackApplyMode)}`);
    return `<article class="chatgpt-review-item compact ${expanded?'is-open':''}" data-chatgpt-review-card="${esc(row.term.id)}"><div class="chatgpt-review-summary"><div><strong>${esc(row.term.name)}</strong><small>${esc(row.category)}</small><div class="badges compact"><span class="badge ${esc(row.writing.className)}">${esc(row.writing.label)}</span><span class="badge ${esc(review.className)}">${esc(review.label)}</span>${row.hasFeedback?'<span class="badge gray">修正メモあり</span>':'<span class="badge gray">修正メモなし</span>'}${row.updated?'<span class="badge gray">更新あり</span>':''}</div></div><button class="secondary compact" data-chatgpt-review-toggle="${esc(row.term.id)}" type="button">${expanded?'詳細を閉じる':'詳細を開く'}</button></div>${expanded?`<div class="chatgpt-review-detail"><div class="chatgpt-note-preview"><strong>現在の記述</strong><p>${esc(row.content)}</p></div><label>確認結果<select data-note-review-term="${esc(row.term.id)}">${noteReviewOptions(row.record.reviewStatus||'unreviewed')}</select></label><label>修正メモ<textarea class="feedback-note-area" data-note-feedback-term="${esc(row.term.id)}" placeholder="ChatGPTの指摘や直すポイントを書く">${esc(row.record.feedbackMemo||'')}</textarea></label><p class="help" data-feedback-save-status>修正メモは自動保存します。</p><div class="feedback-apply-status">${row.applied?`<span class="badge good">記述へ反映済み</span><small>${esc(formatDateTime(row.record.feedbackAppliedAt))} / ${esc(feedbackApplyModeLabel(row.record.feedbackApplyMode))}</small>`:'<span class="badge gray">未反映</span>'}</div><div class="chatgpt-review-actions"><button class="primary" data-apply-feedback="${esc(row.term.id)}" type="button" ${row.hasFeedback?'':'disabled'}>記述へ反映</button><button class="secondary" data-map-confirm-term="${esc(row.term.id)}" type="button">マップで確認</button><button class="secondary" data-undo-feedback="${esc(row.term.id)}" type="button" ${canUndo?'':'disabled'}>元に戻す</button></div><p class="help">${esc(statusParts.join(' / '))}</p></div>`:''}</article>`;
  }).join(''):'<p class="empty compact">条件に合う記述はありません。</p>';
  $$('#chatgptReviewList [data-chatgpt-review-toggle]').forEach(button=>button.onclick=()=>{expandedChatgptReviewTermId=expandedChatgptReviewTermId===button.dataset.chatgptReviewToggle?'':button.dataset.chatgptReviewToggle;renderChatGPTReviewList(svc);});
  $$('#chatgptReviewList [data-note-review-term]').forEach(select=>bindKnowledgeReviewSelect(select));
  $$('#chatgptReviewList [data-note-feedback-term]').forEach(area=>bindKnowledgeFeedbackArea(area));
  $$('#chatgptReviewList [data-apply-feedback]').forEach(button=>button.onclick=()=>openFeedbackApplyDialog(button.dataset.applyFeedback));
  $$('#chatgptReviewList [data-map-confirm-term]').forEach(button=>button.onclick=()=>openFeedbackTermOnMap(button.dataset.mapConfirmTerm));
  $$('#chatgptReviewList [data-undo-feedback]').forEach(button=>button.onclick=()=>undoLastFeedbackApply(button.dataset.undoFeedback));
}
function updateNoteSubmissionIndicators(){
  const svc=getKnowledgeService();if(!svc)return;
  if($('mapWritingValue'))$('mapWritingValue').textContent=writingTestStats(svc.terms,svc).writingRate+'%';
  renderNoteSubmissionPanel(svc);
}
function prepareNoteSubmission(scope){
  const include=$('includeSubmittedNotes')?.checked||false,collected=collectNoteSubmissionItems(scope,include),batches=splitNoteItems(collected.items);
  if(!batches.length){
    const messages={selected:'マップ選択中の用語に送信対象の記述がありません',subject:'選択した分野に送信対象の記述がありません',custom:'選択した用語に送信対象の記述がありません',unsubmitted:'未送信または更新済みの記述がありません'};
    showToast(messages[scope]||'送信対象の記述がありません');
    return;
  }
  pendingNoteSubmission={scope,include,createdAt:new Date().toISOString(),batches,batchIndex:0,excludedCount:collected.excludedCount,sendableCount:collected.sendableCount};
  renderNoteSubmissionDialog();
  const dialog=$('chatgptBatchDialog');if(!dialog.open)dialog.showModal();
}
function currentNoteSubmissionBatch(){return pendingNoteSubmission?.batches[pendingNoteSubmission.batchIndex]||null;}
function renderNoteSubmissionDialog(){
  const dialog=$('chatgptBatchDialog'),content=$('chatgptBatchDialogContent'),batch=currentNoteSubmissionBatch();if(!batch)return;
  const total=pendingNoteSubmission.batches.length,index=pendingNoteSubmission.batchIndex,items=batch.items,first=items[0],last=items[items.length-1],prompt=buildNoteBatchPrompt(batch,index,total,pendingNoteSubmission.createdAt);
  content.innerHTML=`<div class="dialog-head"><div><p class="eyebrow">ChatGPT prompt</p><h2>送信対象を確認</h2></div><button class="close-button" data-close-chatgpt-batch type="button">×</button></div><section class="result-insight"><h3>今回ChatGPTへ送る範囲</h3><p>${esc(summarizeItemSubjects(items))} / ${esc(first.path)} 〜 ${esc(last.path)}</p><div class="badges"><span class="badge gray">${items.length}語</span><span class="badge gray">${esc(first.name)} 〜 ${esc(last.name)}</span><span class="badge gray">推定 ${prompt.length}文字</span><span class="badge gray">第${index+1}回 / 全${total}回</span></div><p class="help">前回送信済みで変更のない記述は${pendingNoteSubmission.include?'含めています':'除外しています'}。</p></section><section class="detail-section"><h3>対象用語</h3><div class="submission-term-list">${items.map(item=>`<span>${esc(item.name)}</span>`).join('')}</div></section><section class="detail-section"><h3>プロンプト確認</h3><textarea class="prompt-preview" readonly>${esc(prompt)}</textarea></section><div class="dialog-actions tri"><button id="prevNoteBatchButton" class="secondary" type="button" ${index<=0?'disabled':''}>前の範囲</button><button id="nextNoteBatchButton" class="secondary" type="button" ${index>=total-1?'disabled':''}>次の範囲</button><button id="cancelNoteBatchButton" class="secondary" type="button">キャンセル</button><button id="copyNoteBatchPromptButton" class="primary" type="button">プロンプトをコピー</button><button id="openNoteBatchChatGPTButton" class="secondary" type="button">ChatGPTを開く</button></div>`;
  qs('[data-close-chatgpt-batch]').onclick=()=>dialog.close();
  $('cancelNoteBatchButton').onclick=()=>{dialog.close();pendingNoteSubmission=null;};
  $('prevNoteBatchButton').onclick=()=>{pendingNoteSubmission.batchIndex--;renderNoteSubmissionDialog();};
  $('nextNoteBatchButton').onclick=()=>{pendingNoteSubmission.batchIndex++;renderNoteSubmissionDialog();};
  $('copyNoteBatchPromptButton').onclick=()=>copyCurrentNoteBatchPrompt(false);
  $('openNoteBatchChatGPTButton').onclick=()=>copyCurrentNoteBatchPrompt(true);
}
function submissionBatchId(){return `note-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function markCurrentNoteBatchSubmitted(status,prompt){
  const batch=currentNoteSubmissionBatch();if(!batch)return;
  const now=new Date().toISOString();
  let id=batch.submissionId,record=id?(state.chatgptSubmissionBatches||[]).find(x=>x.id===id):null;
  if(!record){
    id=submissionBatchId();batch.submissionId=id;
    record={id,createdAt:now,termIds:batch.items.map(item=>item.termId),termNames:batch.items.map(item=>item.name),category:summarizeItemSubjects(batch.items),firstTerm:batch.items[0].name,lastTerm:batch.items[batch.items.length-1].name,itemCount:batch.items.length,totalCharacters:prompt.length,promptHash:simpleHash(prompt),status};
    state.chatgptSubmissionBatches=[record,...(state.chatgptSubmissionBatches||[])].slice(0,50);
    batch.items.forEach(item=>{
      const target=getTermNoteRecord(item.term,true);
      target.lastSubmittedContent=normalizeNoteContent(target.content);
      target.lastSubmittedHash=simpleHash(target.content);
      target.lastSubmittedAt=now;
      target.lastSubmissionBatchId=id;
      target.reviewStatus='unreviewed';
      target.reviewedAt=null;
      target.writingStatus=writingStatusForRecord(target).key;
    });
  } else {
    record.status=status==='openedInChatGPT'?'openedInChatGPT':record.status;
  }
  saveState(false);
  updateNoteSubmissionIndicators();
}
function copyCurrentNoteBatchPrompt(openChatGPT=false){
  const batch=currentNoteSubmissionBatch();if(!batch)return;
  const prompt=buildNoteBatchPrompt(batch,pendingNoteSubmission.batchIndex,pendingNoteSubmission.batches.length,pendingNoteSubmission.createdAt);
  copyText(prompt,openChatGPT?'プロンプトをコピーしました。ChatGPTを開きます':'プロンプトをコピーしました');
  markCurrentNoteBatchSubmitted(openChatGPT?'openedInChatGPT':'copied',prompt);
  renderNoteSubmissionDialog();
  if(openChatGPT){const opened=window.open(CHATGPT_URL,'_blank','noopener');if(!opened)showToast('プロンプトをコピーしました。ChatGPTに貼り付けてください');}
}
function saveKnowledgeReview(termId,{status,feedback,rerender=false,refresh=true}={}){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const record=getTermNoteRecord(term,true),now=new Date().toISOString();
  if(status!==undefined){record.reviewStatus=status||'unreviewed';record.reviewedAt=record.reviewStatus==='unreviewed'?null:now;}
  if(feedback!==undefined)record.feedbackMemo=String(feedback||'');
  record.writingStatus=writingStatusForRecord(record).key;
  saveState(false);
  if(refresh)updateNoteSubmissionIndicators();
  if(rerender&&currentView==='map'){renderKnowledgeMap();renderKnowledgeDetail(term.id);}
}
function bindKnowledgeReviewSelect(select){
  const termId=select.dataset.noteReviewTerm;
  select.onchange=()=>{saveKnowledgeReview(termId,{status:select.value,rerender:true});showToast('確認結果を保存しました');};
}
function bindKnowledgeFeedbackArea(area){
  const termId=area.dataset.noteFeedbackTerm,setStatus=()=>{const root=area.closest('.chatgpt-review-detail')||area.closest('[data-knowledge-detail-root]')||area.closest('.knowledge-note-section'),status=root?.querySelector('[data-feedback-save-status]')||root?.querySelector('[data-map-note-status]');if(status)status.textContent='修正メモを保存しました';};
  area.oninput=()=>{const root=area.closest('.chatgpt-review-detail')||area.closest('[data-knowledge-detail-root]')||area.closest('.knowledge-note-section'),status=root?.querySelector('[data-feedback-save-status]')||root?.querySelector('[data-map-note-status]');if(status)status.textContent='保存中...';clearTimeout(knowledgeFeedbackSaveTimer);knowledgeFeedbackSaveTimer=setTimeout(()=>{saveKnowledgeReview(termId,{feedback:area.value,refresh:false});setStatus();},700);};
  area.onblur=()=>{clearTimeout(knowledgeFeedbackSaveTimer);saveKnowledgeReview(termId,{feedback:area.value});setStatus();};
}
function noteRevisionId(){return `note-revision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function pushNoteRevision(termId,{previousContent,newContent,source='chatgpt-feedback',applyMode=''}){
  if(!state.noteRevisionHistory||typeof state.noteRevisionHistory!=='object')state.noteRevisionHistory={};
  const id=String(termId||'');if(!id)return;
  const row={id:noteRevisionId(),changedAt:new Date().toISOString(),previousContent:String(previousContent||''),newContent:String(newContent||''),source,applyMode};
  state.noteRevisionHistory[id]=[row,...(Array.isArray(state.noteRevisionHistory[id])?state.noteRevisionHistory[id]:[])].slice(0,NOTE_REVISION_HISTORY_LIMIT);
}
function persistKnowledgeTermNoteContent(term,record,note,now){
  record.content=String(note||'');
  record.updatedAt=now;
  if(term.appTermId){const writable=getTermState(term.appTermId);writable.note=record.content;writable.updatedAt=localDate();}
  else {if(!state.knowledgeNotes||typeof state.knowledgeNotes!=='object')state.knowledgeNotes={};state.knowledgeNotes[term.id]={note:record.content,updatedAt:now};}
}
function mergedFeedbackDraft(current,memo){return [normalizeNoteContent(current),normalizeNoteContent(memo)].filter(Boolean).join('\n\n');}
function openFeedbackApplyDialog(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term){showToast('対象の用語が見つかりません');return;}
  const record=getTermNoteRecord(term,true),memo=normalizeNoteContent(record.feedbackMemo),current=record.content||'';
  if(!memo){showToast('反映する修正メモがありません');return;}
  pendingFeedbackApplyTermId=term.id;
  const dialog=$('feedbackApplyDialog'),content=$('feedbackApplyDialogContent');if(!dialog||!content)return;
  content.innerHTML=`<div class="dialog-head"><div><p class="eyebrow">Apply feedback</p><h2>「${esc(term.name)}」の記述へ修正内容を反映します</h2></div><button class="close-button" data-close-feedback-apply type="button">×</button></div><section class="feedback-apply-preview"><h3>現在の記述</h3><p>${esc(current||'未記入')}</p></section><section class="feedback-apply-preview"><h3>修正メモ</h3><p>${esc(memo)}</p></section><section class="feedback-apply-method"><h3>反映方法</h3><label class="radio-row"><input name="feedbackApplyMode" value="append" type="radio">現在の記述の末尾へ追記</label><label class="radio-row"><input name="feedbackApplyMode" value="replace" type="radio">現在の記述を修正メモで置き換え</label><label class="radio-row"><input name="feedbackApplyMode" value="merge" type="radio" checked>編集画面で統合してから保存</label><textarea id="feedbackMergeArea" class="feedback-merge-area">${esc(mergedFeedbackDraft(current,memo))}</textarea></section><div class="dialog-actions"><button class="secondary" data-close-feedback-apply type="button">キャンセル</button><button id="applyFeedbackButton" class="primary" type="button">反映する</button></div>`;
  $$('[data-close-feedback-apply]').forEach(button=>button.onclick=()=>dialog.close());
  $('applyFeedbackButton').onclick=applyFeedbackToNote;
  if(!dialog.open)dialog.showModal();
}
function applyFeedbackToNote(){
  const termId=pendingFeedbackApplyTermId,svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const record=getTermNoteRecord(term,true),current=String(record.content||''),memo=normalizeNoteContent(record.feedbackMemo),mode=qs('input[name="feedbackApplyMode"]:checked')?.value||'merge';
  const mergeValue=$('feedbackMergeArea')?.value||'';
  const next=mode==='append'?mergedFeedbackDraft(current,memo):(mode==='replace'?memo:mergeValue);
  const now=new Date().toISOString();
  pushNoteRevision(term.id,{previousContent:current,newContent:next,source:'chatgpt-feedback',applyMode:mode});
  persistKnowledgeTermNoteContent(term,record,next,now);
  record.feedbackAppliedAt=now;
  record.feedbackApplyMode=mode;
  record.feedbackAppliedContent=next;
  record.reviewStatus='needs_recheck';
  record.reviewedAt=now;
  record.writingStatus=writingStatusForRecord(record).key;
  saveState(false);
  $('feedbackApplyDialog')?.close();
  pendingFeedbackApplyTermId='';
  showToast('修正メモを記述へ反映しました');
  updateNoteSubmissionIndicators();
  if(currentView==='map'){renderKnowledgeMap();renderKnowledgeDetail(term.id);}
  if(currentView==='review')renderReview();
}
function undoLastFeedbackApply(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId),last=latestFeedbackRevision(termId);
  if(!term||!last){showToast('元に戻せる履歴がありません');return;}
  const record=getTermNoteRecord(term,true),current=String(record.content||''),now=new Date().toISOString();
  pushNoteRevision(term.id,{previousContent:current,newContent:last.previousContent,source:'chatgpt-feedback-undo',applyMode:'undo'});
  persistKnowledgeTermNoteContent(term,record,last.previousContent,now);
  record.feedbackAppliedAt=null;
  record.feedbackApplyMode='undo';
  record.feedbackAppliedContent='';
  record.reviewStatus='needs_recheck';
  record.reviewedAt=now;
  record.writingStatus=writingStatusForRecord(record).key;
  saveState(false);
  showToast('直前の反映を元に戻しました');
  updateNoteSubmissionIndicators();
  if(currentView==='map'){renderKnowledgeMap();renderKnowledgeDetail(term.id);}
  if(currentView==='review')renderReview();
}
function openFeedbackTermOnMap(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);
  if(!term){showToast('マップ内に対象用語が見つかりません');return;}
  navTo('map');
  setTimeout(()=>{
    if(!selectKnowledgeTerm(term.id,{scroll:true,highlight:true}))return;
    if(memorizationRuntime.enabled){memorizationRuntime.manualToggleTermId=term.id;applyMemorizationCovers();}
    setTimeout(()=>{
      const area=qs(`[data-map-note-term="${CSS.escape(term.id)}"]`);
      if(area){area.classList.add('note-applied-highlight');area.focus({preventScroll:true});setTimeout(()=>area.classList.remove('note-applied-highlight'),2600);}
    },180);
  },60);
}
function bindMemorizationRatingButton(button){
  button.onclick=()=>saveMemorizationRating(button.dataset.memorizationRatingTerm,button.dataset.memorizationRating);
}
function addMemorizationReviewCandidate(term,rating){
  if(!term?.appTermId||rating==='known')return;
  const target=rating==='unknown'?localDate():addDays(localDate(),1),s=getTermState(term.appTermId),reason=rating==='unknown'?'暗記で覚えていなかった':'暗記であいまい';
  if(!reviewDate(s)||reviewDate(s)>target){s.due=target;s.nextReview=target;}
  s.mastery=Math.max(Number(s.mastery)||0,1);
  s.last=s.last||localDate();
  s.updatedAt=localDate();
  s.weakReasons=unique([...(Array.isArray(s.weakReasons)?s.weakReasons:[]),reason]);
  const appTerm=term.appTerm||termById.get(String(term.appTermId));
  if(appTerm)s.reviewPriority=reviewPriority(appTerm);
}
function saveMemorizationRating(termId,rating){
  if(!['known','unsure','unknown'].includes(rating))return;
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  const record=getMemorizationRatingRecord(term.id,true),now=new Date().toISOString();
  record.lastRating=rating;
  record.ratedAt=now;
  if(rating==='known')record.knownCount++;
  if(rating==='unsure')record.unsureCount++;
  if(rating==='unknown')record.unknownCount++;
  addMemorizationReviewCandidate(term,rating);
  saveState(false);
  showToast(`${memorizationRatingLabel(rating)}を保存しました`);
  if(currentView==='map'){renderKnowledgeMap();renderKnowledgeDetail(term.id);}
}
function handleKnowledgeCompositionStart(e){if(e.target?.matches?.('.knowledge-note-area')){knowledgeNoteComposing=true;knowledgeCompositionBlockUntil=Date.now()+800;}}
function handleKnowledgeCompositionEnd(e){if(e.target?.matches?.('.knowledge-note-area')){knowledgeNoteComposing=false;knowledgeCompositionBlockUntil=Date.now()+300;}}
function bindKnowledgeNoteArea(area){
  const section=area.closest('.knowledge-note-section'),status=section?.querySelector('[data-map-note-status]'),termId=area.dataset.mapNoteTerm;
  const setStatus=msg=>{if(status)status.textContent=msg;};
  const saveNow=()=>{clearTimeout(knowledgeNoteSaveTimer);saveKnowledgeTermNote(termId,area.value);setStatus('保存しました');};
  area.oninput=()=>{setStatus('保存中...');clearTimeout(knowledgeNoteSaveTimer);knowledgeNoteSaveTimer=setTimeout(saveNow,600);};
  area.oncompositionstart=handleKnowledgeCompositionStart;
  area.oncompositionend=handleKnowledgeCompositionEnd;
  area.onfocus=()=>{activeKnowledgeNoteTermId=termId;updateInlineNoteNavButtons();};
  area.onblur=()=>{saveNow();};
}
function visibleKnowledgeTermIds(){return $$('.knowledge-node[data-map-term-id]').map(button=>button.dataset.mapTermId).filter(Boolean);}
function bindKnowledgeNoteMoveButton(button){
  button.onclick=()=>{activeKnowledgeNoteTermId=button.dataset.noteMoveTerm||selectedKnowledgeTermId;navigateKnowledgeNote(Number(button.dataset.noteMove)||0);};
}
function updateInlineNoteNavButtons(){
  const ids=visibleKnowledgeTermIds();
  $$('[data-note-move]').forEach(button=>{
    const termId=button.dataset.noteMoveTerm,idx=ids.indexOf(termId),direction=Number(button.dataset.noteMove)||0;
    button.disabled=idx<0||!ids[idx+direction];
  });
}
function focusKnowledgeNoteTerm(termId){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  knowledgeMapMode='tree';selectedKnowledgeTermId=termId;clearMemorizationReveal();expandKnowledgeCategoryPath(term.categoryId,svc);renderKnowledgeMap();renderKnowledgeDetail(termId);
  setTimeout(()=>{
    const node=qs(`.knowledge-node[data-map-term-id="${CSS.escape(termId)}"]`),area=qs(`.knowledge-note-area[data-map-note-term="${CSS.escape(termId)}"]`);
    node?.scrollIntoView({behavior:'smooth',block:'center'});area?.focus({preventScroll:true});
    if(area){area.selectionStart=area.selectionEnd=area.value.length;activeKnowledgeNoteTermId=termId;updateInlineNoteNavButtons();applyMemorizationCovers();}
  },0);
}
function navigateKnowledgeNote(direction){
  if(knowledgeNoteComposing||Date.now()<knowledgeCompositionBlockUntil)return;
  const current=qs(`.knowledge-note-area[data-map-note-term="${CSS.escape(activeKnowledgeNoteTermId||selectedKnowledgeTermId)}"]`);
  if(current)saveKnowledgeTermNote(current.dataset.mapNoteTerm,current.value);
  const ids=visibleKnowledgeTermIds(),idx=ids.indexOf(activeKnowledgeNoteTermId||selectedKnowledgeTermId),next=ids[idx+direction];
  if(!next)return;
  clearMemorizationReveal();
  focusKnowledgeNoteTerm(next);
}
function handleKnowledgeNoteKeydown(e){
  if(!e.ctrlKey||knowledgeNoteComposing||Date.now()<knowledgeCompositionBlockUntil||!e.target?.matches?.('.knowledge-note-area'))return;
  if(e.key==='ArrowUp'){e.preventDefault();navigateKnowledgeNote(-1);}
  if(e.key==='ArrowDown'){e.preventDefault();navigateKnowledgeNote(1);}
}
function memorizationSettings(){
  state.settings=state.settings&&typeof state.settings==='object'?state.settings:defaultState().settings;
  state.settings.memorization=migrateMemorizationSettings(state.settings.memorization);
  return state.settings.memorization;
}
function hydrateMemorizationRuntime(){
  const settings=memorizationSettings();
  memorizationRuntime.enabled=Boolean(settings.enabled);
  if(!memorizationRuntime.enabled)settings.sensorEnabled=false;
  memorizationRuntime.sensorWanted=memorizationRuntime.enabled&&Boolean(settings.sensorEnabled);
  memorizationRuntime.sensorState=memorizationRuntime.enabled?(memorizationRuntime.sensorWanted?'許可待ち':'ボタン操作のみ'):'センサ未開始';
  memorizationRuntime.sensorMessage=memorizationRuntime.enabled?'暗記モード中です':'暗記モードはOFFです';
  memorizationRuntime.panelCollapsed=true;
}
function bindMemorizationControls(){
  const mode=$('memorizationModeToggle'),sensor=$('memorizationSensorToggle'),reveal=$('memorizationRevealButton'),all=$('memorizationAllButton'),recalibrate=$('memorizationRecalibrateButton'),panelToggle=$('memorizationPanelToggle');
  if(!mode||!sensor||!reveal||!all||!recalibrate)return;
  mode.addEventListener('change',()=>setMemorizationMode(mode.checked,{persist:true,userGesture:true}));
  sensor.addEventListener('change',()=>setMemorizationSensor(sensor.checked,{persist:true,userGesture:true}));
  reveal.addEventListener('pointerdown',event=>{
    if(memorizationSettings().manualMode!=='hold'||!memorizationRuntime.enabled)return;
    event.preventDefault();
    reveal.setPointerCapture?.(event.pointerId);
    startManualMemorizationReveal();
  });
  ['pointerup','pointercancel','pointerleave'].forEach(type=>reveal.addEventListener(type,event=>{
    if(memorizationSettings().manualMode!=='hold')return;
    event.preventDefault();
    stopManualMemorizationReveal();
  }));
  reveal.addEventListener('click',()=>{
    if(memorizationSettings().manualMode==='tap')toggleManualMemorizationReveal();
  });
  reveal.addEventListener('contextmenu',event=>event.preventDefault());
  all.addEventListener('click',()=>toggleAllMemorizationAnswers());
  recalibrate.addEventListener('click',()=>recalibrateMemorizationSensor(true));
  panelToggle?.addEventListener('click',()=>{
    memorizationRuntime.panelCollapsed=!memorizationRuntime.panelCollapsed;
    renderMemorizationPanel();
  });
}
async function setMemorizationMode(enabled,{persist=false,userGesture=false}={}){
  const settings=memorizationSettings();
  memorizationRuntime.enabled=Boolean(enabled);
  settings.enabled=memorizationRuntime.enabled;
  clearMemorizationReveal();
  if(memorizationRuntime.enabled){
    memorizationRuntime.sensorWanted=Boolean(settings.sensorEnabled);
    memorizationRuntime.sensorState=memorizationRuntime.sensorWanted?'許可待ち':'ボタン操作のみ';
    memorizationRuntime.sensorMessage=memorizationRuntime.sensorWanted?'センサ許可を確認します':'端末を傾けずボタンだけで使えます';
    if(memorizationRuntime.sensorWanted)memorizationRuntime.panelCollapsed=false;
    recalibrateMemorizationSensor(false);
    if(memorizationRuntime.sensorWanted&&userGesture)await startMemorizationSensor();
  } else {
    stopMemorizationSensor('センサ未開始','暗記モードはOFFです');
    memorizationRuntime.sensorWanted=false;
    settings.sensorEnabled=false;
    resetMemorizationSensorValues();
  }
  if(persist)saveState(false);
  renderMemorizationPanel();
  applyMemorizationCovers();
}
async function setMemorizationSensor(enabled,{persist=false,userGesture=false}={}){
  const settings=memorizationSettings();
  if(enabled&&!memorizationRuntime.enabled){
    settings.sensorEnabled=false;
    memorizationRuntime.sensorWanted=false;
    stopMemorizationSensor('センサ未開始','暗記モードをONにすると利用できます');
    resetMemorizationSensorValues();
    if(persist)saveState(false);
    renderMemorizationPanel();
    applyMemorizationCovers();
    showToast('センサ操作は暗記モードON時だけ使えます');
    return false;
  }
  settings.sensorEnabled=Boolean(enabled);
  memorizationRuntime.sensorWanted=settings.sensorEnabled;
  if(settings.sensorEnabled)memorizationRuntime.panelCollapsed=false;
  if(persist)saveState(false);
  if(!settings.sensorEnabled){
    stopMemorizationSensor('ボタン操作のみ','センサ操作を停止しました');
    renderMemorizationPanel();
    applyMemorizationCovers();
    return;
  }
  if(!memorizationRuntime.enabled){
    memorizationRuntime.sensorState='許可待ち';
    memorizationRuntime.sensorMessage='暗記モードON時にセンサを開始します';
    renderMemorizationPanel();
    return;
  }
  if(userGesture)await startMemorizationSensor();
  else {
    memorizationRuntime.sensorState='許可待ち';
    memorizationRuntime.sensorMessage='センサ操作ONを押すと許可を確認します';
    renderMemorizationPanel();
  }
}
async function startMemorizationSensor(){
  if(!memorizationRuntime.enabled){
    memorizationRuntime.sensorWanted=false;
    memorizationSettings().sensorEnabled=false;
    stopMemorizationSensor('センサ未開始','暗記モードをONにすると利用できます');
    renderMemorizationPanel();
    return false;
  }
  if(!('DeviceOrientationEvent' in window)){
    memorizationRuntime.sensorWanted=false;
    memorizationSettings().sensorEnabled=false;
    stopMemorizationSensor('センサ非対応','この端末ではボタン操作のみ使えます');
    saveState(false);
    renderMemorizationPanel();
    return false;
  }
  try{
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      memorizationRuntime.sensorState='許可待ち';
      memorizationRuntime.sensorMessage='iPhoneの許可ダイアログを確認してください';
      renderMemorizationPanel();
      const result=await DeviceOrientationEvent.requestPermission();
      if(result!=='granted'){
        memorizationRuntime.sensorWanted=false;
        memorizationSettings().sensorEnabled=false;
        stopMemorizationSensor('センサ拒否','許可されなかったためボタン操作のみ使えます');
        saveState(false);
        renderMemorizationPanel();
        return false;
      }
    }
    if(!memorizationRuntime.sensorListening){
      window.addEventListener('deviceorientation',handleMemorizationOrientation,true);
      memorizationRuntime.sensorListening=true;
    }
    memorizationRuntime.sensorWanted=true;
    memorizationRuntime.sensorState='センサON';
    memorizationRuntime.sensorMessage='端末を静止すると現在姿勢を基準にします';
    memorizationRuntime.baselineBeta=null;
    memorizationRuntime.baselineGamma=null;
    memorizationRuntime.samples=[];
    renderMemorizationPanel();
    return true;
  }catch(err){
    memorizationRuntime.sensorWanted=false;
    memorizationSettings().sensorEnabled=false;
    stopMemorizationSensor('センサ拒否','センサを開始できないためボタン操作のみ使えます');
    saveState(false);
    renderMemorizationPanel();
    return false;
  }
}
function stopMemorizationSensor(stateLabel='センサ未開始',message=''){
  if(memorizationRuntime.sensorListening){
    window.removeEventListener('deviceorientation',handleMemorizationOrientation,true);
    memorizationRuntime.sensorListening=false;
  }
  memorizationRuntime.sensorState=stateLabel;
  memorizationRuntime.sensorMessage=message||'ボタン操作のみで使えます';
  memorizationRuntime.sensorRevealTermId='';
  memorizationRuntime.tiltHoldStart=0;
}
function resetMemorizationSensorValues(){
  memorizationRuntime.baselineBeta=null;
  memorizationRuntime.baselineGamma=null;
  memorizationRuntime.currentBeta=null;
  memorizationRuntime.currentGamma=null;
  memorizationRuntime.tiltMagnitude=0;
  memorizationRuntime.smoothTilt=0;
  memorizationRuntime.samples=[];
  memorizationRuntime.tiltHoldStart=0;
  memorizationRuntime.lastToggleAt=0;
}
function recalibrateMemorizationSensor(notify=false){
  clearMemorizationReveal();
  memorizationRuntime.samples=[];
  memorizationRuntime.tiltMagnitude=0;
  memorizationRuntime.smoothTilt=0;
  memorizationRuntime.tiltHoldStart=0;
  if(Number.isFinite(memorizationRuntime.currentBeta)&&Number.isFinite(memorizationRuntime.currentGamma)){
    memorizationRuntime.baselineBeta=memorizationRuntime.currentBeta;
    memorizationRuntime.baselineGamma=memorizationRuntime.currentGamma;
    memorizationRuntime.sensorMessage='現在の持ち方を基準にしました';
    if(notify)showToast('センサを再調整しました');
  } else {
    memorizationRuntime.baselineBeta=null;
    memorizationRuntime.baselineGamma=null;
    memorizationRuntime.sensorMessage='端末を0.5秒ほど静止してください';
    if(notify)showToast('センサ値を待っています');
  }
  renderMemorizationPanel();
  applyMemorizationCovers();
}
function handleMemorizationOrientation(event){
  const beta=Number(event.beta),gamma=Number(event.gamma);
  if(!Number.isFinite(beta)||!Number.isFinite(gamma))return;
  memorizationRuntime.currentBeta=beta;
  memorizationRuntime.currentGamma=gamma;
  if(!memorizationRuntime.enabled||!memorizationRuntime.sensorListening)return;
  if(memorizationRuntime.baselineBeta===null||memorizationRuntime.baselineGamma===null){
    memorizationRuntime.baselineBeta=beta;
    memorizationRuntime.baselineGamma=gamma;
    memorizationRuntime.sensorMessage='基準姿勢を設定しました';
  }
  const now=Date.now();
  if(document.hidden||now<memorizationRotationPauseUntil){
    memorizationRuntime.sensorRevealTermId='';
    renderMemorizationPanel();
    applyMemorizationCovers();
    return;
  }
  const settings=memorizationSettings();
  const deltaBeta=beta-memorizationRuntime.baselineBeta,deltaGamma=gamma-memorizationRuntime.baselineGamma,magnitude=Math.sqrt(deltaBeta*deltaBeta+deltaGamma*deltaGamma);
  memorizationRuntime.tiltMagnitude=magnitude;
  memorizationRuntime.samples.push(magnitude);
  if(memorizationRuntime.samples.length>8)memorizationRuntime.samples.shift();
  memorizationRuntime.smoothTilt=memorizationRuntime.samples.reduce((sum,value)=>sum+value,0)/memorizationRuntime.samples.length;
  if(memorizationRuntime.allVisible||memorizationRuntime.manualRevealTermId||memorizationRuntime.manualToggleTermId){
    renderMemorizationPanel();
    return;
  }
  if(memorizationRuntime.sensorRevealTermId){
    if(memorizationRuntime.smoothTilt<=settings.hideThreshold&&now-memorizationRuntime.lastToggleAt>=300){
      memorizationRuntime.sensorRevealTermId='';
      memorizationRuntime.tiltHoldStart=0;
      memorizationRuntime.lastToggleAt=now;
      applyMemorizationCovers();
    }
  } else if(memorizationRuntime.smoothTilt>=settings.showThreshold){
    if(!memorizationRuntime.tiltHoldStart)memorizationRuntime.tiltHoldStart=now;
    if(now-memorizationRuntime.tiltHoldStart>=settings.holdMs&&now-memorizationRuntime.lastToggleAt>=300){
      const target=currentMemorizationTargetTermId();
      if(target){
        memorizationRuntime.sensorRevealTermId=target;
        memorizationRuntime.lastToggleAt=now;
        applyMemorizationCovers();
      }
    }
  } else {
    memorizationRuntime.tiltHoldStart=0;
  }
  renderMemorizationPanel();
}
function handleMemorizationVisibilityChange(){
  if(!memorizationRuntime.enabled)return;
  if(document.hidden){
    memorizationRuntime.sensorRevealTermId='';
    memorizationRuntime.tiltHoldStart=0;
    memorizationRuntime.sensorMessage='一時停止しました';
    applyMemorizationCovers();
  } else if(memorizationRuntime.sensorWanted){
    memorizationRuntime.sensorMessage='復帰後は必要に応じて再調整してください';
  }
  renderMemorizationPanel();
}
function handleMemorizationOrientationChange(){
  if(!memorizationRuntime.enabled)return;
  memorizationRotationPauseUntil=Date.now()+900;
  clearMemorizationReveal();
  memorizationRuntime.sensorMessage='画面回転後は判定を一時停止しています';
  renderMemorizationPanel();
  applyMemorizationCovers();
}
function shouldRevealMemorizationTerm(termId){
  if(!memorizationRuntime.enabled)return true;
  return memorizationRuntime.allVisible||memorizationRuntime.manualRevealTermId===termId||memorizationRuntime.manualToggleTermId===termId||memorizationRuntime.sensorRevealTermId===termId;
}
function clearMemorizationReveal({clearAll=true}={}){
  memorizationRuntime.sensorRevealTermId='';
  memorizationRuntime.manualRevealTermId='';
  memorizationRuntime.manualToggleTermId='';
  memorizationRuntime.tiltHoldStart=0;
  if(clearAll)memorizationRuntime.allVisible=false;
}
function applyMemorizationCovers(){
  const active=memorizationRuntime.enabled;
  document.documentElement.classList.toggle('memorization-active',active);
  $$('[data-memorization-term]').forEach(wrapper=>{
    const termId=wrapper.dataset.memorizationTerm,hidden=active&&!shouldRevealMemorizationTerm(termId),revealed=active&&!hidden;
    wrapper.classList.toggle('is-hidden',hidden);
    wrapper.classList.toggle('is-revealed',revealed);
    const area=wrapper.querySelector('.knowledge-note-area'),cover=wrapper.querySelector('.memorization-cover');
    if(area)area.readOnly=hidden;
    if(cover)cover.setAttribute('aria-hidden',hidden?'false':'true');
  });
  renderMemorizationPanel();
}
function observeMemorizationTerms(){
  memorizationRuntime.visibleTermIds.clear();
  memorizationRuntime.observer?.disconnect();
  if(!('IntersectionObserver' in window))return;
  memorizationRuntime.observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      const id=entry.target.dataset.memorizationTerm||entry.target.dataset.mapTermId;
      if(!id)return;
      if(entry.isIntersecting)memorizationRuntime.visibleTermIds.add(id);
      else memorizationRuntime.visibleTermIds.delete(id);
    });
  },{root:null,threshold:[0,.2,.5,.8]});
  $$('[data-memorization-term], .knowledge-node[data-map-term-id]').forEach(el=>memorizationRuntime.observer.observe(el));
}
function currentMemorizationTargetTermId(){
  if(currentView!=='map')return '';
  const hasNote=id=>id&&qs(`[data-memorization-term="${CSS.escape(id)}"]`);
  if(hasNote(selectedKnowledgeTermId))return selectedKnowledgeTermId;
  if(hasNote(activeKnowledgeNoteTermId))return activeKnowledgeNoteTermId;
  const candidates=$$('[data-memorization-term], .knowledge-node[data-map-term-id]').filter(el=>{
    const id=el.dataset.memorizationTerm||el.dataset.mapTermId;
    const rect=el.getBoundingClientRect();
    return id&&rect.bottom>0&&rect.top<window.innerHeight&&rect.right>0&&rect.left<window.innerWidth&&(!memorizationRuntime.visibleTermIds.size||memorizationRuntime.visibleTermIds.has(id));
  });
  if(!candidates.length)return '';
  const centerY=window.innerHeight/2,centerX=window.innerWidth/2;
  candidates.sort((a,b)=>{
    const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();
    const ad=Math.hypot(ar.top+ar.height/2-centerY,ar.left+ar.width/2-centerX);
    const bd=Math.hypot(br.top+br.height/2-centerY,br.left+br.width/2-centerX);
    return ad-bd;
  });
  return candidates[0].dataset.memorizationTerm||candidates[0].dataset.mapTermId||'';
}
function startManualMemorizationReveal(){
  const target=currentMemorizationTargetTermId();
  if(!target){showToast('先に用語を開いてください');return;}
  memorizationRuntime.manualRevealTermId=target;
  memorizationRuntime.sensorRevealTermId='';
  applyMemorizationCovers();
}
function stopManualMemorizationReveal(){
  memorizationRuntime.manualRevealTermId='';
  applyMemorizationCovers();
}
function toggleManualMemorizationReveal(){
  if(!memorizationRuntime.enabled)return;
  const target=currentMemorizationTargetTermId();
  if(!target){showToast('先に用語を開いてください');return;}
  memorizationRuntime.manualToggleTermId=memorizationRuntime.manualToggleTermId===target?'':target;
  memorizationRuntime.sensorRevealTermId='';
  applyMemorizationCovers();
}
function toggleAllMemorizationAnswers(){
  if(!memorizationRuntime.enabled)return;
  memorizationRuntime.allVisible=!memorizationRuntime.allVisible;
  memorizationRuntime.sensorRevealTermId='';
  memorizationRuntime.manualRevealTermId='';
  memorizationRuntime.manualToggleTermId='';
  applyMemorizationCovers();
}
function memorizationDecisionText(){
  if(!memorizationRuntime.enabled)return '暗記モードOFF';
  if(memorizationRuntime.allVisible)return 'すべて表示中';
  if(memorizationRuntime.manualRevealTermId||memorizationRuntime.manualToggleTermId)return 'ボタンで表示中';
  if(memorizationRuntime.sensorRevealTermId)return '傾きで表示中';
  return '答えを隠しています';
}
function renderMemorizationPanel(){
  const mode=$('memorizationModeToggle');if(!mode)return;
  const settings=memorizationSettings(),sensor=$('memorizationSensorToggle'),badge=$('memorizationStatusBadge'),hint=$('memorizationHint'),reveal=$('memorizationRevealButton'),all=$('memorizationAllButton'),recalibrate=$('memorizationRecalibrateButton'),panel=$('memorizationSensorPanel'),panelBody=$('memorizationSensorPanelBody'),panelToggle=$('memorizationPanelToggle');
  mode.checked=memorizationRuntime.enabled;
  const sensorAvailable=memorizationRuntime.enabled;
  if(sensor){
    sensor.checked=sensorAvailable&&Boolean(settings.sensorEnabled);
    sensor.disabled=!sensorAvailable;
    sensor.setAttribute('aria-disabled',sensorAvailable?'false':'true');
    sensor.closest('label')?.classList.toggle('is-disabled',!sensorAvailable);
  }
  if(badge){badge.textContent=memorizationRuntime.enabled?'ON':'OFF';badge.classList.toggle('active',memorizationRuntime.enabled);}
  const sensorHelp=$('memorizationSensorHelp');
  if(sensorHelp)sensorHelp.classList.toggle('hidden',sensorAvailable);
  if(hint)hint.textContent=memorizationRuntime.enabled?`${memorizationDecisionText()}。${settings.manualMode==='hold'?'「現在の答えを見る」は長押し中だけ表示します。':'「現在の答えを見る」はタップで表示を切り替えます。'} ${memorizationRuntime.sensorMessage}`:'暗記モードをONにすると、自分の記述だけを隠します。センサ操作はOFFになります。';
  const target=currentMemorizationTargetTermId();
  if(reveal){reveal.disabled=!memorizationRuntime.enabled||!target;reveal.textContent=settings.manualMode==='tap'&&memorizationRuntime.manualToggleTermId?'答えを隠す':(settings.manualMode==='hold'?'長押しで答えを見る':'現在の答えを見る');}
  if(all){all.disabled=!memorizationRuntime.enabled;all.textContent=memorizationRuntime.allVisible?'すべて隠す':'すべて表示';}
  if(recalibrate)recalibrate.disabled=!memorizationRuntime.enabled||!settings.sensorEnabled;
  if(panel){
    panel.classList.toggle('hidden',!settings.panelVisible||!memorizationRuntime.enabled);
    panel.classList.toggle('is-disabled',!settings.sensorEnabled);
    panel.classList.toggle('collapsed',memorizationRuntime.panelCollapsed);
  }
  if(panelBody)panelBody.classList.toggle('hidden',memorizationRuntime.panelCollapsed);
  if(panelToggle){panelToggle.textContent=memorizationRuntime.panelCollapsed?'開く':'たたむ';panelToggle.setAttribute('aria-expanded',memorizationRuntime.panelCollapsed?'false':'true');}
  const sensorStatus=$('memorizationSensorStatus'),tiltValue=$('memorizationTiltValue'),decision=$('memorizationTiltDecision'),remaining=$('memorizationTiltRemaining'),gauge=$('memorizationTiltGauge');
  const tilt=Math.round(memorizationRuntime.smoothTilt||0),show=Math.round(settings.showThreshold),left=Math.max(0,show-tilt);
  if(sensorStatus)sensorStatus.textContent=memorizationRuntime.sensorState;
  if(tiltValue)tiltValue.textContent=`${tilt}°`;
  if(decision)decision.textContent=memorizationDecisionText();
  if(remaining)remaining.textContent=left?`あと${left}°`:'表示しきい値以上';
  if(gauge)gauge.style.width=`${clamp((memorizationRuntime.smoothTilt||0)/settings.showThreshold*100,0,100)}%`;
}
function startKnowledgeTermStudy(termId){const term=getKnowledgeService()?.getTerm(termId);if(!term||!term.appTermId){showToast('既存の用語データに接続されていません');return;}openTerm(term.appTermId);}
function quizSessionId(){return `quiz-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;}
function quizItemTargetId(item){return String(item?.target?.id??'');}
function quizItemSystem(item){return String(item?.source==='subjectA'?item.target?.system:item?.target?.['系']||'');}
function quizSourceLabel(value){return value==='subjectA'?'科目A':'用語4択';}
function quizModeLabel(value){return ({recommended:'おすすめ',random:'ランダム',weak:'苦手優先',wrong:'誤答復習',due:'復習期限',unlearned:'未学習優先',knowledge:'知識マップ',retry:'復習',mock:'模試形式'})[value]||value||'おすすめ';}
function quizTypeLabel(value){return ({mixed:'ミックス',description:'説明 → 用語',term:'用語 → 説明',mock:'模試形式',subjectA:'科目A'})[value]||value||'ミックス';}
function quizSystemLabel(value){return value||'全分野';}
function quizAnsweredCount(target=quiz){return target?.items?.filter(item=>item.graded).length||0;}
function normalizeQuizIndex(target=quiz){
  if(!target?.items?.length)return 0;
  const firstOpen=target.items.findIndex(item=>!item.graded);
  return firstOpen>=0?firstOpen:target.items.length;
}
function recalcQuizScore(target=quiz){
  if(!target)return 0;
  target.correct=target.items.filter(item=>item.graded&&item.correct).length;
  target.results=target.items.filter(item=>item.graded).map(item=>({id:quizItemTargetId(item),correct:Boolean(item.correct),source:target.source,system:quizItemSystem(item)}));
  return target.correct;
}
function serializableQuizDraft(target=quiz){
  if(!target?.items?.length||target.completed)return null;
  recalcQuizScore(target);
  return {
    sessionId:target.sessionId||quizSessionId(),
    startedAt:Number(target.startedAt)||Date.now(),
    updatedAt:Date.now(),
    source:target.source==='subjectA'?'subjectA':'terms',
    mode:String(target.mode||'recommended'),
    system:String(target.system||''),
    type:String(target.type||'mixed'),
    length:target.items.length,
    index:clamp(Number(target.index)||0,0,Math.max(0,target.items.length-1)),
    correct:target.correct,
    answered:Boolean(target.answered),
    questionIds:target.items.map(quizItemTargetId),
    items:target.items,
    results:target.results,
    completed:false
  };
}
function persistQuizDraft(){
  const draft=serializableQuizDraft();
  if(!draft)return;
  state.quizDraft=draft;
  saveState(false);
}
function clearQuizDraft(save=true){
  state.quizDraft=null;
  if(save)saveState(false);
}
function showQuizSetup(){
  quiz=null;
  $('quizSetup').classList.remove('hidden');
  $('quizArea').classList.add('hidden');
  $('quizSessionStatus').textContent='';
  renderQuizDraftPanel();
}
function pauseQuizToSetup({message='途中の演習を保存しました'}={}){
  if(!quiz)return showQuizSetup();
  if(quiz.items?.[quiz.index]?.graded&&quiz.index<quiz.items.length-1)quiz.index=normalizeQuizIndex(quiz);
  quiz.answered=Boolean(quiz.items?.[quiz.index]?.graded);
  persistQuizDraft();
  showQuizSetup();
  showToast(message);
}
function resumeQuizDraft(){
  const draft=migrateQuizDraft(state.quizDraft);
  if(!draft){clearQuizDraft();showToast('再開できる途中演習がありません');renderQuizDraftPanel();return;}
  quiz=draft;
  quiz.index=normalizeQuizIndex(quiz);
  quiz.answered=Boolean(quiz.items?.[quiz.index]?.graded);
  state.quizDraft=serializableQuizDraft(quiz);
  saveState(false);
  $('quizSource').value=quiz.source;
  $('quizMode').value=quiz.mode==='knowledge'||quiz.mode==='retry'?'recommended':quiz.mode;
  $('quizSystem').value=quiz.system||'';
  $('quizLength').value=String([5,10,20].includes(quiz.length)?quiz.length:10);
  $('quizType').value=quiz.source==='subjectA'&&quiz.mode==='mock'?'mock':(quiz.type==='mock'?'mock':quiz.type||'mixed');
  $('quizSetup').classList.add('hidden');
  $('quizArea').classList.remove('hidden');
  renderQuizQuestion();
  showToast('途中から再開しました');
}
function restartQuizDraft(){
  const draft=migrateQuizDraft(state.quizDraft);
  if(!draft)return;
  if(!confirm('途中の演習を破棄して最初からやり直しますか？累計成績は消えません。'))return;
  const source=draft.source,mode=draft.mode,system=draft.system,type=draft.type,length=draft.length;
  clearQuizDraft(false);
  startQuiz({source,mode:mode==='knowledge'||mode==='retry'?'recommended':mode,system,length,type,force:true});
}
function deleteQuizDraft(){
  if(!state.quizDraft)return;
  if(!confirm('途中の演習データだけを削除しますか？累計成績は消えません。'))return;
  clearQuizDraft();
  renderQuizDraftPanel();
  showToast('途中データを削除しました');
}
function handleQuizDraftPanelClick(event){
  const action=event.target?.dataset?.quizDraftAction;
  if(action==='resume')resumeQuizDraft();
  if(action==='restart')restartQuizDraft();
  if(action==='delete')deleteQuizDraft();
}
function renderQuizDraftPanel(){
  const panel=$('quizDraftPanel');if(!panel)return;
  const draft=migrateQuizDraft(state.quizDraft);
  state.quizDraft=draft;
  if(!draft){panel.classList.add('hidden');panel.innerHTML='';return;}
  const answered=quizAnsweredCount(draft),last=formatDateTime(draft.updatedAt);
  panel.classList.remove('hidden');
  panel.innerHTML=`<div class="quiz-draft-head"><div><strong>途中の演習があります</strong><small>${esc(quizSourceLabel(draft.source))} / ${esc(quizModeLabel(draft.mode))} / ${esc(quizTypeLabel(draft.type))}</small></div><span class="badge gray">${answered}/${draft.length}</span></div><div class="quiz-draft-meta"><span>分野: ${esc(quizSystemLabel(draft.system))}</span><span>問題数: ${draft.length}</span><span>最終更新: ${esc(last)}</span></div><div class="quiz-draft-actions"><button class="primary" data-quiz-draft-action="resume" type="button">続きから再開</button><button class="secondary" data-quiz-draft-action="restart" type="button">最初からやり直す</button><button class="danger" data-quiz-draft-action="delete" type="button">途中データを削除</button></div>`;
}
function renderQuizView(){
  renderQuizDraftPanel();
  if(!quiz){
    $('quizSetup').classList.remove('hidden');
    $('quizArea').classList.add('hidden');
    $('quizSessionStatus').textContent='';
  }
}
function startKnowledgeTermPractice(termId,includeRelated=false){
  const svc=getKnowledgeService(),term=svc?.getTerm(termId);if(!term)return;
  if(state.quizDraft&&!confirm('途中の演習を破棄して、この用語の問題を開始しますか？'))return;
  const candidates=includeRelated?[term,...svc.getConnectedTerms(term.id)]:[term],seen=new Set(),appTerms=[];
  candidates.forEach(item=>{if(item.appTerm&&!seen.has(String(item.appTerm.id))){seen.add(String(item.appTerm.id));appTerms.push(item.appTerm);}});
  if(!appTerms.length){showToast('このノードに対応する問題を作れません');return;}
  clearQuizDraft(false);
  navTo('quiz');$('quizSource').value='terms';$('quizMode').value='recommended';$('quizType').value='mixed';
  const selected=appTerms.slice(0,Math.min(8,appTerms.length));
  quiz={sessionId:quizSessionId(),source:'terms',mode:'knowledge',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(t=>makeQuestion(t,'mixed')),results:[],startedAt:Date.now(),completed:false};
  persistQuizDraft();
  $('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();
}

function selectPool(mode,system,length=10){let pool=TERMS.filter(t=>!system||t['系']===system);if(mode==='recommended')return recommendedTerms(length,system);if(mode==='due'){pool=priorityReviewTerms(system);}else if(mode==='unlearned'){const u=pool.filter(t=>readTermState(t.id).mastery===0);if(u.length>=4)pool=u;}else if(mode==='weak'){pool=pool.sort((a,b)=>termScore(b)-termScore(a)).slice(0,Math.max(30,Math.ceil(pool.length*.25)));}return pool.length?pool:TERMS.filter(t=>!system||t['系']===system);}
function subjectPool(mode,system,length=10){let pool=SUBJECT_A.filter(q=>!system||q.system===system);if(mode==='weak'){const weak=pool.filter(q=>getSubjectState(q.id).wrong>0).sort((a,b)=>getSubjectState(b.id).wrong-getSubjectState(a.id).wrong);if(weak.length)pool=weak;}else if(mode==='unlearned'){const fresh=pool.filter(q=>getSubjectState(q.id).correct+getSubjectState(q.id).wrong===0);if(fresh.length)pool=fresh;}else if(mode==='mock'){return sample(pool,Math.min(Math.max(length,20),pool.length));}else if(mode==='recommended'||mode==='due'){const weak=pool.filter(q=>getSubjectState(q.id).wrong>0).sort((a,b)=>getSubjectState(b.id).wrong-getSubjectState(a.id).wrong),fresh=pool.filter(q=>getSubjectState(q.id).correct+getSubjectState(q.id).wrong===0),seen=new Set(),result=[];[weak,fresh,sample(pool,length)].forEach(group=>group.forEach(q=>{if(result.length<length&&!seen.has(q.id)){seen.add(q.id);result.push(q);}}));return result;}return sample(pool,Math.min(length,pool.length));}
function sample(arr,n){const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a.slice(0,n);}
function startQuiz(overrides={}){const replaceDraft=overrides.force||!state.quizDraft||confirm('途中の演習を破棄して新しく開始しますか？');if(!replaceDraft)return;const source=overrides.source||$('quizSource').value,mode=overrides.mode||$('quizMode').value,system=overrides.system??$('quizSystem').value,length=Number(overrides.length||$('quizLength').value);let type=overrides.type||$('quizType').value;if(source==='subjectA')return startSubjectQuiz({mode,system,length,type,force:true});if(type==='mock')type='mixed';clearQuizDraft(false);const pool=selectPool(mode,system,length);const chosen=mode==='recommended'?pool.slice(0,Math.min(length,pool.length)):sample(pool,Math.min(length,pool.length));quiz={sessionId:quizSessionId(),source:'terms',mode,system,type,length:chosen.length,index:0,correct:0,answered:false,items:chosen.map(t=>makeQuestion(t,type)),results:[],startedAt:Date.now(),completed:false};persistQuizDraft();$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();}
function startSubjectQuiz({mode='random',system='',length=10,type='mixed',force=false}={}){if(state.quizDraft&&!force&&!confirm('途中の演習を破棄して新しく開始しますか？'))return;const actualMode=type==='mock'?'mock':mode,pool=subjectPool(actualMode,system,length);if(!pool.length){showToast('科目Aの問題がありません');return;}clearQuizDraft(false);quiz={sessionId:quizSessionId(),source:'subjectA',mode:actualMode,system,type,length:pool.length,index:0,correct:0,answered:false,items:pool.map(makeSubjectQuestion),results:[],startedAt:Date.now(),completed:false};persistQuizDraft();$('quizSource').value='subjectA';$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();}
function distractorsFor(target){let pool=TERMS.filter(t=>t.id!==target.id&&t['中分類']&&t['中分類']===target['中分類']);if(pool.length<3)pool=TERMS.filter(t=>t.id!==target.id&&t['大分類']===target['大分類']);if(pool.length<3)pool=TERMS.filter(t=>t.id!==target.id&&t['系']===target['系']);return sample(pool,3);}
function makeQuestion(target,type){let qtype=type==='mixed'?(Math.random()<.5?'description':'term'):type;const ds=distractorsFor(target);if(qtype==='term')return {target,qtype,prompt:`「${target['用語']}」の説明として最も適切なものはどれですか。`,options:sample([target,...ds],4).map(t=>({id:t.id,label:t['基本解説']||`${t['用語']}に関する概念`}))};return {target,qtype,prompt:target['基本解説']||target['試験での着眼点'],options:sample([target,...ds],4).map(t=>({id:t.id,label:t['用語']}))};}
function makeSubjectQuestion(q){return {source:'subjectA',target:q,qtype:'subjectA',prompt:q.question,options:q.choices.map((label,i)=>({id:String(i),label}))};}
function quizSessionHeaderHtml(q,metaSystem,metaCategory){
  return `<div class="quiz-session-panel"><div class="quiz-session-actions"><button id="returnQuizSetupButton" class="secondary" type="button">演習設定に戻る</button><button id="saveQuizDraftButton" class="secondary" type="button">中断して保存</button></div><div class="quiz-session-stats"><span>進捗 <b>${quiz.index+1}/${quiz.length}</b></span><span>正解 <b>${quiz.correct}</b></span><span>分野 <b>${esc(quizSystemLabel(quiz.system||metaSystem))}</b></span><span>モード <b>${esc(quizModeLabel(quiz.mode))}</b></span><span>形式 <b>${esc(quizTypeLabel(quiz.type||q.qtype))}</b></span></div></div>`;
}
function renderStoredQuizFeedback(q){
  if(!q.graded)return '';
  return q.source==='subjectA'?subjectFeedbackHtml(q,Boolean(q.correct)):termFeedbackHtml(q,String(q.userAnswer),Boolean(q.correct));
}
function subjectFeedbackHtml(q,correct){
  const target=q.target,linkedNames=Array.isArray(q.linkedTermNames)?q.linkedTermNames:[];
  const linkedHtml=linkedNames.length?`<div class="explanation-block"><h4>知識マップ反映</h4><p>${linkedNames.map(esc).join('、')} の習熟度と復習予定を更新しました。</p></div>`:'';
  return `<div class="explanation"><strong>${correct?'正解':'不正解'}</strong><p><b>正解：</b>${esc(target.choices[target.answer])}</p><div class="explanation-block"><h4>解説</h4><p>${esc(target.explanation)}</p></div><div class="explanation-block"><h4>関連語</h4><div class="badges">${target.relatedTerms.map(x=>`<span class="badge gray">${esc(x)}</span>`).join('')}</div></div>${linkedHtml}<div class="quiz-actions"><button id="nextQuestionButton" class="primary" type="button">${quiz.index+1>=quiz.length?'結果を見る':'次の問題'}</button></div></div>`;
}
function termFeedbackHtml(q,selectedId,correct){
  const linkedNames=Array.isArray(q.linkedTermNames)?q.linkedTermNames:[],linkedHtml=linkedNames.length?`<div class="explanation-block"><h4>知識マップ反映</h4><p>関連・前提用語 ${linkedNames.map(esc).join('、')} にも小さく反映しました。</p></div>`:'';
  return `<div class="explanation"><strong>${correct?'正解':'不正解'}</strong><p><b>正解：</b>${esc(q.target['用語'])}</p>${answerExplanation(q,selectedId,correct)}${linkedHtml}<div class="rating-row"><button data-rating="1" ${q.reviewRating?'disabled':''}>もう一度</button><button data-rating="3" ${q.reviewRating?'disabled':''}>難しい</button><button data-rating="4" ${q.reviewRating?'disabled':''}>理解</button><button data-rating="5" ${q.reviewRating?'disabled':''}>簡単</button></div><div class="quiz-actions"><button id="nextQuestionButton" class="primary" type="button">${quiz.index+1>=quiz.length?'結果を見る':'次の問題'}</button></div></div>`;
}
function bindRenderedQuizControls(){
  $('returnQuizSetupButton')?.addEventListener('click',()=>pauseQuizToSetup({message:'演習状態を保存して設定へ戻りました'}));
  $('saveQuizDraftButton')?.addEventListener('click',()=>pauseQuizToSetup({message:'途中の演習を保存しました'}));
  $('nextQuestionButton')?.addEventListener('click',()=>{quiz.index++;quiz.answered=false;if(quiz.index<quiz.length)persistQuizDraft();renderQuizQuestion();});
  $$('[data-rating]').forEach(b=>b.onclick=()=>{const q=quiz?.items?.[quiz.index];if(!q||q.reviewRating)return;scheduleReview(q.target.id,Number(b.dataset.rating));q.reviewRating=Number(b.dataset.rating);persistQuizDraft();$$('[data-rating]').forEach(x=>x.disabled=true);showToast('復習間隔を更新しました');});
}
function renderQuizQuestion(){
  if(!quiz)return;
  recalcQuizScore(quiz);
  if(quiz.index>=quiz.items.length){finishQuiz();return;}
  const q=quiz.items[quiz.index],metaSystem=q.source==='subjectA'?q.target.system:q.target['系'],metaCategory=q.source==='subjectA'?q.target.category:q.target['中分類'],graded=Boolean(q.graded);
  quiz.answered=graded;
  $('quizSessionStatus').textContent=`${quiz.index+1} / ${quiz.length}`;
  $('quizArea').innerHTML=`<article class="quiz-card">${quizSessionHeaderHtml(q,metaSystem,metaCategory)}<div class="quiz-meta"><span>${esc(metaSystem)} › ${esc(metaCategory)}</span><span>${quiz.index+1}/${quiz.length}</span></div><div class="progress-track" style="margin-top:10px"><span style="width:${quiz.index/quiz.length*100}%"></span></div><p class="quiz-question">${esc(q.prompt)}</p><div class="option-list">${q.options.map((o,i)=>{const id=String(o.id),isCorrect=q.source==='subjectA'?Number(id)===Number(q.target.answer):id===String(q.target.id),isSelected=graded&&id===String(q.userAnswer),className=graded&&isCorrect?' correct':graded&&isSelected&&!isCorrect?' wrong':'';return `<button class="option${className}" data-answer-id="${esc(id)}" type="button" ${graded?'disabled':''}><span>${String.fromCharCode(65+i)}.</span> ${esc(o.label)}</button>`;}).join('')}</div><div id="quizFeedback">${renderStoredQuizFeedback(q)}</div></article>`;
  if(!graded)$$('[data-answer-id]').forEach(b=>b.onclick=()=>answerQuestion(b.dataset.answerId,b));
  bindRenderedQuizControls();
}
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
  q.userAnswer=String(id);q.correct=correct;q.graded=true;q.answeredAt=Date.now();q.linkedTermNames=linkedTerms.map(t=>t.name);
  $$('[data-answer-id]').forEach(b=>{b.disabled=true;if(Number(b.dataset.answerId)===Number(target.answer))b.classList.add('correct');});
  if(!correct)button.classList.add('wrong');
  persistQuizDraft();
  $('quizFeedback').innerHTML=subjectFeedbackHtml(q,correct);
  bindRenderedQuizControls();
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
  q.userAnswer=String(id);q.correct=correct;q.graded=true;q.answeredAt=Date.now();q.linkedTermNames=linkedTerms.map(t=>t.name);
  persistQuizDraft();
  $('quizFeedback').innerHTML=termFeedbackHtml(q,String(id),correct);
  bindRenderedQuizControls();
}
function scheduleReview(id,quality){const s=getTermState(id),today=localDate();s.updatedAt=today;if(quality<3){s.repetitions=0;s.interval=1;s.ease=Math.max(1.3,s.ease-.2);s.due=addDays(today,1);s.nextReview=s.due;s.reviewPriority=termById.has(String(id))?reviewPriority(termById.get(String(id))):0;return;}s.repetitions=(s.repetitions||0)+1;if(s.repetitions===1)s.interval=1;else if(s.repetitions===2)s.interval=3;else s.interval=Math.max(1,Math.round((s.interval||3)*(s.ease||2.5)));s.ease=Math.max(1.3,(s.ease||2.5)+(0.1-(5-quality)*(0.08+(5-quality)*0.02)));s.due=addDays(today,s.interval);s.nextReview=s.due;s.mastery=clamp(Math.max(s.mastery,quality===5?4:3),0,5);s.reviewPriority=termById.has(String(id))?reviewPriority(termById.get(String(id))):0;}
function finishQuiz(){
  recalcQuizScore(quiz);
  const pct=Math.round(quiz.correct/quiz.length*100),wrong=quiz.length-quiz.correct,duration=Math.round((Date.now()-quiz.startedAt)/1000),weak=quizWeakSystems(quiz.results),session={date:localDate(),ts:Date.now(),source:quiz.source,mode:quiz.mode,total:quiz.length,correct:quiz.correct,durationSec:duration};
  quiz.completed=true;
  clearQuizDraft(false);
  if(quiz.source==='subjectA')state.subjectA.sessions.push(session);else state.sessions.push(session);
  saveState(false);
  $('quizArea').classList.add('hidden');$('quizSetup').classList.remove('hidden');$('quizSessionStatus').textContent='';renderQuizDraftPanel();
  $('resultDialogContent').innerHTML=`<div class="dialog-head"><div><p class="eyebrow">Session complete</p><h2>演習結果</h2></div><button class="close-button" data-close-result type="button">×</button></div><div class="result-score"><strong>${pct}%</strong><span>${quiz.correct} / ${quiz.length}問正解</span></div><div class="result-breakdown"><div><strong>${quiz.correct}</strong><small>正解</small></div><div><strong>${wrong}</strong><small>誤答</small></div><div><strong>${duration}秒</strong><small>所要時間</small></div></div><section class="result-insight"><h3>次のおすすめ</h3><p>${esc(nextActionText(pct,wrong))}</p><p class="help"><b>苦手分野:</b> ${weak.length?'誤答が出た分野を優先して復習しましょう。':'今回の結果では大きな偏りはありません。'}</p><div class="badges">${weak.length?weak.map(([system,count])=>`<span class="badge bad">${esc(system)} ${count}問</span>`).join(''):'<span class="badge good">大きな苦手分野なし</span>'}</div></section><div class="dialog-actions"><button id="retryWeakButton" class="secondary" type="button" ${wrong?'':'disabled'}>間違えた問題を復習</button><button id="nextRecommendedButton" class="primary" type="button">おすすめ演習へ</button></div>`;
  const d=$('resultDialog'),source=quiz.source,finishedResults=quiz.results.slice();
  d.showModal();
  qs('[data-close-result]').onclick=()=>{d.close();quiz=null;renderAll();};
  $('retryWeakButton').onclick=()=>{
    const ids=new Set(finishedResults.filter(r=>!r.correct).map(r=>String(r.id)));d.close();
    if(!ids.size){showToast('間違えた問題はありません');return;}
    if(source==='subjectA'){
      const selected=SUBJECT_A.filter(q=>ids.has(String(q.id)));
      quiz={sessionId:quizSessionId(),source:'subjectA',mode:'retry',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(makeSubjectQuestion),results:[],startedAt:Date.now(),completed:false};
    }else{
      const selected=TERMS.filter(t=>ids.has(String(t.id)));
      quiz={sessionId:quizSessionId(),source:'terms',mode:'retry',system:'',type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(t=>makeQuestion(t,'mixed')),results:[],startedAt:Date.now(),completed:false};
    }
    persistQuizDraft();$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();
  };
  $('nextRecommendedButton').onclick=()=>{const length=Number(preferredQuizLength());d.close();quiz=null;if(source==='subjectA'){startQuiz({source:'subjectA',mode:'recommended',length,force:true});return;}$('quizSource').value='terms';$('quizMode').value='recommended';startQuiz({source:'terms',mode:'recommended',length,force:true});};
  quiz=null;
  renderAll();
}

function selectedReviewSystem(){return $('reviewSystemFilter')?.value||'';}
function reviewCard(t){const s=readTermState(t.id),priority=reviewPriority(t),status=reviewStatus(t);return `<button class="stack-item review-card term-link text-button" data-term-id="${esc(t.id)}"><span class="stack-item-main"><strong>${esc(t['用語'])}</strong><small>${esc(status.label)}・次回 ${esc(formatReviewDate(reviewDate(s)))}・誤答${s.wrong}・連続正解${s.streak}</small><span class="badges">${statusBadge(t)}<span class="badge gray">Lv.${formatMastery(s.mastery)}</span></span></span><span class="review-priority"><b>${priority}</b><small>優先度</small></span></button>`;}
function reviewTerms(){const system=selectedReviewSystem();if(reviewFilter==='wrong')return TERMS.filter(t=>(!system||t['系']===system)&&readTermState(t.id).wrong>0).sort((a,b)=>reviewPriority(b)-reviewPriority(a)||readTermState(b.id).wrong-readTermState(a.id).wrong);if(reviewFilter==='bookmark')return TERMS.filter(t=>(!system||t['系']===system)&&readTermState(t.id).bookmark).sort((a,b)=>reviewPriority(b)-reviewPriority(a));return priorityReviewTerms(system);}
function reviewProblemStats(system=selectedReviewSystem()){
  const due=priorityReviewTerms(system),wrong=TERMS.filter(t=>(!system||t['系']===system)&&readTermState(t.id).wrong>0),weak=weakTerms(system),deadline=dueTerms().filter(t=>!system||t['系']===system),last=state.sessions?.slice().reverse().find(session=>session.source!=='subjectA');
  return {due,wrong,weak,deadline,lastScore:last?`${last.correct}/${last.total}`:'—'};
}
function startTermReviewFromTerms(terms,mode='review'){
  if(!terms.length){showToast('対象の復習問題はありません');return;}
  if(state.quizDraft&&!confirm('途中の演習を破棄して新しく開始しますか？'))return;
  const selected=terms.slice(0,20),system=selectedReviewSystem();
  navTo('quiz');
  clearQuizDraft(false);
  $('quizSource').value='terms';$('quizMode').value=mode==='due'?'due':'weak';$('quizSystem').value=system;$('quizLength').value=String([5,10,20].includes(selected.length)?selected.length:10);$('quizType').value='mixed';
  quiz={sessionId:quizSessionId(),source:'terms',mode,system,type:'mixed',length:selected.length,index:0,correct:0,answered:false,items:selected.map(t=>makeQuestion(t,'mixed')),results:[],startedAt:Date.now(),completed:false};
  persistQuizDraft();$('quizSetup').classList.add('hidden');$('quizArea').classList.remove('hidden');renderQuizQuestion();
}
function startReviewMode(mode='due'){
  const system=selectedReviewSystem(),stats=reviewProblemStats(system);
  if(mode==='wrong')return startTermReviewFromTerms(stats.wrong.sort((a,b)=>readTermState(b.id).wrong-readTermState(a.id).wrong||reviewPriority(b)-reviewPriority(a)),'wrong');
  if(mode==='weak')return startTermReviewFromTerms(stats.weak,'weak');
  startTermReviewFromTerms(stats.due,'due');
}
function resumeReviewFromReviewScreen(){
  if(!migrateQuizDraft(state.quizDraft)){showToast('再開できる途中演習がありません');return;}
  navTo('quiz');
  resumeQuizDraft();
}
function renderReview(){const list=reviewTerms(),stats=reviewProblemStats(),reviewStats=chatGPTReviewStats(getKnowledgeService()),top=stats.due[0];$('reviewCountLabel').textContent=`${list.length}語`;$('reviewHeroCount').textContent=`${stats.due.length}語`;$('problemReviewReadyCount').textContent=stats.due.length;$('problemReviewWrongCount').textContent=stats.wrong.length;$('problemReviewDueCount').textContent=stats.due.length;$('problemReviewWrongOnlyCount').textContent=stats.wrong.length;$('problemReviewWeakCount').textContent=stats.weak.length;$('problemReviewDeadlineCount').textContent=stats.deadline.length;$('problemReviewLastScore').textContent=stats.lastScore;$('nextReviewDate').textContent=formatReviewDate(nextReviewDate());$('startReviewButton').disabled=stats.due.length===0;$('startDueReviewButton').disabled=stats.due.length===0;$('startWrongReviewButton').disabled=stats.wrong.length===0;$('startWeakReviewButton').disabled=stats.weak.length===0;$('resumeReviewButton').disabled=!migrateQuizDraft(state.quizDraft);$('writingReviewPendingCount').textContent=reviewStats.pending+reviewStats.needsRecheck;$('writingReviewFixCount').textContent=reviewStats.needsFix;$('reviewList').innerHTML=list.length?list.slice(0,100).map(reviewCard).join(''):'<div class="panel empty">現在の対象はありません。</div>';renderNoteSubmissionPanel(getKnowledgeService());bindTermLinks();}
function statusSegment(label,count,total,kind){const raw=total?count/total*100:0,pct=Math.round(raw),width=count?Math.max(2,pct):0,display=count&&pct===0?'&lt;1%':pct+'%';return `<div class="status-segment ${esc(kind)}"><div><strong>${esc(label)}</strong><span>${count}語 / ${display}</span></div><div class="progress-track"><span style="width:${width}%"></span></div></div>`;}
function renderProgress(){const total=state.attempts.length,c=state.attempts.filter(a=>a.correct).length,ready=readiness();$('totalAnswersValue').textContent=total;$('totalCorrectValue').textContent=c;$('studyDaysValue').textContent=daysWithActivity().length;$('bestStreakValue').textContent=bestStreak()+'日';$('progressReadinessValue').textContent=ready+'%';$('progressReadinessBar').style.width=ready+'%';$('studyAdviceText').textContent=`参考値です。${studyAdvice()}`;const status=learningStatusCounts(),termTotal=TERMS.length;$('learningStatusSummary').innerHTML=[statusSegment('未学習',status.unlearned,termTotal,'unlearned'),statusSegment('学習中',status.learning,termTotal,'learning'),statusSegment('習得済み',status.mastered,termTotal,'mastered')].join('');renderWritingTestSummary();const days=renderActivityChart($('progressActivityChart')),sum=days.reduce((a,b)=>a+b.count,0),active=days.filter(x=>x.count>0).length;$('progressActivitySummary').textContent=`14日間で${sum}問、学習日は${active}日です。`;const weakSystems=weakSystemStats().filter(x=>x.attempts>0||x.studied>0).slice(0,3);$('weakAreaSummary').innerHTML=weakSystems.length?weakSystems.map(x=>`<div class="stack-item"><span class="stack-item-main"><strong>${esc(x.system)}</strong><small>正答率 ${x.accuracy===null?'—':x.accuracy+'%'}・誤答 ${x.wrong}・学習済み ${x.studied}/${x.terms}語</small></span><b>${Math.round(x.weakScore)}</b></div>`).join(''):'<p class="empty">まだ苦手分野を判定できる履歴がありません。</p>';$('categoryAnalytics').innerHTML=groupStats().map(x=>`<div class="analytics-row"><strong>${esc(x.system)}</strong><div class="progress-track"><span style="width:${x.accuracy??0}%"></span></div><span>${x.accuracy===null?'—':x.accuracy+'%'}</span><small>${x.correct}/${x.attempts}問正解・${x.studied}/${x.terms}語学習</small></div>`).join('');const rank=TERMS.filter(t=>readTermState(t.id).wrong>0).sort((a,b)=>readTermState(b.id).wrong-readTermState(a.id).wrong||reviewPriority(b)-reviewPriority(a)).slice(0,10);$('mistakeRanking').innerHTML=rank.length?rank.map(stackTerm).join(''):'<p class="empty">誤答履歴はありません。</p>';bindTermLinks();}
function setExamDateSaveState(text='保存済み'){const el=$('examDateSaveState');if(el)el.textContent=text;}
function queueSettingsAutoSave(){
  setExamDateSaveState('保存中');
  clearTimeout(settingsAutoSaveTimer);
  settingsAutoSaveTimer=setTimeout(()=>saveSettings({silent:true}),320);
}
function renderExamDateSetting(status='保存済み'){
  const info=examDateInfo();
  if($('examDateCurrent'))$('examDateCurrent').textContent=info.label;
  if($('examDateRemaining'))$('examDateRemaining').textContent=info.remaining;
  const warning=$('examDateWarning');
  if(warning){warning.textContent=info.message;warning.classList.toggle('hidden',!info.message);}
  $('clearExamDateButton')?.toggleAttribute('disabled',!info.set);
  setExamDateSaveState(status);
}
function syncSettingsControls(status='保存済み'){
  const memorization=memorizationSettings();
  const sensorDefault=$('memorizationSensorDefaultInput'),memorizationDefault=$('memorizationDefaultInput');
  if(sensorDefault){
    sensorDefault.disabled=!memorization.enabled;
    sensorDefault.checked=memorization.enabled&&Boolean(memorization.sensorEnabled);
    sensorDefault.setAttribute('aria-disabled',memorization.enabled?'false':'true');
    sensorDefault.closest('label')?.classList.toggle('is-disabled',!memorization.enabled);
  }
  if(memorizationDefault)memorizationDefault.checked=Boolean(memorization.enabled);
  renderExamDateSetting(status);
}
function syncQuizLengthWithDailyGoal(){
  const length=preferredQuizLength(state.settings.dailyGoal);
  const ui=uiState();
  ui.quizSetup.length=length;
  if($('quizLength'))$('quizLength').value=length;
}
function applySettingsEffects(){
  applyTheme();
  const memorization=memorizationSettings();
  memorizationRuntime.enabled=Boolean(memorization.enabled);
  memorizationRuntime.sensorWanted=memorizationRuntime.enabled&&Boolean(memorization.sensorEnabled);
  if(!memorizationRuntime.enabled){
    clearMemorizationReveal();
    stopMemorizationSensor('センサ未開始','暗記モードはOFFです');
    resetMemorizationSensorValues();
  } else if(!memorizationRuntime.sensorWanted){
    stopMemorizationSensor('ボタン操作のみ','端末を傾けずボタンだけで使えます');
  } else {
    memorizationRuntime.sensorState=memorizationRuntime.sensorListening?'センサON':'許可待ち';
    memorizationRuntime.sensorMessage=memorizationRuntime.sensorListening?'端末を傾けると現在用語だけ表示します':'マップでセンサ操作ONを押すと許可を確認します';
    memorizationRuntime.panelCollapsed=false;
  }
  renderMemorizationPanel();
  applyMemorizationCovers();
  if(currentView==='home')renderHome();
  if(currentView==='progress')renderProgress();
  if(currentView==='quiz')renderQuizView();
  if(currentView==='review')renderReview();
  if(currentView==='map')renderKnowledgeMap();
}
function renderSettings(status='保存済み'){
  const memorization=memorizationSettings();
  $('dailyGoalInput').value=state.settings.dailyGoal||10;
  $('examDateInput').value=state.settings.examDate||'';
  $('themeInput').value=state.settings.theme||'system';
  $('memorizationDefaultInput').checked=Boolean(memorization.enabled);
  $('memorizationSensorDefaultInput').checked=Boolean(memorization.sensorEnabled);
  $('memorizationShowThresholdInput').value=memorization.showThreshold;
  $('memorizationHideThresholdInput').value=memorization.hideThreshold;
  $('memorizationHoldMsInput').value=memorization.holdMs;
  $('memorizationManualModeInput').value=memorization.manualMode;
  $('memorizationPanelVisibleInput').checked=Boolean(memorization.panelVisible);
  syncSettingsControls(status);
}
function saveSettings(options={}){
  const silent=Boolean(options&&options.silent);
  clearTimeout(settingsAutoSaveTimer);
  state.settings.dailyGoal=clamp(Number($('dailyGoalInput').value)||10,1,100);
  state.settings.examDate=normalizeExamDateValue($('examDateInput').value);
  state.settings.theme=['system','light','dark'].includes($('themeInput').value)?$('themeInput').value:'system';
  const showThreshold=clamp(Number($('memorizationShowThresholdInput').value)||MEMORIZATION_DEFAULTS.showThreshold,12,60);
  const memorizationEnabled=$('memorizationDefaultInput').checked;
  state.settings.memorization=migrateMemorizationSettings({
    enabled:memorizationEnabled,
    sensorEnabled:memorizationEnabled&&$('memorizationSensorDefaultInput').checked,
    showThreshold,
    hideThreshold:clamp(Number($('memorizationHideThresholdInput').value)||MEMORIZATION_DEFAULTS.hideThreshold,3,Math.max(4,showThreshold-1)),
    holdMs:clamp(Number($('memorizationHoldMsInput').value)||MEMORIZATION_DEFAULTS.holdMs,200,2000),
    manualMode:$('memorizationManualModeInput').value,
    panelVisible:$('memorizationPanelVisibleInput').checked
  });
  syncQuizLengthWithDailyGoal();
  saveQuizSetupUiState();
  saveState(false);
  applySettingsEffects();
  if(currentView==='settings')renderSettings('保存しました');
  if(!silent)showToast('設定を保存しました');
}
function clearExamDateSetting(){
  $('examDateInput').value='';
  saveSettings({silent:true});
  showToast('試験予定日を削除しました');
}
function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`FE_Learning_OS_backup_${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
function importData(e){const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const x=JSON.parse(reader.result);if(!x||x.version!==2)throw new Error();state=migrateState(Object.assign(defaultState(),x,{settings:Object.assign(defaultState().settings,x.settings||{})}),x.schemaVersion);hydrateMemorizationRuntime();saveState(false);applySettingsEffects();renderAll();showToast('バックアップを読み込みました');}catch(err){alert('このバックアップファイルは読み込めません。');}};reader.readAsText(file);e.target.value='';}
function resetData(){if(confirm('学習履歴・メモ・設定をすべて削除しますか？')){try{localStorage.removeItem(STORAGE_KEY);}catch(e){console.warn('Local storage is unavailable; reset only affects this session.',e);}state=defaultState();hydrateMemorizationRuntime();saveState(false);renderAll();showToast('学習データを削除しました');}}
function copyText(text,msg='コピーしました'){if(navigator.clipboard&&location.protocol!=='file:')navigator.clipboard.writeText(text).then(()=>showToast(msg)).catch(()=>fallbackCopy(text,msg));else fallbackCopy(text,msg);}
function fallbackCopy(text,msg){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();showToast(msg);}
function compactWeakSummary(limit=5){const today=localDate(),todayWrong=state.attempts.filter(a=>a.date===today&&!a.correct).map(a=>termById.get(String(a.id))).filter(Boolean),weak=TERMS.filter(t=>readTermState(t.id).wrong>0).sort((a,b)=>readTermState(b.id).wrong-readTermState(a.id).wrong);const merged=[],seen=new Set();[todayWrong,weak].forEach(group=>group.forEach(t=>{if(merged.length<limit&&!seen.has(String(t.id))){seen.add(String(t.id));merged.push(t);}}));return merged.length?merged.map(t=>`${t['用語']}（${t['系']}、誤答${readTermState(t.id).wrong}回）`).join('、'):'まだ誤答データなし';}
function copyTermPrompt(t,kind){const s=readTermState(t.id),base=`基本情報技術者試験の用語「${t['用語']}」（${t['系']} / ${t['中分類']}）について。`;const rel=String(t['関連語']||'').split('/').map(x=>x.trim()).filter(Boolean).slice(0,5).join('、')||'関連語なし';const prompts={explain:`${base}初心者向けに、1. 一言での定義 2. 具体例 3. 試験で問われるポイント 4. 関連語との違い、の順で説明してください。関連語: ${rel}。`,mistake:`${base}私はこの用語で誤答が${s.wrong}回あります。よくある勘違いを3つ挙げ、正しい見分け方と短い確認問題を1問作ってください。個人情報は含めず、FE試験向けに説明してください。`,questions:`${base}関連問題をオリジナルで3問作ってください。各問は4択、正解、解説、関連語を付けてください。過去問の転載はしないでください。関連語: ${rel}。`};copyText(prompts[kind]||prompts.explain,'質問文をコピーしました');}
function copyWeakPrompt(){const summary=compactWeakSummary(5);copyText(`私は基本情報技術者試験を勉強しています。今日の弱点候補は「${summary}」です。個人情報や詳細な学習履歴は使わず、1. 共通する勘違い 2. 優先順位 3. 30分の復習メニュー 4. 確認問題3問、の順で整理してください。`,'弱点整理プロンプトをコピーしました');}

setup();
})();
