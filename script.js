const supabase=window.circlaSupabase;
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
let currentUser=null, currentProfile=null, loginMode=false, uploadMode="post", selectedPost=null, selectedConversation=null, realtimeChannel=null;

const navItems=$$("[data-page]"), sections=$$(".content");
function showPage(page){
  sections.forEach(s=>s.classList.toggle("hidden",s.id!==`page-${page}`));
  navItems.forEach(n=>n.classList.toggle("active",n.dataset.page===page));
  window.scrollTo({top:0,behavior:"smooth"});
  if(page==="home") loadHome();
  if(page==="explore") loadExplore($("#exploreSearch")?.value||"");
  if(page==="notifications") loadNotifications();
  if(page==="messages") loadConversations();
  if(page==="profile") loadProfile(currentUser?.id);
  if(page==="create") loadStoryAnalytics();
}
navItems.forEach(n=>n.addEventListener("click",()=>showPage(n.dataset.page)));
$("#newPost")?.addEventListener("click",()=>showPage("create"));
$("#topNotifications")?.addEventListener("click",()=>showPage("notifications"));

function openAuth(){ $("#authOverlay")?.classList.add("open"); }
function closeAuth(){ $("#authOverlay")?.classList.remove("open"); }
$("#topAvatar")?.addEventListener("click",openAuth);
$("#authClose")?.addEventListener("click",closeAuth);

function setAuthMode(login){
  loginMode=login;
  $("#authTitle").textContent=login?"Welcome back.":"Join your circle.";
  $("#authSubtitle").textContent=login?"Log in to continue to Circla.":"Create an account to start sharing moments.";
  $("#authSubmit").textContent=login?"Log in":"Create account";
  $("#authNameWrap").classList.toggle("hidden",login);
  $("#authUsernameWrap").classList.toggle("hidden",login);
  $("#authName").required=!login; $("#authUsername").required=!login;
  $("#authSwitch").innerHTML=login?'New to Circla? <b>Create an account</b>':'Already have an account? <b>Log in</b>';
  $("#authMessage").textContent="";
}
$("#authSwitch")?.addEventListener("click",()=>setAuthMode(!loginMode));

async function getUser(){ if(!supabase)return null; const {data:{user}}=await supabase.auth.getUser(); return user||null; }

async function refreshAuth(){
  if(!supabase)return;
  const {data:{session}}=await supabase.auth.getSession();
  currentUser=session?.user||null;
  if(currentUser){
    const {data}=await supabase.from("profiles").select("*").eq("id",currentUser.id).maybeSingle();
    currentProfile=data;
    const name=data?.display_name||currentUser.user_metadata?.display_name||currentUser.email||"A";
    $("#topAvatar").textContent=name.charAt(0).toUpperCase();
    $("#authLogout").classList.remove("hidden");
  }else{
    currentProfile=null; $("#topAvatar").textContent="A"; $("#authLogout").classList.remove("hidden"); $("#authLogout").classList.add("hidden");
  }
  await loadHome(); await loadNotifications(); await loadSuggestions();
  if(currentUser) subscribeRealtime();
}
$("#authLogout")?.addEventListener("click",async()=>{await supabase.auth.signOut();if(realtimeChannel)await supabase.removeChannel(realtimeChannel);closeAuth();await refreshAuth();showPage("home");});

$("#authForm")?.addEventListener("submit",async e=>{
  e.preventDefault(); const btn=$("#authSubmit"); btn.disabled=true; $("#authMessage").textContent="";
  try{
    const email=$("#authEmail").value.trim(), password=$("#authPassword").value;
    let result;
    if(loginMode) result=await supabase.auth.signInWithPassword({email,password});
    else{
      const display_name=$("#authName").value.trim(), username=$("#authUsername").value.trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
      if(username.length<3) throw new Error("Username must be at least 3 characters.");
      result=await supabase.auth.signUp({email,password,options:{data:{display_name,username}}});
    }
    if(result.error)throw result.error;
    $("#authMessage").textContent=loginMode?"You're logged in.":"Account created. Check your email if confirmation is required.";
    if(loginMode)closeAuth(); await refreshAuth();
  }catch(err){$("#authMessage").textContent=err.message||"Something went wrong."}
  finally{btn.disabled=false}
});

