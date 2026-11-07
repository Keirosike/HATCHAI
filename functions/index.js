'use strict';
const {onRequest}=require('firebase-functions/v2/https');
const {defineSecret,defineString}=require('firebase-functions/params');
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {getMessaging}=require('firebase-admin/messaging');
const {createHash,timingSafeEqual}=require('node:crypto');
initializeApp();
const cameraSecret=defineSecret('CAMERA_SECRET');
const ownerUid=defineString('HATCHAI_OWNER_UID');
const region='asia-southeast1';
const db=getFirestore();
const hash=value=>createHash('sha256').update(value).digest('hex');
function post(req,res){
  if(req.method!=='POST'){res.status(405).json({message:'POST required'});return false;}
  if(!req.is('application/json') || !req.body || Buffer.byteLength(JSON.stringify(req.body))>4096){res.status(400).json({message:'Invalid JSON body'});return false;}
  return true;
}
exports.registerPush=onRequest({region},async(req,res)=>{
  if(!post(req,res))return;
  try{
    const bearer=req.get('Authorization')||'';
    if(!bearer.startsWith('Bearer '))return res.status(401).json({message:'Sign in required'});
    const user=await getAuth().verifyIdToken(bearer.slice(7));
    if(user.uid!==ownerUid.value())return res.status(403).json({message:'This account is not the configured HatchAI owner'});
    const {token,remove}=req.body;
    if(typeof token!=='string'||token.length<20||token.length>2048)return res.status(400).json({message:'Invalid push token'});
    const ref=db.collection('pushTokens').doc(hash(token));
    if(remove===true)await ref.delete();
    else {
      const existing=await ref.get();
      const count=await db.collection('pushTokens').count().get();
      if(!existing.exists&&count.data().count>=20)return res.status(409).json({message:'Device limit reached; remove an old subscription'});
      await ref.set({token,uid:user.uid,updated:FieldValue.serverTimestamp()});
    }
    res.json({ok:true});
  }catch(error){console.error('Push registration failed',error.code);res.status(401).json({message:'Registration failed; sign in again'});}
});
exports.chickDetected=onRequest({region,secrets:[cameraSecret]},async(req,res)=>{
  if(!post(req,res))return;
  const supplied=req.get('X-Camera-Key')||'';
  const expected=cameraSecret.value();
  if(expected.length<32||!timingSafeEqual(Buffer.from(hash(supplied)),Buffer.from(hash(expected))))return res.status(403).json({message:'Camera key rejected'});
  const {eventId}=req.body;
  if(typeof eventId!=='string'||!/^[a-f0-9]{8}-\d{1,10}$/.test(eventId))return res.status(400).json({message:'Invalid event ID'});
  const state=db.doc('cameraState/main');
  try{
    const accepted=await db.runTransaction(async tx=>{
      const snapshot=await tx.get(state), previous=snapshot.data()||{}, now=Date.now();
      if(previous.eventId===eventId||now-(previous.sentAt||0)<60000)return false;
      tx.set(state,{eventId,sentAt:now});return true;
    });
    if(!accepted)return res.json({ok:true,duplicate:true});
    const snapshot=await db.collection('pushTokens').where('uid','==',ownerUid.value()).limit(20).get();
    if(snapshot.empty)return res.json({ok:true,subscribers:0});
    const result=await getMessaging().sendEachForMulticast({
      tokens:snapshot.docs.map(doc=>doc.data().token),
      notification:{title:'HatchAI: chick detected',body:'The incubator camera detected a chick. Check the camera and incubator.'},
      data:{eventId},
      webpush:{headers:{TTL:'300'},notification:{tag:'hatchai-chick'},fcmOptions:{link:'https://hatchai-8d34c.web.app/'}}
    });
    await Promise.all(result.responses.map((response,i)=>{
      const code=response.error?.code;
      return ['messaging/registration-token-not-registered','messaging/invalid-registration-token'].includes(code)?snapshot.docs[i].ref.delete():Promise.resolve();
    }));
    // Do not redeliver successful tokens on a partial failure.
    if(result.failureCount)console.warn('Push failures',result.failureCount);
    res.json({ok:true,delivered:result.successCount,failed:result.failureCount});
  }catch(error){
    console.error('Chick push failed',error.code);
    // Release this reservation only if it still belongs to this event, allowing bounded device retries.
    await db.runTransaction(async tx=>{const doc=await tx.get(state);if(doc.data()?.eventId===eventId)tx.delete(state);}).catch(()=>{});
    res.status(503).json({message:'Push temporarily unavailable'});
  }
});
