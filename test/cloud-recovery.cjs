// Tests the exact portable helpers used by the real controller/camera tasks.
const fs=require('fs'),path=require('path'),cp=require('child_process');const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/test-output/cloud-recovery');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'main.cpp'),`#include "CloudSyncRecovery.h"
#include "camera_event_record.hpp"
#include <cassert>
#include <cstring>
int main(){using namespace HatchSync;Recovery retry;
assert(retry.complete(false,0,false,0,0,0)==Action::Retry);assert(retry.delay()==2000);assert(retry.waiting(1999));assert(!retry.waiting(2000));
assert(retry.complete(true,200,false,0,999,2000)==Action::Retry);assert(retry.delay()==4999); // lost/malformed ACK retains event
assert(retry.complete(true,429,false,3600000,0,3000)==Action::Retry);assert(retry.delay()==3600000);assert(retry.waiting(3602999));assert(!retry.waiting(3603000));
retry.reset();assert(retry.complete(true,503,false,86400000,0,0)==Action::Retry);assert(retry.waiting(86399999));assert(!retry.waiting(86400000));
for(int i=0;i<20;i++){retry.complete(false,0,false,0,999,0);assert(retry.delay()<=64999);}
retry.reset();retry.complete(false,0,false,0,0,0xfffffff0U);assert(retry.waiting(0x10));assert(!retry.waiting(0x800));
assert(retry.complete(true,401,false,0,0,0)==Action::Pause);assert(retry.complete(true,403,false,0,0,0)==Action::Pause);
assert(retry.complete(true,400,false,0,0,0)==Action::Discard);assert(retry.complete(true,413,false,0,0,0)==Action::Discard);assert(retry.complete(true,200,true,0,0,0)==Action::Acknowledge);
using namespace HatchCameraCloud;Event event;event.camera=1;event.capturedAt=1794096000;strcpy(event.id,"00000000-0000-4000-8000-000000000001");uint8_t bytes[RecordBytes];assert(encode(event,bytes));Event restored;assert(decode(bytes,sizeof(bytes),restored));assert(strcmp(event.id,restored.id)==0&&event.capturedAt==restored.capturedAt);
for(size_t n=0;n<RecordBytes;n++)assert(!decode(bytes,n,restored));for(size_t at=0;at<RecordBytes;at++){uint8_t damaged[RecordBytes];memcpy(damaged,bytes,RecordBytes);damaged[at]^=1;assert(!decode(damaged,RecordBytes,restored));}
event.camera=0;assert(!encode(event,bytes));event.camera=2;assert(encode(event,bytes));assert(decode(bytes,sizeof(bytes),restored)&&restored.camera==2);event.camera=1;event.capturedAt=0;assert(!encode(event,bytes));event.capturedAt=1794096000;event.id[14]='3';assert(!encode(event,bytes));
}`);
const zig=process.env.HATCHAI_ZIG||path.join(root,'test/notification-pairing/.tools/ziglang/zig.exe'),exe=path.join(out,'checks.exe');cp.execFileSync(zig,['c++','-std=c++14','-O1','-Iinclude','-Iesp32-devcam/camera/main',path.join(out,'main.cpp'),'-o',exe],{cwd:root,stdio:'pipe',env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(out,'cache')}});cp.execFileSync(exe,[],{stdio:'inherit'});console.log('PASS: real telemetry recovery policy and camera persistent record helpers; lost ACK, long Retry-After, rollover, auth, truncation and every-byte corruption.');