async function uploadMedia(file,mode){
  if(!currentUser){openAuth();throw new Error("Please log in first.");}
  if(!file)throw new Error("Please choose a file.");
  if(file.size>50*1024*1024)throw new Error("Maximum file size is 50 MB.");
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"-"), path=`${currentUser.id}/${Date.now()}-${safe}`;
  const up=await supabase.storage.from("media").upload(path,file,{upsert:false,contentType:file.type});
  if(up.error)throw up.error;
  const {data}=supabase.storage.from("media").getPublicUrl(path);
  const media_type=file.type.startsWith("video/")?"video":"image";
  const payload=mode==="post"?{user_id:currentUser.id,media_url:data.publicUrl,media_type,caption:$("#captionInput").value.trim()}:{user_id:currentUser.id,media_url:data.publicUrl,media_type};
  const ins=await supabase.from(mode==="post"?"posts":"stories").insert(payload);
  if(ins.error)throw ins.error;
}
$("#choosePost")?.addEventListener("click",async()=>{uploadMode="post";if(!currentUser){openAuth();return}$("#mediaInput").click()});
$("#chooseStory")?.addEventListener("click",async()=>{uploadMode="story";if(!currentUser){openAuth();return}$("#mediaInput").click()});
$("#mediaInput")?.addEventListener("change",async()=>{
  const file=$("#mediaInput").files?.[0]; if(!file)return; $("#uploadStatus").textContent="Uploading…";
  try{await uploadMedia(file,uploadMode);$("#uploadStatus").textContent=uploadMode==="post"?"Post published.":"Story published for 24 hours.";$("#mediaInput").value="";$("#captionInput").value="";await loadHome();await loadStoryAnalytics()}
  catch(e){$("#uploadStatus").textContent=e.message||"Upload failed."}
});

function mediaElement(url,type,cls="live-media"){
  if(type==="video"){const v=document.createElement("video");v.src=url;v.controls=true;v.playsInline=true;v.className=cls;return v}
  const img=document.createElement("img");img.src=url;img.alt="Circla";img.className=cls;img.loading="lazy";return img;
}
function avatar(initial,cls="avatar"){return `<div class="${cls}">${escapeHtml(initial||"C")}</div>`}

