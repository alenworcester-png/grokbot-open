const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const input = $('input');
const sendBtn = $('sendBtn');
const welcome = $('welcome');
let mode = 'grok', busy = false;
let chats = loadChats();
let currentId = null;

function loadChats(){try{return JSON.parse(localStorage.getItem('grokbot_chats')||'[]')}catch{return[]}}
function saveChats(){localStorage.setItem('grokbot_chats',JSON.stringify(chats.slice(0,50)))}
function toast(msg){const t=document.createElement('div');t.className='toast show';t.textContent=msg;document.body.appendChild(t);setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),250)},2200)}
function md(src){const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));let s=esc(src);s=s.replace(/```(\w*)\n([\s\S]*?)```/g,(_,l,c)=>'<pre><code class="lang-'+l+'">'+c+'</code></pre>');s=s.replace(/`([^`\n]+)`/g,'<code>$1</code>');s=s.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');s=s.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');s=s.replace(/^[-*] (.*)$/gm,'<li>$1</li>');s=s.replace(/(<li>[\s\S]*?<\/li>\n?)+/g,m=>'<ul>'+m+'</ul>');return s}

function addMessage(role,content,opts={}){
  const wrap=document.createElement('div');wrap.className='msg '+role;
  const av=document.createElement('div');av.className='avatar '+(role==='user'?'user':'ai');av.textContent=role==='user'?'U':'G';
  const bubble=document.createElement('div');bubble.className='bubble';
  const name=document.createElement('div');name.className='name';name.textContent=role==='user'?'You':(opts.modeLabel||'GrokBot');bubble.appendChild(name);
  let reasoningEl=null;
  if(opts.reasoning!==undefined){const det=document.createElement('details');det.className='reasoning';const sum=document.createElement('summary');sum.textContent='Reasoning';const body=document.createElement('div');body.className='rbody';det.appendChild(sum);det.appendChild(body);if(!opts.reasoning)det.style.display='none';bubble.appendChild(det);reasoningEl=body}
  const contentEl=document.createElement('div');contentEl.className='content';bubble.appendChild(contentEl);
  wrap.appendChild(av);wrap.appendChild(bubble);messagesEl.appendChild(wrap);
  const o={el:wrap,contentEl,reasoningEl,content:'',reasoning:opts.reasoning||''};
  contentEl.innerHTML=md(content)||'<span class="cursor"></span>';return o;
}
function addActions(o,full){const a=document.createElement('div');a.className='actions';const c=document.createElement('button');c.className='action';c.textContent='Copy';c.onclick=()=>{navigator.clipboard.writeText(full);toast('Copied')};a.appendChild(c);o.el.querySelector('.bubble').appendChild(a)}

async function initModes(){try{const r=await fetch('/api/modes');const modes=await r.json();const tabs=$('modeTabs');tabs.innerHTML='';modes.forEach(m=>{const b=document.createElement('button');b.className='mode'+(m.id===mode?' active':'');b.dataset.mode=m.id;b.innerHTML='<span class="ico">'+m.icon+'</span>'+m.label;b.onclick=()=>{mode=m.id;tabs.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x.dataset.mode===mode));$('modelTag').textContent=mode==='think'?'deepseek-reasoner':'deepseek-chat';input.placeholder=mode==='search'?'Search...':'Ask anything...'};tabs.appendChild(b)})}catch{toast('Mode list failed')}}
async function checkHealth(){try{const r=await fetch('/api/health');const d=await r.json();const dot=document.querySelector('#status .dot');if(!d.keyConfigured){dot.className='dot bad';$('status').lastChild.textContent=' API key missing'}else{dot.className='dot ok';$('status').lastChild.textContent=' Connected - '+d.chatModel}}catch{const dot=document.querySelector('#status .dot');if(dot)dot.className='dot bad'}}

function renderHistory(){const list=$('historyList');list.innerHTML='';chats.forEach(c=>{const d=document.createElement('div');d.className='hist-item'+(c.id===currentId?' active':'');const s=document.createElement('span');s.textContent=c.title;const del=document.createElement('span');del.className='hist-del';del.textContent=' x ';del.onclick=e=>{e.stopPropagation();chats=chats.filter(x=>x.id!==c.id);saveChats();renderHistory()};d.appendChild(s);d.appendChild(del);d.onclick=()=>loadChat(c.id);list.appendChild(d)})}
function newChat(){currentId=null;messagesEl.innerHTML='';welcome.style.display='flex';renderHistory();input.focus()}
function loadChat(id){const c=chats.find(x=>x.id===id);if(!c)return;currentId=id;messagesEl.innerHTML='';welcome.style.display='none';c.messages.forEach(m=>{const o=addMessage(m.role,m.content,{reasoning:m.reasoning,modeLabel:m.modeLabel});if(m.role==='assistant')addActions(o,m.content)});renderHistory();scroll()}
function scroll(){$('chatArea').scrollTop=$('chatArea').scrollHeight}
function resize(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,160)+'px'}

async function send(text){
  if(busy)return;const q=(text||input.value).trim();if(!q)return;
  input.value='';resize();welcome.style.display='none';busy=true;sendBtn.disabled=true;
  if(!currentId){currentId=Date.now().toString();chats.unshift({id:currentId,title:q.slice(0,18),messages:[]});saveChats();renderHistory()}
  const chat=chats.find(c=>c.id===currentId);chat.messages.push({role:'user',content:q});saveChats();addMessage('user',q);
  const out=addMessage('assistant','',{reasoning:mode==='think'?'':undefined,modeLabel:mode});out.contentEl.innerHTML='<span class="cursor"></span>';
  const history=chat.messages.slice(0,-1).map(m=>({role:m.role,content:m.content}));
  let full='',reasoning='';
  try{
    const res=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,mode})});
    if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error||('HTTP '+res.status))}
    const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
    while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const chunks=buf.split('\n\n');buf=chunks.pop()||'';
      for(const c of chunks){const line=c.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;const raw=line.slice(6);if(raw==='[DONE]')continue;let d;try{d=JSON.parse(raw)}catch{continue}
        if(d.error){toast(String(d.error).slice(0,120));continue}
        if(d.reasoning){reasoning+=d.reasoning;const det=out.reasoningEl?.closest('details');if(det){det.style.display='';out.reasoningEl.textContent=reasoning}}
        if(d.content){full+=d.content;out.contentEl.innerHTML=md(full)+'<span class="cursor"></span>';scroll()}
      }
    }
    out.contentEl.innerHTML=md(full)||'<em>No output</em>';addActions(out,full);
    chat.messages.push({role:'assistant',content:full,reasoning,modeLabel:mode});saveChats();
  }catch(err){out.contentEl.innerHTML='<em style="color:#f87171">Error: '+err.message+'</em>'}
  finally{busy=false;sendBtn.disabled=false;scroll();input.focus()}
}

sendBtn.onclick=()=>send();
input.addEventListener('input',resize);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
$('newChatBtn').onclick=newChat;
$('menuBtn').onclick=()=>$('sidebar').classList.toggle('collapsed');
$('collapseBtn').onclick=()=>$('sidebar').classList.add('collapsed');
$('suggestions').addEventListener('click',e=>{const b=e.target.closest('.sug');if(b)send(b.dataset.q)});
initModes();checkHealth();renderHistory();input.focus();
