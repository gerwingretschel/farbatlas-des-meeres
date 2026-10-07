import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
const DS="farbatlas-datasets-v10",IS="farbatlas-images-v10";
const reply=(b,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const dkey=n=>"dataset-"+crypto.createHash("sha256").update(String(n).trim().toLowerCase()).digest("hex");
const ph=(p,s)=>crypto.pbkdf2Sync(String(p),s,210000,32,"sha256").toString("hex");
const sign=p=>crypto.createHmac("sha256",process.env.ADMIN_PASSWORD||"").update(p).digest("base64url");
const token=()=>{const p=Buffer.from(JSON.stringify({exp:Date.now()+28800000})).toString("base64url");return p+"."+sign(p)};
const valid=t=>{try{const[p,s]=String(t||"").split(".");return !!p&&s===sign(p)&&JSON.parse(Buffer.from(p,"base64url")).exp>Date.now()}catch{return false}};
async function auth(store,n,p){const x=await store.get(dkey(n),{type:"json",consistency:"strong"});if(!x)return{e:reply({error:"Datensatz nicht gefunden."},404)};if(ph(p,x.salt)!==x.passwordHash)return{e:reply({error:"Datensatz-Passwort ist falsch."},401)};return{x}}
export default async req=>{if(req.method!=="POST")return reply({error:"Methode nicht erlaubt."},405);try{const b=await req.json(),ds=getStore(DS),imgs=getStore(IS);
if(b.action==="admin-login"){if(!process.env.ADMIN_PASSWORD)return reply({error:"ADMIN_PASSWORD fehlt in Netlify."},500);if(String(b.password||"")!==process.env.ADMIN_PASSWORD)return reply({error:"Administrator-Passwort ist falsch."},401);return reply({token:token()})}
if(b.action==="load"){const a=await auth(ds,b.name,b.password);return a.e||reply({name:a.x.name,payload:a.x.payload})}
if(b.action==="get-image"){const a=await auth(ds,b.name,b.password);if(a.e)return a.e;const ab=await imgs.get(b.imageKey,{type:"arrayBuffer"});if(!ab)return reply({error:"Bild nicht gefunden."},404);const m=await imgs.getMetadata(b.imageKey);return reply({data:Buffer.from(ab).toString("base64"),type:m?.metadata?.contentType||"image/jpeg"})}
const bearer=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");if(!valid(bearer))return reply({error:"Administrator-Anmeldung erforderlich."},401);
if(b.action==="upload-image"){const a=await auth(ds,b.name,b.password);if(a.e)return a.e;if(!b.data||!b.fileName)return reply({error:"Bilddaten fehlen."},400);const bytes=Buffer.from(b.data,"base64");if(bytes.length>3800000)return reply({error:"Das vorbereitete Einzelbild ist noch zu groß."},413);const k="image-"+crypto.randomUUID();await imgs.set(k,bytes,{metadata:{contentType:b.type||"image/jpeg",fileName:String(b.fileName),dataset:dkey(b.name)}});return reply({imageKey:k})}
if(b.action==="save"){if(!b.name||!b.password||!b.payload)return reply({error:"Name, Passwort und Datensatz sind erforderlich."},400);const k=dkey(b.name),old=await ds.get(k,{type:"json",consistency:"strong"});if(b.create===true&&old)return reply({error:"Datensatzname bereits vergeben."},409);if(b.create!==true&&!old)return reply({error:"Datensatz noch nicht vorhanden."},404);if(old&&ph(b.password,old.salt)!==old.passwordHash)return reply({error:"Datensatz-Passwort ist falsch."},401);const salt=old?.salt||crypto.randomBytes(16).toString("hex");await ds.setJSON(k,{name:String(b.name).trim(),salt,passwordHash:ph(b.password,salt),payload:b.payload,updatedAt:new Date().toISOString()});return reply({message:old?"Datensatz wurde erfolgreich aktualisiert.":"Datensatz wurde erfolgreich neu angelegt."})}
return reply({error:"Unbekannte Aktion."},400)}catch(e){console.error("V10",e);return reply({error:"Serverfehler: "+e.message},500)}};
export const config={path:"/api/farbatlas"};