async function loadHome(){
  if(!supabase)return;
  const feed=$("#feedList"), strip=$("#storiesStrip"); if(!feed||!strip)return;
  const [{data:posts,error:pe},{data:stories}]=await Promise.all([
    supabase.from("posts").select("id,user_id,media_url,media_type,caption,created_at,profiles(display_name,username,avatar_url)").order("created_at",{ascending:false}).limit(30),
    supabase.from("stories").select("id,user_id,media_url,media_type,created_at,expires_at,profiles(display_name,username,avatar_url)").gt("expires_at",new Date().toISOString()).order("created_at",{ascending:false}).limit(30)
  ]);
  if(pe){feed.innerHTML=`<div class="empty-state">Could not load feed: ${escapeHtml(pe.message)}</div>`;return}
  feed.innerHTML="";
  for(const post of posts||[]){
    const [{count:likes},{count:comments}]=await Promise.all([
      supabase.from("post_likes").select("*",{count:"exact",head:true}).eq("post_id",post.id),
      supabase.from("comments").select("*",{count:"exact",head:true}).eq("post_id",post.id)
    ]);
    let liked=false;if(currentUser){const {data}=await supabase.from("post_likes").select("post_id").eq("post_id",post.id).eq("user_id",currentUser.id).maybeSingle();liked=!!data}
    const name=post.profiles?.display_name||"Circla User", initial=name[0]?.toUpperCase()||"C";
    const article=document.createElement("article");article.className="post";
    const head=`<div class="post-head">${avatar(initial)}<div><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(post.profiles?.username||"user")} · ${timeAgo(post.created_at)}</small></div><button class="more" data-profile="${post.user_id}">•••</button></div>`;
    article.innerHTML=head;
    const text=document.createElement("p");text.className="post-text";text.textContent=post.caption||"A new moment on Circla.";article.appendChild(text);
    const wrap=document.createElement("div");wrap.className="post-media live-post-media";wrap.appendChild(mediaElement(post.media_url,post.media_type));article.appendChild(wrap);
    const actions=document.createElement("div");actions.className="post-actions";
    actions.innerHTML=`<button class="post-like ${liked?"liked-btn":""}" data-post="${post.id}">${liked?"♥":"♡"} <span>${likes||0}</span></button><button class="comment-btn" data-post="${post.id}">◯ <span>${comments||0}</span></button><button class="share-btn" data-post="${post.id}">⌁</button><button class="save">♧</button>`;
    article.appendChild(actions);feed.appendChild(article);
  }
  if(!posts?.length)feed.innerHTML='<div class="empty-state">No posts yet. Be the first to share a moment.</div>';
  $$(".post-like").forEach(b=>b.addEventListener("click",()=>toggleLike(b.dataset.post,b)));
  $$(".comment-btn").forEach(b=>b.addEventListener("click",()=>openComments(b.dataset.post)));
  $$(".share-btn").forEach(b=>b.addEventListener("click",()=>sharePost(b.dataset.post)));
  $$(".more").forEach(b=>b.addEventListener("click",()=>loadProfile(b.dataset.profile)));
  renderStories(stories||[]);
  await loadMiniProfile();
}

function renderStories(stories){
  const strip=$("#storiesStrip"); strip.innerHTML=`<button class="story add-story" id="quickStory"><div class="story-avatar plus">＋</div><span>Your story</span></button>`;
  stories.forEach(story=>{
    const name=story.profiles?.display_name||"Circla User", item=document.createElement("button");item.className="story live-story";item.innerHTML=`<div class="story-ring"><div class="avatar">${escapeHtml(name[0]?.toUpperCase()||"C")}</div></div><span>${escapeHtml(name)}</span>`;
    item.addEventListener("click",()=>openStory(story));strip.appendChild(item);
  });
  $("#quickStory")?.addEventListener("click",()=>showPage("create"));
}

async function openStory(story){
  const owner=story.user_id===currentUser?.id, viewer=$("#storyViewer");viewer.classList.remove("hidden");
  const box=$("#storyViewMedia");box.innerHTML="";box.appendChild(mediaElement(story.media_url,story.media_type,"story-view-media-el"));
  $("#storyViewInfo").innerHTML=`<strong>${escapeHtml(story.profiles?.display_name||"Circla User")}</strong><span>${owner?"Your story":"Story"}</span>`;
  if(!owner&&currentUser){await supabase.from("story_views").insert({story_id:story.id,viewer_id:currentUser.id})}
  if(owner){
    const {data:views}=await supabase.from("story_views").select("id,viewer_id,viewed_at,profiles(display_name,username)").eq("story_id",story.id).order("viewed_at",{ascending:false});
    const unique=new Set((views||[]).map(v=>v.viewer_id)).size;
    $("#storyViewInfo").innerHTML=`<strong>Your story</strong><span>${views?.length||0} total views · ${unique} unique viewers</span>${(views||[]).slice(0,30).map(v=>`<div class="viewer-row">${escapeHtml(v.profiles?.display_name||"User")} · ${timeAgo(v.viewed_at)}</div>`).join("")}`;
  }
}
$("#storyClose")?.addEventListener("click",()=>$("#storyViewer").classList.add("hidden"));

async function toggleLike(postId,button){
  if(!currentUser){openAuth();return}
  const {data:existing}=await supabase.from("post_likes").select("post_id").eq("post_id",postId).eq("user_id",currentUser.id).maybeSingle();
  if(existing)await supabase.from("post_likes").delete().eq("post_id",postId).eq("user_id",currentUser.id);
  else await supabase.from("post_likes").insert({post_id:postId,user_id:currentUser.id});
  await loadHome();
}

