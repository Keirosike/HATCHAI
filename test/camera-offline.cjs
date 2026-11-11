// Portable production episode/queue/preprocessing checks. No hardware, DNS or cloud.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/test-output/camera-offline');fs.mkdirSync(out,{recursive:true});
const source=path.join(out,'main.cpp'),exe=path.join(out,'checks.exe');
fs.writeFileSync(source,`#include "CameraEventProtocol.h"
#include "MobileNetInput.h"
#include "CameraEventClock.h"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
using namespace HatchCameraEvent;
Event event(unsigned sequence,unsigned camera=0){Event e{};snprintf(e.id,sizeof(e.id),"00000000-0000-4000-8000-%012u",sequence);e.camera=camera;e.incarnation=7;e.sequence=sequence;e.confidence=750;return e;}
int main(){
 uint32_t age=99;const uint64_t wrapped=(1ULL<<32)+10000;
 assert(HatchCameraClock::utcAt(1800000000,wrapped,wrapped+2000,wrapped+3000)==1800000002);
 assert(HatchCameraClock::utcAt(1800000000,0,wrapped,wrapped)==0);
 assert(HatchCameraClock::utcAt(1800000000,10000,9000,11000)==1799999999);
 assert(HatchCameraClock::age(7,7,10000,9000,age)&&age==1000);
 assert(!HatchCameraClock::age(7,8,10000,9000,age));
 assert(!HatchCameraClock::age(7,7,wrapped,9000,age));
 assert(!HatchCameraClock::age(7,7,8000,9000,age));

 assert(placement("d885accba598")==0&&placement("d885acca0c00")==1&&placement("unknown")==-1);
 Episode episode;assert(!episode.sample(true,true));assert(!episode.sample(true,true));assert(episode.sample(true,true));
 for(unsigned i=0;i<1000;i++)assert(!episode.sample(true,true));
 Episode restarted;restarted.latched=episode.latched;for(unsigned i=0;i<10;i++)assert(!restarted.sample(true,true));
 for(unsigned i=0;i<4;i++)restarted.sample(true,false);assert(restarted.latched);restarted.sample(false,false);assert(restarted.latched);
 for(unsigned i=0;i<5;i++)restarted.sample(true,false);assert(!restarted.latched);assert(!restarted.sample(true,true));assert(!restarted.sample(true,true));assert(restarted.sample(true,true));
 State state{};state.seal();assert(state.valid());
 for(unsigned i=1;i<=Capacity;i++)assert(add(state,event(i))==Admission::Added);
 const State full=state;assert(add(state,event(Capacity+1))==Admission::Full);assert(!memcmp(&state,&full,sizeof(state)));
 assert(add(state,event(1))==Admission::Duplicate);assert(add(state,event(1,1))==Admission::Invalid);
 assert(finish(state,event(1).id,true));assert(add(state,event(Capacity+1))==Admission::Added);
 assert(add(state,event(1))==Admission::Duplicate);assert(state.count==Capacity);
 assert(finish(state,event(2).id,false));assert(state.events[0].state==2);
 assert(add(state,event(Capacity+2))==Admission::Full);assert(finish(state,event(3).id,true));assert(add(state,event(Capacity+2))==Admission::Added);assert(state.valid());
 auto bad=event(50);bad.confidence=499;assert(add(state,bad)==Admission::Invalid);
 unsigned corruptions=0;for(size_t i=0;i<sizeof(State);i++){State damaged;memcpy(&damaged,&state,sizeof(state));reinterpret_cast<unsigned char*>(&damaged)[i]^=1;assert(!damaged.valid());corruptions++;}
 State before{};before.seal();State durable=before;auto next=before;assert(add(next,event(1))==Admission::Added);
 // A power cut before commit keeps old data; after commit the same ID retries idempotently.
 assert(durable.valid()&&durable.count==0);durable=next;assert(durable.valid()&&durable.count==1);assert(add(durable,event(1))==Admission::Duplicate);
 std::vector<uint8_t> pixels(13*7*3,0);std::vector<int8_t> input(160*160*3);
 assert(HatchMobileNet::prepare(pixels.data(),13,7,input.data(),input.size()));for(auto v:input)assert(v==-128);
 for(auto& v:pixels)v=255;assert(HatchMobileNet::prepare(pixels.data(),13,7,input.data(),input.size()));for(auto v:input)assert(v==127);
 for(auto& v:pixels)v=128;assert(HatchMobileNet::prepare(pixels.data(),13,7,input.data(),input.size()));for(auto v:input)assert(v==0);
 assert(!HatchMobileNet::usable(pixels.data(),13,7));for(size_t i=0;i<pixels.size();i++)pixels[i]=uint8_t(i);assert(HatchMobileNet::usable(pixels.data(),13,7));
 assert(!HatchMobileNet::prepare(pixels.data(),13,7,input.data(),10));
 assert(HatchMobileNet::probability(0)==.5f&&HatchMobileNet::probability(-128)==0);
 printf("PASS: persistent episode/reboot dedup, bounded queue/backpressure, lost ACK, %u corruptions, MAC roles and exact INT8 RGB resize. State bytes=%u.\\n",corruptions,unsigned(sizeof(State)));
}
`);
const zig=process.env.HATCHAI_ZIG||path.join(root,'dist/test-tools/python/ziglang/zig.exe');
cp.execFileSync(zig,['c++','-std=c++14','-O1','-Iinclude',source,'-o',exe],{cwd:root,stdio:'pipe',timeout:600000,env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'dist/test-output/cloud-recovery/cache')}});
cp.execFileSync(exe,[],{stdio:'inherit',timeout:10000});
