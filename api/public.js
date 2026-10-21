const U="10767392366",P="78574155859097";
async function j(u){try{const c=new AbortController(),t=setTimeout(()=>c.abort(),8000),r=await fetch(u,{headers:{accept:"application/json"},signal:c.signal});clearTimeout(t);if(!r.ok)return{error:r.status};return await r.json()}catch(e){return{error:String(e)}}}
export default async function handler(req,res){
const [game,votes,badges,servers,passes,icon]=await Promise.all([
j("https://games.roblox.com/v1/games?universeIds="+U),
j("https://games.roblox.com/v1/games/votes?universeIds="+U),
j("https://badges.roblox.com/v1/universes/"+U+"/badges?limit=100&sortOrder=Asc"),
j("https://games.roblox.com/v1/games/"+P+"/servers/Public?limit=100"),
j("https://apis.roblox.com/game-passes/v1/universes/"+U+"/game-passes?passView=Full&pageSize=50"),
j("https://thumbnails.roblox.com/v1/games/icons?universeIds="+U+"&size=256x256&format=Png")]);
res.setHeader("content-type","application/json; charset=utf-8");
res.setHeader("cache-control","s-maxage=30, stale-while-revalidate=60");
res.status(200).send(JSON.stringify({at:new Date().toISOString(),game,votes,badges,servers,passes,icon}))}