async function openComments(postId){
  selectedPost=postId;$("#commentOverlay").classList.remove("hidden");await loadComments(postId);
}
$("#commentClose")?.addEventListener("click",()=>$("#commentOverlay").classList.add("hidden"));
async function loadComments(postId){
  const {data}=await supabase.from("comments").select("id,body,created_at,profiles(display_name,username)").eq("post_id",postId).order("created_at",{ascending:false}).limit(50);
  $("#commentsList").innerHTML=(data||[]).map(c=>`<div class="comment-row"><b>${escapeHtml(c.profiles?.display_name||"User")}</b><p>${escapeHtml(c.body)}</p><small>${timeAgo(c.created_at)}</small></div>`).join("")||'<p class="muted">No comments yet.</p>';
}
$("#commentForm")?.addEventListener("submit",async e=>{e.preventDefault();if(!currentUser){openAuth();return}const body=$("#commentInput").value.trim();if(!body)return;await supabase.from("comments").insert({post_id:selectedPost,user_id:currentUser.id,body});$("#commentInput").value="";await loadComments(selectedPost);await loadHome()});
async function sharePost(id){const url=location.href.split("#")[0]+`?post=${id}`;try{await navigator.clipboard.writeText(url);alert("Post link copied.")}catch{alert(url)}}

async function loadSuggestions(){
  const list=$("#suggestionsList");if(!list||!supabase)return;
  const {data}=await supabase.from("profiles").select("id,display_name,username").order("created_at",{ascending:false}).limit(8);
  list.innerHTML="";
  for(const p of data||[]){if(p.id===currentUser?.id)continue;const {data:f}=currentUser?await supabase.from("follows").select("follower_id").eq("follower_id",currentUser.id).eq("following_id",p.id).maybeSingle():{data:null};const row=document.createElement("div");row.className="suggest";row.innerHTML=`${avatar(p.display_name?.[0]?.toUpperCase())}<div><b>${escapeHtml(p.display_name)}</b><small>@${escapeHtml(p.username)}</small></div><button data-follow="${p.id}">${f?"Following":"Follow"}</button>`;list.appendChild(row)}
  $$("#suggestionsList [data-follow]").forEach(b=>b.addEventListener("click",()=>toggleFollow(b.dataset.follow,b)));
}
async function toggleFollow(target,b){
  if(!currentUser){openAuth();return}
  const {data}=await supabase.from("follows").select("follower_id").eq("follower_id",currentUser.id).eq("following_id",target).maybeSingle();
  if(data)await supabase.from("follows").delete().eq("follower_id",currentUser.id).eq("following_id",target);else await supabase.from("follows").insert({follower_id:currentUser.id,following_id:target});
  await loadSuggestions();if(selectedConversation)await loadConversations();
}
async function loadMiniProfile(){
  const box=$("#miniProfile");if(!box)return;
  if(!currentUser){box.innerHTML='<p class="muted">Log in to build your circle.</p>';return}
  const [{count:followers},{count:following},{count:posts}]=await Promise.all([
    supabase.from("follows").select("*",{count:"exact",head:true}).eq("following_id",currentUser.id),
    supabase.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",currentUser.id),
    supabase.from("posts").select("*",{count:"exact",head:true}).eq("user_id",currentUser.id)
  ]);
  const name=currentProfile?.display_name||"Circla User";box.innerHTML=`<div class="profile-main">${avatar(name[0]?.toUpperCase(),"avatar large")}<div><strong>${escapeHtml(name)}</strong><small>@${escapeHtml(currentProfile?.username||"user")}</small></div></div><div class="stats"><span><b>${posts||0}</b> posts</span><span><b>${followers||0}</b> followers</span><span><b>${following||0}</b> following</span></div>`;
}

