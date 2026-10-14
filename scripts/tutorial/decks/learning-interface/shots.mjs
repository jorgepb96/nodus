export const TITLE='Interface, appearance, languages, and Nodi';
const shot=(id,say,act,extra={})=>({id,say,act,keepOverlay:true,...extra});
export const SHOTS=[
 shot('interface','Start the Interface lesson to learn where profiles, appearance, languages, and Nodi are configured.',async h=>h.open('interface'),{chapter:'Interface controls'}),
 shot('profiles-open','Continue opens the real Interface selector at the Profiles tab.',async h=>h.click('[data-testid="learning-interface-next"]')),
 shot('profiles','Profiles change the visible research sections while keeping documents, conversations, and model choices.',null,{highlight:'[data-testid="interface-tab-profiles"]'}),
 shot('theme','Continue advances to Theme, where appearance controls are organized together.',async h=>h.click('[data-testid="learning-interface-next"]'),{chapter:'Theme',highlight:'[data-testid="interface-tab-theme"]'}),
 shot('theme-options','Review the actual theme controls without changing a setting unless you want to apply it.',null),
 shot('languages','Continue opens Languages, which separates interface language from the language used in prompts.',async h=>h.click('[data-testid="learning-interface-next"]'),{chapter:'Languages'}),
 shot('english','Both selectors are set to English for these recordings, and each setting can be chosen independently.',null,{highlight:'#interface-ui-language'}),
 shot('nodi','Continue opens Nodi, where you can enable or disable the companion from the same selector.',async h=>h.click('[data-testid="learning-interface-next"]'),{chapter:'Nodi'}),
 shot('nodi-options','The Nodi controls remain optional and do not require changing the research interface profile.',null),
 shot('complete','Finish the guide after reviewing the four real tabs, without requiring any preference changes.',async h=>{await h.click('[data-testid="learning-interface-next"]');await h.finish('interface-completed');}),
 shot('close','Close the selector to return to the workspace with the chosen preferences preserved.',async h=>{await h.page.getByTestId('academic-interface-picker').getByRole('button',{name:'Close',exact:true}).click();await h.pause();}),
];

export const END_CARD={title:'Continue learning in Nodus',destination:'Settings → Tutorials',detail:'Repeat a lesson or resume your practice.'};
