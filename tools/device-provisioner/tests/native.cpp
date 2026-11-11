#include "transaction.h"
#include "raw_page.h"
#include <map>
#include <string>
#include <cassert>
#include <cstdio>
using namespace DeviceSetup;
struct Mock:Store {
 std::map<std::string,Value> values;int fail=-1,calls=0,writes=0;bool corrupt=false;
 bool get(const char* ns,const char* key,Value& v)override{v=values[std::string(ns)+"/"+key];if(corrupt&&v.type&&std::string(key)=="device")v.bytes[0]^=1;return true;}
 bool put(const char* ns,const char* key,uint8_t type,const void* p,size_t n)override{if(calls++==fail)return false;++writes;Value v;v.type=type;v.size=n;memcpy(v.bytes,p,n);values[std::string(ns)+"/"+key]=v;return true;}
};
Plan fixture(uint8_t role=0){Plan p{};p.version=1;p.role=role;memcpy(p.mac,expectedMac(role),6);memset(p.key,42,32);strcpy(p.keyId,"test-v1");strcpy(p.device,role==0?"hatchai-inc01-controller":role==1?"hatchai-inc01-cam01":"hatchai-inc01-cam02");if(role){strcpy(p.ssid,"router");strcpy(p.password,"synthetic-password");strcpy(p.controller,"http://192.168.1.2");}return p;}
int main(){unsigned tests=0;uint8_t hash[32]={1};
 for(uint8_t role=0;role<3;++role){auto p=fixture(role);Mock s;
  assert(install(s,p,hash,p.mac,role,false,false,false)==Unauthorized&&s.writes==0);++tests;
  assert(install(s,p,hash,p.mac,(role+1)%3,true,false,false)==Identity&&s.writes==0);++tests;
  uint8_t wrong[6]={2};assert(install(s,p,hash,wrong,role,true,false,false)==Identity&&s.writes==0);++tests;
  assert(install(s,p,hash,p.mac,role,true,false,false)==Ok);++tests;
  const int count=s.writes;assert(install(s,p,hash,p.mac,role,true,true,false)==Ok&&s.writes==count);++tests;
  assert(install(s,p,hash,p.mac,role,true,false,false)==Existing&&s.writes==count);++tests;
  uint8_t other[32]={2};assert(install(s,p,other,p.mac,role,true,false,false)==Existing);++tests;
  assert(install(s,p,other,p.mac,role,true,false,true)==Ok);++tests;
 }
 for(int cut=0;cut<11;++cut){Plan p=fixture(1);Mock s;s.values["unrelated/secret"].type=3;s.values["unrelated/secret"].size=1;s.values["unrelated/secret"].bytes[0]=99;s.fail=cut;
  const auto result=install(s,p,hash,p.mac,1,true,false,false);
  assert(s.values["unrelated/secret"].bytes[0]==99);++tests;
  s.fail=-1;
  if(result!=Ok){Value j;s.get("hatchai-setup","txn",j);if(j.type){
   uint8_t other[32]={2};const int writes=s.writes;assert(install(s,p,other,p.mac,1,true,true,false)==Pending&&s.writes==writes);++tests;
   assert(install(s,p,hash,p.mac,1,true,true,false)==Ok);++tests;
  }else assert(install(s,p,hash,p.mac,1,true,false,false)==Ok);}
 }
 Mock bad;bad.corrupt=true;auto p=fixture();assert(install(bad,p,hash,p.mac,0,true,false,false)!=Ok);assert(bad.values["hatchai-sync/enabled"].bytes[0]==0);++tests;
 Mock pre;uint8_t old=1;pre.put("hatchai-wifi","ssid",1,&old,1);const int count=pre.writes;p=fixture(1);assert(install(pre,p,hash,p.mac,1,true,false,false)==Existing&&pre.writes==count);++tests;
 p=fixture();p.keyId[0]='!';Mock invalid;assert(install(invalid,p,hash,p.mac,0,true,false,false)==Invalid&&invalid.writes==0);++tests;
 for(uint8_t role=1;role<3;++role){Mock swapped;auto p=fixture(role);memcpy(p.mac,expectedMac(3-role),6);
 assert(install(swapped,p,hash,p.mac,role,true,false,false)==Identity&&swapped.writes==0);++tests;}
 uint8_t page[4096];memset(page,255,sizeof(page));assert(validPage(page));++tests;
 page[100]=0;assert(!validPage(page));++tests;
 memset(page,255,sizeof(page));page[0]=0xfe;page[8]=0xfe;uint32_t sum=rawCrc(page+4,24);memcpy(page+28,&sum,4);assert(validPage(page));++tests;
 page[32]=0xfd;assert(!validPage(page));++tests; // interrupted entry state
 page[32]=0xff;page[4]^=1;assert(!validPage(page));++tests;
 assert(!allowedWrite(false,0x9000,0x5000,0x9000,32));++tests;
 assert(!allowedWrite(true,0x9000,0x5000,0x8000,32));++tests;
 assert(!allowedWrite(true,0x9000,0x5000,0xdff0,32));++tests;
 assert(allowedWrite(true,0x9000,0x5000,0x9000,32));++tests;
 printf("PASS: %u transaction assertions; synthetic data only\n",tests);
}