async function loadProfile(userId){
  if(!userId)return;
  showPageWithoutLoop("profile");
  const {data:p}=await supabase.from("profiles").select("*").eq("id",userId).maybeSingle();if(!p)return;
  const [{count:followers},{count:following},{count:posts}]=await Promise.all([
    supabase.from("follows").select("*",{count:"exact",head:true}).eq("following_id",userId),
    supabase.from("follows").select("*",{count:"exact",head:true}).eq("follower_id",userId),
    supabase.from("posts").select("*",{count:"exact",head:true}).eq("user_id",userId)
  ]);
  let followingMe=false;if(currentUser&&currentUser.id!==userId){const {data}=await supabase.from("follows").select("follower_id").eq("follower_id",currentUser.id).eq("following_id",userId).maybeSingle();followingMe=!!data}
  const own=currentUser?.id===userId;
  $("#profileHero").innerHTML=`<div class="avatar huge">${escapeHtml(p.display_name?.[0]?.toUpperCase()||"C")}</div><div><p class="eyebrow">@${escapeHtml(p.username)}</p><h1>${escapeHtml(p.display_name)}</h1><p>${escapeHtml(p.bio||"Sharing moments on Circla.")}</p><div class="profile-stats"><b>${posts||0} <span>Posts</span></b><b>${followers||0} <span>Followers</span></b><b>${following||0} <span>Following</span></b></div></div><div class="profile-actions">${own?'<button class="outline-btn" id="editProfile">Edit profile</button>':`<button class="create-btn" id="followProfile">${followingMe?"Following":"Follow"}</button><button class="outline-btn" id="messageProfile">Message</button>`}</div>`;
  $("#editProfile")?.addEventListener("click",editProfile);$("#followProfile")?.addEventListener("click",async()=>{await toggleFollow(userId,$("#followProfile"));await loadProfile(userId)});$("#messageProfile")?.addEventListener("click",()=>startConversation(userId));
  const {data:userPosts}=await supabase.from("posts").select("id,media_url,media_type,caption,created_at").eq("user_id",userId).order("created_at",{ascending:false}).limit(30);
  $("#profileGrid").innerHTML="";(userPosts||[]).forEach(post=>{const card=document.createElement("div");card.className="profile-tile";card.appendChild(mediaElement(post.media_url,post.media_type,"profile-media"));card.title=post.caption||"";$("#profileGrid").appendChild(card)});
}
function showPageWithoutLoop(page){sections.forEach(s=>s.classList.toggle("hidden",s.id!==`page-${page}`));navItems.forEach(n=>n.classList.toggle("active",n.dataset.page===page));window.scrollTo({top:0,behavior:"smooth"})}
async function editProfile(){if(!currentUser)return;const name=prompt("Display name",currentProfile?.display_name||"");if(name===null)return;const bio=prompt("Bio",currentProfile?.bio||"");if(bio===null)return;const {error}=await supabase.from("profiles").update({display_name:name.trim(),bio:bio.trim()}).eq("id",currentUser.id);if(error)alert(error.message);else{const {data}=await supabase.from("profiles").select("*").eq("id",currentUser.id).single();currentProfile=data;await loadProfile(currentUser.id);await loadMiniProfile()}}

async function loadExplore(q=""){
  const grid=$("#exploreGrid"),results=$("#searchResults");if(!grid||!results)return;
  if(q.trim()){
    const term=q.trim().replace(/[%_]/g,"");
    const {data}=await supabase.from("profiles").select("id,display_name,username,bio").or(`display_name.ilike.%${term}%,username.ilike.%${term}%`).limit(30);
    results.innerHTML=(data||[]).map(p=>`<div class="search-result"><div class="avatar">${escapeHtml(p.display_name?.[0]?.toUpperCase()||"C")}</div><div><b>${escapeHtml(p.display_name)}</b><small>@${escapeHtml(p.username)}</small><p>${escapeHtml(p.bio||"")}</p></div><button class="outline-btn" data-search-profile="${p.id}">View</button></div>`).join("")||'<p class="muted">No people found.</p>';
    $$("#searchResults [data-search-profile]").forEach(b=>b.addEventListener("click",()=>loadProfile(b.dataset.searchProfile)));
  }else results.innerHTML="";
  const {data:posts}=await supabase.from("posts").select("id,media_url,media_type").order("created_at",{ascending:false}).limit(18);
  grid.innerHTML="";(posts||[]).forEach(p=>{const tile=document.createElement("div");tile.className="tile explore-media";tile.appendChild(mediaElement(p.media_url,p.media_type,"explore-media-el"));grid.appendChild(tile)});
}
$("#exploreSearchBtn")?.addEventListener("click",()=>loadExplore($("#exploreSearch").value));
$("#exploreSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter")loadExplore(e.target.value)});
$("#globalSearch")?.addEventListener("keydown",e=>{if(e.key==="Enter"){showPage("explore");$("#exploreSearch").value=e.target.value;loadExplore(e.target.value)}});

