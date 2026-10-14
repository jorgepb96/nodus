import {question,TEXT_MODEL,EMBED_MODEL} from './common.mjs';
export const TITLE='Your first answer with evidence';
const shot=(id,say,act,extra={})=>({id,say,act,keepOverlay:true,...extra});
export const SHOTS=[
 shot('simple','Start in Simple, where the library and Research chat are available without configuring an analysis model.',async h=>h.open('first-answer'),{chapter:'Simple interface',highlight:'[data-testid="academic-interface-trigger"]'}),
 shot('guide','The guide points to the real controls and follows your actions while the application stays accessible.',null,{highlight:'[data-testid="academic-learning-coach"]'}),
 shot('import','Add one short paper to This vault so the first practice has a clearly defined source.',async h=>h.importPaper()),
 shot('select','Select the paper in the library to make it the source for this guided practice.',async h=>h.selectSource()),
 shot('roles','Preparing a source needs embeddings, and answering questions needs a separate chat model.',async h=>h.click('[data-testid="learning-prepare-selected"]'),{focus:'[data-testid="learning-model-setup"]'}),
 shot('chat-model','For this tutorial we use G P T O S S twenty B; you can choose another supported chat model, and an inexpensive model like this or a newer one is suitable for an initial test.',async h=>h.pickModel('onboarding-ai-model',TEXT_MODEL),{focus:'[data-testid="learning-model-setup"]'}),
 shot('embedding-model','Choose B G E M three for embeddings, which make the document searchable without extracting ideas.',async h=>h.pickModel('onboarding-embedding-model',EMBED_MODEL),{focus:'[data-testid="learning-model-setup"]'}),
 shot('save-models','Continue saves these two roles separately and leaves the analysis model unconfigured.',async h=>{await h.click('[data-testid="learning-model-save"]');const s=await h.state();if(s.extractionModel)throw new Error('Analysis should remain unset');}),
 shot('prepare','Open preparation for the selected paper and review the operation before starting it.',async h=>h.click('[data-testid="learning-prepare-selected"]'),{focus:'[data-testid="research-preparation-welcome"]',chapter:'Prepare one source'}),
 shot('enqueue','Enqueue selection starts the real preparation using the configured provider and the selected document.',async h=>{await h.click('[data-testid="research-preparation-enqueue"]');await h.page.getByTestId('research-preparation-welcome').waitFor({state:'detached',timeout:180000});}),
 shot('progress','Queue and tasks shows the real preparation status, and this recording shortens the waiting time.',async h=>{if(!await h.page.getByTestId('header-queue-panel').count())await h.click('[data-header-action="queue"]');await h.wait(s=>s.academicPracticeSession?.step>=2,'paper prepared');},{timelapse:true,maxWaitMinutes:10}),
 shot('ready','Once preparation finishes, the document is ready for questions and the guide advances to the chat.',async h=>{if(await h.page.getByTestId('header-queue-backdrop').count())await h.page.keyboard.press('Escape');await h.click('[data-testid="learning-suggest-question"]');}),
 shot('question','Ask which six questions the article recommends, and request the exact passage supporting the answer.',async h=>h.fill('.research-composer-input',question),{chapter:'Ask and verify'}),
 shot('send','Press Send yourself to run the real chat request against the selected source.',async h=>h.click('.research-composer-send')),
 shot('answer-wait','The chat produces an answer from the prepared source, and the guide waits for a valid reference.',async h=>h.wait(s=>s.academicPracticeSession?.step===3,'real cited answer'),{timelapse:true,maxWaitMinutes:5}),
 shot('answer','Read the answer and locate its source reference before accepting the information.',null,{highlight:'[data-testid="academic-learning-coach"]'}),
 shot('evidence','Open the reference to inspect the actual passage and check whether it supports the answer.',async h=>h.citation(),{focus:'[data-testid="source-citation-modal"]'}),
 shot('verified','The practice finishes only after you open valid evidence for the answer from your selected paper.',async h=>h.finish('simple-completed'),{focus:'[data-testid="source-citation-modal"]'}),
 shot('continue','Close the evidence and the guide to continue working with your document and conversation intact.',async h=>h.pause()),
];

export const END_CARD={title:'Continue learning in Nodus',destination:'Settings → Tutorials',detail:'Repeat a lesson or resume your practice.'};
