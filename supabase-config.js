window.circlaSupabase=null;
try{
  if(window.supabase&&typeof window.supabase.createClient==="function"){
    window.circlaSupabase=window.supabase.createClient("https://tflejorfkmyhdhlwluml.supabase.co","sb_publishable_ZnDDksa5LUlOEQWr-phzbA_gCjUOe9g");
  }
}catch(e){ console.warn("Circla backend unavailable:",e); }
