(function(){
function qs(s){return document.querySelector(s)}
function show(page){
document.querySelectorAll('.content').forEach(function(el){el.classList.toggle('hidden',el.id!=='page-'+page)})
document.querySelectorAll('[data-page]').forEach(function(el){el.classList.toggle('active',el.dataset.page===page)})
window.scrollTo(0,0)
}
function bind(){
document.addEventListener('click',function(e){
var nav=e.target.closest('[data-page]');
if(nav){e.preventDefault();show(nav.dataset.page);return}
if(e.target.closest('#newPost')){show('create');return}
if(e.target.closest('#topNotifications')){show('notifications');return}
if(e.target.closest('#topAuth')||e.target.closest('#topAvatar')){var a=qs('#authOverlay');if(a)a.classList.add('open');return}
if(e.target.closest('#authClose')){var c=qs('#authOverlay');if(c)c.classList.remove('open');return}
if(e.target.closest('#storyClose')){var sv=qs('#storyViewer');if(sv)sv.classList.add('hidden');return}
if(e.target.closest('#commentClose')){var co=qs('#commentOverlay');if(co)co.classList.add('hidden');return}
})
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();