async function loadNotifications(){
  const list=$("#notificationsList"),dot=$("#notificationDot");if(!list||!supabase)return;
  if(!currentUser){list.innerHTML='<p class="muted">Log in to see your activity.</p>';dot?.classList.add("hidden");return}
  const {data}=await supabase.from("notifications").select("id,type,entity_id,created_at,read_at,profiles!notifications_actor_id_fkey(display_name,username)").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(50);
  dot?.classList.toggle("hidden",!(data||[]).some(n=>!n.read_at));
  list.innerHTML=(data||[]).map(n=>`<button class="notification-item ${n.read_at?"":"unread"}" data-notification="${n.id}"><span class="notif-icon">${n.type==="like"?"♥":n.type==="comment"?"◯":"＋"}</span><span><b>${escapeHtml(n.profiles?.display_name||"Someone")}</b> ${n.type==="like"?"liked your post":n.type==="comment"?"commented on your post":"started following you"}<small>${timeAgo(n.created_at)}</small></span></button>`).join("")||'<p class="muted">Nothing here yet.</p>';
  $$(".notification-item").forEach(b=>b.addEventListener("click",async()=>{await supabase.from("notifications").update({read_at:new Date().toISOString()}).eq("id",b.dataset.notification);b.classList.remove("unread");$("#notificationDot").classList.add("hidden")}));
}

