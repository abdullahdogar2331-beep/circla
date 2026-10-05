const navItems=document.querySelectorAll("[data-page]");
const sections=document.querySelectorAll(".content");

function showPage(page){
  sections.forEach(s=>s.classList.toggle("hidden",s.id!==`page-${page}`));
  navItems.forEach(n=>n.classList.toggle("active",n.dataset.page===page));
  window.scrollTo({top:0,behavior:"smooth"});
  if(page==="home") loadFeedAndStories();
  if(page==="create") loadStoryAnalytics();
}
navItems.forEach(n=>n.addEventListener("click",()=>showPage(n.dataset.page)));

document.querySelectorAll(".like").forEach(btn=>btn.addEventListener("click",()=>{btn.classList.toggle("liked-btn");btn.firstChild.textContent=btn.classList.contains("liked-btn")?"♥ ":"♡ ";}));
document.getElementById("newPost")?.addEventListener("click",()=>showPage("create"));

const supabase=window.circlaSupabase;
const authOverlay=document.getElementById("authOverlay");
const authForm=document.getElementById("authForm");
const authSwitch=document.getElementById("authSwitch");
const authClose=document.getElementById("authClose");
const authTitle=document.getElementById("authTitle");
const authSubtitle=document.getElementById("authSubtitle");
const authSubmit=document.getElementById("authSubmit");
const authNameWrap=document.getElementById("authNameWrap");
const authMessage=document.getElementById("authMessage");
const authLogout=document.getElementById("authLogout");
let loginMode=false;

function openAuth(){authOverlay?.classList.add("open");}
function closeAuth(){authOverlay?.classList.remove("open");}

function setAuthMode(login){
  loginMode=login;
  authTitle.textContent=login?"Welcome back.":"Join your circle.";
  authSubtitle.textContent=login?"Log in to continue to Circla.":"Create an account to start sharing moments.";
  authSubmit.textContent=login?"Log in":"Create account";
  authNameWrap.classList.toggle("hidden",login);
  authSwitch.innerHTML=login?'New to Circla? <b>Create an account</b>':'Already have an account? <b>Log in</b>';
  authMessage.textContent="";
}
authSwitch?.addEventListener("click",()=>setAuthMode(!loginMode));
authClose?.addEventListener("click",closeAuth);

async function getUser(){
  if(!supabase)return null;
  const {data:{user}}=await supabase.auth.getUser();
  return user||null;
}

async function refreshAuth(){
  if(!supabase)return;
  const {data:{session}}=await supabase.auth.getSession();
  const avatar=document.querySelector(".topbar .avatar");
  if(session){
    const name=session.user.user_metadata?.display_name||session.user.email||"A";
    if(avatar) avatar.textContent=name.charAt(0).toUpperCase();
    authLogout?.classList.remove("hidden");
    document.querySelectorAll(".auth-trigger").forEach(x=>x.textContent="Account");
  }else{
    if(avatar) avatar.textContent="A";
    authLogout?.classList.add("hidden");
    document.querySelectorAll(".auth-trigger").forEach(x=>x.textContent="Log in");
  }
  await loadFeedAndStories();
  await loadStoryAnalytics();
}

document.querySelector(".topbar .avatar")?.addEventListener("click",openAuth);
authLogout?.addEventListener("click",async()=>{
  await supabase.auth.signOut();
  closeAuth();
  await refreshAuth();
});

authForm?.addEventListener("submit",async e=>{
  e.preventDefault();
  authMessage.textContent="";
  authSubmit.disabled=true;
  try{
    const email=document.getElementById("authEmail").value.trim();
    const password=document.getElementById("authPassword").value;
    let result;
    if(loginMode){
      result=await supabase.auth.signInWithPassword({email,password});
    }else{
      const display_name=document.getElementById("authName").value.trim()||"New Circla User";
      result=await supabase.auth.signUp({email,password,options:{data:{display_name}}});
    }
    if(result.error) throw result.error;
    authMessage.textContent=loginMode?"You're logged in.":"Account created. Check your email if confirmation is required.";
    if(loginMode) closeAuth();
    await refreshAuth();
  }catch(err){
    authMessage.textContent=err.message||"Something went wrong.";
  }finally{
    authSubmit.disabled=false;
  }
});

