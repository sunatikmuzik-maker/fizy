import {randomBytes,createHash,scrypt as rawScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {seed,validJournal} from '../shared.mjs';
import {createCommunity} from './community.mjs';
const scrypt=promisify(rawScrypt),sha=x=>createHash('sha256').update(x).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
const read=(store,key)=>store.getWithMetadata(key,{type:'json',consistency:'strong'});
const salt=()=>randomBytes(16).toString('hex');
const passwordHash=async(p,s)=>(await scrypt(p,s,64)).toString('hex');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const makeSession=()=>{const token=randomBytes(32).toString('hex');return{token,stored:{hash:sha(token),csrf:randomBytes(24).toString('hex'),expires:Date.now()+7*86400000}}};
const cookie=(name,token,age=604800)=>`__Host-fizy=${name}.${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const json=(status,value,headers={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
async function parse(req){if(!req.headers.get('content-type')?.startsWith('application/json'))fail(415,'Ожидается JSON.');if(Number(req.headers.get('content-length'))>2e6)fail(413,'Файл слишком большой.');const reader=req.body?.getReader();if(!reader)fail(400,'Нет данных.');const chunks=[];let length=0;for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2e6){await reader.cancel();fail(413,'Данные превышают 2 МБ.')}chunks.push(value)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{fail(400,'Неверный JSON.')}}
function credentials(b){const name=String(b?.username||'').trim().toLowerCase(),password=b?.password;if(!/^[a-z0-9_]{3,32}$/.test(name))fail(400,'Логин: 3–32 латинские буквы, цифры или _.');if(typeof password!=='string'||password.length<12||password.length>128)fail(400,'Пароль: от 12 до 128 символов.');return{name,password}}
async function cas(store,key,change){for(let i=0;i<5;i++){const prev=await read(store,key);const next=await change(prev?.data);const r=await store.setJSON(key,next,prev?{onlyIfMatch:prev.etag}:{onlyIfNew:true});if(r.modified)return next}fail(409,'Данные изменились в другом окне. Обнови журнал и повтори.');}
async function limit(store,key,max){const now=Date.now();await cas(store,sha(key),old=>{const active=old&&old.until>now;if(active&&old.count>=max)fail(429,'Слишком много попыток. Подожди 10 минут.');return{until:active?old.until:now+600000,count:active?old.count+1:1}})}
function active(record,token){if(!record||record.deleted)return null;return record.sessions?.find(s=>s.hash===sha(token)&&s.expires>Date.now())}
export function createHandler({getStore,env=process.env}){
 const community=createCommunity({getStore,env});
 return async(req,context={})=>{
 try{
  if(!env.PUBLIC_URL)fail(503,'В Netlify задай PUBLIC_URL равным HTTPS-адресу сайта и выполни повторный deploy.');
  const expected=new URL(env.PUBLIC_URL).origin;const url=new URL(req.url);
  if(!expected.startsWith('https://'))fail(503,'PUBLIC_URL должен начинаться с https://.');
  if(url.origin!==expected)fail(403,'Открой основной адрес сайта: '+expected);
  const changing=!['GET','HEAD'].includes(req.method);
  if(changing&&req.headers.get('origin')!==expected)fail(403,'Недопустимый источник запроса.');
  const path=url.pathname.replace(/^\/\.netlify\/functions\/api/,'/api');
  const name=env.FIZY_STORE_NAME||'fizy-journal-v1';const users=getStore(name),rates=getStore(name+'-rate');
  if(path==='/api/health'&&req.method==='GET')return json(200,{ok:true});
  if(['/api/register','/api/login','/api/recover'].includes(path)&&req.method==='POST'){
   await limit(rates,'ip:'+(context.ip||'unknown'),20);
   const b=await parse(req),{name:username,password}=credentials(b);await limit(rates,'username:'+username,15);
   const key=sha(username),previous=await read(users,key),u=previous?.data;
   if(path==='/api/register'){
    if(env.ALLOW_SIGNUP==='0')fail(403,'Регистрация временно закрыта.');if(u&&!u.deleted)fail(409,'Этот логин уже занят.');
    const s=makeSession(),recovery=randomBytes(24).toString('hex'),pwSalt=salt();
    const record={id:randomBytes(16).toString('hex'),username,salt:pwSalt,password:await passwordHash(password,pwSalt),recovery:sha(recovery),created:Date.now(),sessions:[s.stored],journal:structuredClone(seed),revision:0};
    const result=await users.setJSON(key,record,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});if(!result.modified)fail(409,'Этот логин уже занят.');
    return json(201,{user:{username},csrf:s.stored.csrf,recoveryCode:recovery},{'Set-Cookie':cookie(username,s.token)})
   }
   if(path==='/api/recover'){
    if(!u||u.deleted||typeof b.recoveryCode!=='string'||!same(sha(b.recoveryCode.trim()),u.recovery))fail(401,'Неверный логин или код восстановления.');
    const s=makeSession(),recovery=randomBytes(24).toString('hex'),pwSalt=salt(),hashed=await passwordHash(password,pwSalt);
    await cas(users,key,current=>{if(!current||current.deleted||current.id!==u.id||current.recovery!==u.recovery)fail(401,'Код восстановления уже изменён.');return{...current,salt:pwSalt,password:hashed,recovery:sha(recovery),sessions:[s.stored]}});
    return json(200,{user:{username},csrf:s.stored.csrf,recoveryCode:recovery},{'Set-Cookie':cookie(username,s.token)})
   }
   const attempted=await passwordHash(password,u&&!u.deleted?u.salt:'fizy-invalid-salt');
   if(!u||u.deleted||!same(attempted,u.password))fail(401,'Неверный логин или пароль.');
   const s=makeSession();await cas(users,key,current=>{if(!current||current.deleted||current.id!==u.id||current.password!==u.password)fail(401,'Пароль изменён. Войди снова.');return{...current,sessions:[...current.sessions.filter(x=>x.expires>Date.now()).slice(-9),s.stored]}});
   return json(200,{user:{username},csrf:s.stored.csrf},{'Set-Cookie':cookie(username,s.token)})
  }
  const raw=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-fizy='))?.slice(12);
  const match=raw?.match(/^([a-z0-9_]{3,32})\.([a-f0-9]{64})$/);if(!match)fail(401,'Войди в аккаунт.');
  const [,username,token]=match,key=sha(username),row=await read(users,key),u=row?.data,s=active(u,token);if(!s)fail(401,'Войди в аккаунт.');
  if(changing&&req.headers.get('x-csrf-token')!==s.csrf)fail(403,'Обнови страницу и повтори.');
  const authorize=current=>{if(!current||current.id!==u.id||!active(current,token))fail(401,'Сессия истекла. Войди снова.');return current};
  if(path==='/api/me'&&req.method==='GET')return json(200,{user:{username},csrf:s.csrf});
  if(path==='/api/journal'&&req.method==='GET')return json(200,{journal:u.journal,revision:u.revision});
  if(path==='/api/journal'&&req.method==='PUT'){
   const b=await parse(req);if(!Number.isInteger(b.revision)||!validJournal(b.journal))fail(400,'Неподдерживаемый формат журнала.');
   await cas(users,key,current=>{authorize(current);if(current.revision!==b.revision)fail(409,'Журнал изменён в другом окне. Обнови журнал и повтори.');return{...current,journal:b.journal,revision:current.revision+1}});
   return json(200,{revision:b.revision+1})
  }
  if(path==='/api/logout'&&req.method==='POST'){
   await cas(users,key,current=>({...authorize(current),sessions:current.sessions.filter(x=>x.hash!==sha(token))}));
   return json(200,{ok:true},{'Set-Cookie':cookie('','',0)})
  }
  if(path==='/api/account'&&req.method==='DELETE'){
   await limit(rates,'delete:'+key,5);const b=await parse(req);if(typeof b.password!=='string'||b.password.length>128||!same(await passwordHash(b.password,u.salt),u.password))fail(401,'Неверный пароль.');
   await cas(users,key,current=>{authorize(current);if(current.password!==u.password)fail(401,'Пароль изменился.');return{deleted:true}});
   return json(200,{ok:true},{'Set-Cookie':cookie('','',0)})
  }
  const extra=await community({path,method:req.method,username,parse,req,json});
  if(extra)return extra;
  fail(404,'Действие не найдено.');
 }catch(e){if(!e.status)console.error('FIZY API error:',e.message);return json(e.status||500,{error:e.status?e.message:'Ошибка хранилища. Изменения не подтверждены. Повтори позже.'})}
}}