async function loadConversations(){
  const list=$("#chatList");if(!list||!supabase)return;
  if(!currentUser){list.innerHTML='<p class="muted">Log in to use messages.</p>';$("#chatPanel").innerHTML='<div class="empty-chat">Log in to start chatting.</div>';return}
  const {data:members}=await supabase.from("conversation_members").select("conversation_id,user_id,profiles(id,display_name,username)").eq("user_id",currentUser.id);
  const convIds=[...new Set((members||[]).map(m=>m.conversation_id))];list.innerHTML="";
  for(const id of convIds){
    const {data:all}=await supabase.from("conversation_members").select("user_id,profiles(id,display_name,username)").eq("conversation_id",id);
    const other=(all||[]).find(x=>x.user_id!==currentUser.id)?.profiles;
    if(!other)continue;
    const row=document.createElement("button");row.className="chat-item";row.innerHTML=`${avatar(other.display_name?.[0]?.toUpperCase())}<span><b>${escapeHtml(other.display_name)}</b><small>@${escapeHtml(other.username)}</small></span>`;row.onclick=()=>openConversation(id,other);list.appendChild(row);
  }
  if(!convIds.length)list.innerHTML='<p class="muted chat-empty">No conversations yet. Find someone in Explore and tap Message.</p>';
}
async function startConversation(otherId){
  if(!currentUser){openAuth();return}
  const {data:existingMembers}=await supabase.from("conversation_members").select("conversation_id").eq("user_id",currentUser.id);
  for(const m of existingMembers||[]){const {data:other}=await supabase.from("conversation_members").select("user_id").eq("conversation_id",m.conversation_id).eq("user_id",otherId).maybeSingle();if(other){showPage("messages");const {data:p}=await supabase.from("profiles").select("id,display_name,username").eq("id",otherId).single();return openConversation(m.conversation_id,p)}}
  const {data:conv,error}=await supabase.from("conversations").insert({}).select().single();if(error){alert(error.message);return}
  const firstMember=await supabase.from("conversation_members").insert({conversation_id:conv.id,user_id:currentUser.id});if(firstMember.error){alert(firstMember.error.message);return}const secondMember=await supabase.from("conversation_members").insert({conversation_id:conv.id,user_id:otherId});if(secondMember.error){alert(secondMember.error.message);return}
  showPage("messages");const {data:p}=await supabase.from("profiles").select("id,display_name,username").eq("id",otherId).single();await openConversation(conv.id,p);await loadConversations();
}
async function openConversation(id,other){
  selectedConversation=id;
  const panel=$("#chatPanel");panel.innerHTML=`<div class="chat-header">${avatar(other.display_name?.[0]?.toUpperCase())}<div><b>${escapeHtml(other.display_name)}</b><small>@${escapeHtml(other.username)}</small></div></div><div class="chat-messages" id="chatMessages"></div><form class="chat-form" id="chatForm"><input id="messageInput" maxlength="5000" placeholder="Write a message…" required><button class="create-btn">Send</button></form>`;
  await loadMessages(id);$("#chatForm").addEventListener("submit",sendMessage);
}
async function loadMessages(id){
  const box=$("#chatMessages");if(!box)return;
  const {data}=await supabase.from("messages").select("id,body,sender_id,created_at").eq("conversation_id",id).order("created_at",{ascending:true}).limit(200);
  box.innerHTML=(data||[]).map(m=>`<div class="message-bubble ${m.sender_id===currentUser.id?"mine":""}"><p>${escapeHtml(m.body)}</p><small>${timeAgo(m.created_at)}</small></div>`).join("");
  box.scrollTop=box.scrollHeight;
}
async function sendMessage(e){e.preventDefault();const input=$("#messageInput"),body=input.value.trim();if(!body||!selectedConversation)return;const {error}=await supabase.from("messages").insert({conversation_id:selectedConversation,sender_id:currentUser.id,body});if(error)alert(error.message);else{input.value="";await loadMessages(selectedConversation)}}

function subscribeRealtime(){
  if(realtimeChannel)return;
  realtimeChannel=supabase.channel("circla-live").on("postgres_changes",{event:"*",schema:"public",table:"messages"},async()=>{if(selectedConversation)await loadMessages(selectedConversation);await loadConversations()}).on("postgres_changes",{event:"*",schema:"public",table:"notifications"},async()=>{await loadNotifications()}).subscribe();
}
async function loadStoryAnalytics(){
  const list=$("#analyticsList");if(!list)return;
  if(!currentUser){list.innerHTML='<p class="muted">Log in and upload a story to see viewer analytics.</p>';return}
  const {data:stories,error}=await supabase.from("stories").select("id,created_at,expires_at").eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(10);
  if(error){list.textContent=error.message;return}
  if(!stories?.length){list.innerHTML='<p class="muted">No stories yet.</p>';return}
  list.innerHTML="";
  for(const story of stories){const {data:views}=await supabase.from("story_views").select("viewer_id,viewed_at,profiles(display_name)").eq("story_id",story.id).order("viewed_at",{ascending:false});const unique=new Set((views||[]).map(v=>v.viewer_id)).size;const row=document.createElement("div");row.className="analytics-row";row.innerHTML=`<div><b>${new Date(story.created_at).toLocaleString()}</b><small>${story.expires_at>new Date().toISOString()?"Live":"Expired"}</small></div><strong>${views?.length||0} views<small>${unique} unique</small></strong>`;list.appendChild(row)}
}

function timeAgo(date){const s=Math.max(1,Math.floor((Date.now()-new Date(date).getTime())/1000));if(s<60)return s+"s";const m=Math.floor(s/60);if(m<60)return m+"m";const h=Math.floor(m/60);if(h<24)return h+"h";return Math.floor(h/24)+"d"}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]))}

document.addEventListener("DOMContentLoaded",async()=>{setAuthMode(false);await refreshAuth();loadExplore("");});