async function uploadMedia(file,mode){
  const user=await getUser();
  if(!user){openAuth();throw new Error("Please log in first.");}
  if(!file) throw new Error("Please choose a file.");
  if(file.size>50*1024*1024) throw new Error("Maximum file size is 50 MB.");
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-");
  const path=`${user.id}/${Date.now()}-${safe}`;
  const up=await supabase.storage.from("media").upload(path,file,{upsert:false,contentType:file.type});
  if(up.error) throw up.error;
  const {data}=supabase.storage.from("media").getPublicUrl(path);
  const mediaUrl=data.publicUrl;
  const mediaType=file.type.startsWith("video/")?"video":"image";
  if(mode==="post"){
    const ins=await supabase.from("posts").insert({user_id:user.id,media_url:mediaUrl,media_type:mediaType});
    if(ins.error) throw ins.error;
  }else{
    const ins=await supabase.from("stories").insert({user_id:user.id,media_url:mediaUrl,media_type:mediaType});
    if(ins.error) throw ins.error;
  }
  return mediaUrl;
}

const mediaInput=document.getElementById("mediaInput");
const choosePost=document.getElementById("choosePost");
const chooseStory=document.getElementById("chooseStory");
const uploadStatus=document.getElementById("uploadStatus");
let uploadMode="post";

choosePost?.addEventListener("click",async()=>{
  uploadMode="post";
  const user=await getUser();
  if(!user){openAuth();return;}
  mediaInput?.click();
});
chooseStory?.addEventListener("click",async()=>{
  uploadMode="story";
  const user=await getUser();
  if(!user){openAuth();return;}
  mediaInput?.click();
});

mediaInput?.addEventListener("change",async()=>{
  const file=mediaInput.files?.[0];
  if(!file)return;
  uploadStatus.textContent="Uploading your moment…";
  try{
    await uploadMedia(file,uploadMode);
    uploadStatus.textContent=uploadMode==="post"?"Post uploaded successfully.":"Story uploaded successfully — live for 24 hours.";
    mediaInput.value="";
    await loadFeedAndStories();
    await loadStoryAnalytics();
  }catch(err){
    uploadStatus.textContent=err.message||"Upload failed.";
  }
});

function mediaElement(url,type,className="live-media"){
  if(type==="video"){
    const v=document.createElement("video");
    v.src=url;v.controls=true;v.playsInline=true;v.className=className;
    return v;
  }
  const img=document.createElement("img");
  img.src=url;img.alt="Circla post";img.className=className;img.loading="lazy";
  return img;
}

async function loadFeedAndStories(){
  if(!supabase)return;
  const feed=document.getElementById("feedList");
  const strip=document.getElementById("storiesStrip");
  if(!feed||!strip)return;

  const {data:posts}=await supabase.from("posts").select("id,user_id,media_url,media_type,caption,created_at,profiles(display_name,username)").order("created_at",{ascending:false}).limit(20);
  if(posts?.length){
    feed.innerHTML="";
    posts.forEach(post=>{
      const article=document.createElement("article");
      article.className="post";
      const name=post.profiles?.display_name||"Circla User";
      const initial=name.charAt(0).toUpperCase();
      article.innerHTML=`<div class="post-head"><div class="avatar">${initial}</div><div><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(post.profiles?.username||"user")} · ${timeAgo(post.created_at)}</small></div><button class="more">•••</button></div>`;
      const text=document.createElement("p");
      text.className="post-text";
      text.textContent=post.caption||"A new moment on Circla.";
      article.appendChild(text);
      const wrap=document.createElement("div");
      wrap.className="post-media live-post-media";
      wrap.appendChild(mediaElement(post.media_url,post.media_type));
      article.appendChild(wrap);
      article.insertAdjacentHTML("beforeend",`<div class="post-actions"><button class="like">♡ <span>0</span></button><button>◯ <span>0</span></button><button>⌁ <span>0</span></button><button class="save">♧</button></div>`);
      feed.appendChild(article);
    });
  }

  const {data:stories}=await supabase.from("stories").select("id,user_id,media_url,media_type,created_at,expires_at,profiles(display_name,username)").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(20);
  const {data:{user}}=await supabase.auth.getUser();
  strip.innerHTML='<div class="story add-story" id="quickStory"><div class="story-avatar plus">＋</div><span>Your story</span></div>';
  stories?.forEach(story=>{
    const name=story.profiles?.display_name||"Circla User";
    const item=document.createElement("button");
    item.className="story live-story";
    item.type="button";
    item.innerHTML=`<div class="story-ring"><div class="avatar">${name.charAt(0).toUpperCase()}</div></div><span>${escapeHtml(name)}</span></button>`;
    item.addEventListener("click",()=>openStory(story,user));
    strip.appendChild(item);
  });
  document.getElementById("quickStory")?.addEventListener("click",()=>showPage("create"));
}

