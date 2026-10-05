(function(){
try{
if(window.supabase&&typeof window.supabase.createClient==="function"){
window.supabase=window.supabase.createClient("https://tflejorfkmyhdhlwluml.supabase.co","sb_publishable_ZnDDksa5LUlOEQWr-phzbA_gCjUOe9g");
window.circlaSupabase=window.supabase;
}else{console.error("Circla: Supabase SDK did not load.");window.circlaSupabase=null;}
}catch(e){console.error("Circla: Supabase initialization failed.",e);window.circlaSupabase=null;}
})();
