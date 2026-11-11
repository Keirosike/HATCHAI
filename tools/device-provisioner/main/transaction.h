#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
namespace DeviceSetup {
enum Code { Ok=0, Unauthorized=1, Identity=2, Existing=3, Pending=4, Conflict=5, Io=6, Readback=7, Invalid=8 };
#pragma pack(push,1)
struct Plan {
 uint8_t version,role,mac[6],key[32];
 char device[65],keyId[65],ssid[33],password[65],controller[80];
};
#pragma pack(pop)
static_assert(sizeof(Plan)==348,"USB plan wire size");
struct Value {uint8_t type=0;size_t size=0;uint8_t bytes[96]={};};
struct Store {
 virtual ~Store()=default;
 virtual bool get(const char*,const char*,Value&)=0;
 virtual bool put(const char*,const char*,uint8_t,const void*,size_t)=0;
};
inline const uint8_t* expectedMac(uint8_t role){
 static const uint8_t macs[3][6]={{0xb0,0x3f,0xd3,0x5b,0x61,0x34},{0xd8,0x85,0xac,0xcb,0xa5,0x98},{0xd8,0x85,0xac,0xca,0x0c,0x00}};
 return role<3?macs[role]:nullptr;
}
inline bool equal(const Value& v,uint8_t type,const void* data,size_t n){return v.type==type&&v.size==n&&!memcmp(v.bytes,data,n);}
inline bool text(const char* p,size_t max){const size_t n=strnlen(p,max);return n>0&&n<max;}
inline bool valid(const Plan& p){
 const char* ids[]={"hatchai-inc01-controller","hatchai-inc01-cam01","hatchai-inc01-cam02"};
 if(p.version!=1||p.role>2||!memchr(p.device,0,sizeof(p.device))||strcmp(p.device,ids[p.role])||!text(p.keyId,sizeof(p.keyId)))return false;
 for(const char* k=p.keyId;*k;++k)if(!((*k>='a'&&*k<='z')||(*k>='A'&&*k<='Z')||(*k>='0'&&*k<='9')||*k=='_'||*k=='-'))return false;
 if(!p.role)return !p.ssid[0]&&!p.password[0]&&!p.controller[0];
 if(!text(p.ssid,sizeof(p.ssid))||!text(p.password,sizeof(p.password))||strlen(p.password)<8||strlen(p.password)>63||!text(p.controller,sizeof(p.controller)))return false;
 // Host independently validates the exact private IPv4 controller URL.
 return !strncmp(p.controller,"http://",7);
}
inline Code install(Store& s,const Plan& p,const uint8_t hash[32],const uint8_t mac[6],uint8_t role,bool authorized,bool resume,bool replace){
 if(!authorized)return Unauthorized;
 if(!valid(p))return Invalid;
 if(p.role!=role||!expectedMac(role)||memcmp(p.mac,mac,6)||memcmp(mac,expectedMac(role),6))return Identity;
 const char* ns=p.role?"hatchai-cloud":"hatchai-sync";
 Value journal;if(!s.get("hatchai-setup","txn",journal))return Io;
 const bool pending=journal.type!=0&&journal.size==33&&journal.bytes[0]==1;
 const bool same=journal.type==3&&journal.size==33&&!memcmp(journal.bytes+1,hash,32);
 if(journal.type && (journal.type!=3||journal.size!=33||journal.bytes[0]>1))return Conflict;
 if(pending&&(!resume||!same))return Pending;
 Value current;if(!s.get(ns,"key",current))return Io;
 if(current.type&&!pending&&!replace&&!same)return Existing;
 if(resume&&!same)return Conflict;
 if(same&&!pending){
  // Lost response reconciliation is read-only and checks every value below.
  if(!resume)return Existing;
 }
 struct Field{const char* ns;const char* key;uint8_t type;const void* value;size_t n;};
 const Field fields[]={{ns,"device",2,p.device,strlen(p.device)+1},{ns,"key-id",2,p.keyId,strlen(p.keyId)+1},
  {ns,"key",3,p.key,32},{"hatchai-wifi","ssid",2,p.ssid,strlen(p.ssid)+1},
  {"hatchai-wifi","password",2,p.password,strlen(p.password)+1},{"hatchai-wifi","controller-url",2,p.controller,strlen(p.controller)+1}};
 const size_t count=p.role?6:3;uint8_t enabled=1;
 if(same&&!pending&&resume){
  for(size_t i=0;i<count;++i){Value v;if(!s.get(fields[i].ns,fields[i].key,v)||!equal(v,fields[i].type,fields[i].value,fields[i].n))return Readback;}
  Value v;return s.get(ns,"enabled",v)&&equal(v,1,&enabled,1)?Ok:Readback;
 }
 // Any existing managed field (including Wi-Fi) requires replacement approval,
 // except an exact, explicitly resumed pending transaction.
 if(!pending&&!replace){
  const char* keys[]={"enabled","device","key-id","key"};
  for(auto key:keys){Value v;if(!s.get(ns,key,v))return Io;if(v.type)return Existing;}
  if(p.role)for(size_t i=3;i<count;++i){Value v;if(!s.get(fields[i].ns,fields[i].key,v))return Io;if(v.type)return Existing;}
 }
 uint8_t record[33];record[0]=1;memcpy(record+1,hash,32);
 auto write=[&](const char* n,const char* k,uint8_t t,const void* b,size_t z){Value v;return s.put(n,k,t,b,z)&&s.get(n,k,v)&&equal(v,t,b,z);};
 if(!write("hatchai-setup","txn",3,record,33))return Io;
 enabled=0;if(!write(ns,"enabled",1,&enabled,1))return Io;
 for(size_t i=0;i<count;++i)if(!write(fields[i].ns,fields[i].key,fields[i].type,fields[i].value,fields[i].n))return Io;
 enabled=1;if(!write(ns,"enabled",1,&enabled,1))return Readback;
 record[0]=0;if(!write("hatchai-setup","txn",3,record,33))return Io;
 return Ok;
}
}