async function openStory(story,user){
  const owner=story.user_id===user?.id;
  const overlay=document.createElement("div");
  overlay.className="story-viewer";
  overlay.innerHTML='<button class="story-close">×</button><div class="story-view-card"><div class="story-view-media"></div><div class="story-view-info"></div></div>';
  document.body.appendChild(overlay);
  overlay.querySelector(".story-view-media").appendChild(mediaElement(story.media_url,story.media_type,"story-view-media-el"));
  overlay.querySelector(".story-view-info").textContent=story.profiles?.display_name||"Circla User";
  overlay.querySelector(".story-close").onclick=()=>overlay.remove();

  if(!owner&&user){
    const view=await supabase.from("story_views").insert({story_id:story.id,viewer_id:user.id});
    if(view.error) console.warn("Story view could not be recorded:",view.error.message);
  }else if(!user){
    overlay.querySelector(".story-view-info").textContent+=" · Log in to record your view";
  }

  if(owner){
    const {data:views}=await supabase.from("story_views").select("id,viewer_id,viewed_at,profiles(display_name,username)").eq("story_id",story.id).order("viewed_at",{ascending:false});
    const info=overlay.querySelector(".story-view-info");
    const total=views?.length||0;
    const unique=new Set((views||[]).map(v=>v.viewer_id)).size;
    info.innerHTML=`<strong>${escapeHtml(story.profiles?.display_name||"Your story")}</strong><span>${total} total views · ${unique} unique viewers</span>`;
    (views||[]).slice(0,20).forEach(v=>{
      const row=document.createElement("div");
      row.className="viewer-row";
      row.textContent=`${v.profiles?.display_name||"Circla User"} · ${timeAgo(v.viewed_at)}`;
      info.appendChild(row);
    });
  }
}

async function loadStoryAnalytics(){
  const list=document.getElementById("analyticsList");
  if(!list||!supabase)return;
  const user=await getUser();
  if(!user){list.innerHTML='<p class="muted">Log in and upload a story to see viewer analytics.</p>';return;}
  const {data:stories,error}=await supabase.from("stories").select("id,created_at,expires_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(10);
  if(error){list.textContent=error.message;return;}
  if(!stories?.length){list.innerHTML='<p class="muted">No stories yet. Add your first story above.</p>';return;}
  list.innerHTML="";
  for(const story of stories){
    const {data:views}=await supabase.from("story_views").select("viewer_id,viewed_at,profiles(display_name)").eq("story_id",story.id).order("viewed_at",{ascending:false});
    const total=views?.length||0;
    const unique=new Set((views||[]).map(v=>v.viewer_id)).size;
    const row=document.createElement("div");
    row.className="analytics-row";
    row.innerHTML=`<div><b>${new Date(story.created_at).toLocaleString()}</b><small>${story.expires_at>new Date().toISOString()?"Live":"Expired"}</small></div><strong>${total} views<small>${unique} unique</small></strong>`;
    list.appendChild(row);
  }
}

function timeAgo(date){
  const seconds=Math.max(1,Math.floor((Date.now()-new Date(date).getTime())/1000));
  if(seconds<60)return seconds+"s";
  const minutes=Math.floor(seconds/60);if(minutes<60)return minutes+"m";
  const hours=Math.floor(minutes/60);if(hours<24)return hours+"h";
  return Math.floor(hours/24)+"d";
}
function escapeHtml(value){return String(value||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));}

document.addEventListener("DOMContentLoaded",async()=>{
  setAuthMode(false);
  await refreshAuth();
});
