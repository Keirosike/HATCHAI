#include "idf_store.h"
#include "nvs_flash.h"
#include "mbedtls/sha256.h"
#include "esp_heap_caps.h"
#include <algorithm>
#include <array>
#include <cstring>
#include <string>
namespace HatchUsb {
bool digest(const uint8_t* bytes,size_t length,uint8_t out[32]){return mbedtls_sha256(bytes,length,out,0)==0;}
namespace {
bool allowed(const char* key){return !strcmp(key,"active")||!strcmp(key,"enabled")||!strcmp(key,"generation")||!strcmp(key,"slot0")||!strcmp(key,"slot1")||!strcmp(key,"usb-pending");}
}
bool NvsStore::open(bool writable){if(open_)return true;trace(50);esp_err_t rc=nvs_open_from_partition("nvs","hatchai-pair",writable?NVS_READWRITE:NVS_READONLY,&handle_);trace(51,rc);open_=rc==ESP_OK;return open_;}
bool NvsStore::read(const char* key,Value& v){
  v=Value();if(!open_||!allowed(key))return false;
  nvs_type_t type;esp_err_t err=nvs_find_key(handle_,key,&type);
  if(err==ESP_ERR_NVS_NOT_FOUND)return true;
  if(err!=ESP_OK)return false;
  if(type==NVS_TYPE_U8){uint8_t n;if(nvs_get_u8(handle_,key,&n)!=ESP_OK)return false;v.kind=Kind::U8;v.bytes={n};return true;}
  if(type==NVS_TYPE_U32){uint32_t n;if(nvs_get_u32(handle_,key,&n)!=ESP_OK)return false;v.kind=Kind::U32;v.bytes.resize(4);for(unsigned i=0;i<4;++i)v.bytes[i]=uint8_t(n>>(8*i));return true;}
  if(type==NVS_TYPE_BLOB){size_t n=0;if(nvs_get_blob(handle_,key,nullptr,&n)!=ESP_OK||n>160)return false;v.kind=Kind::Blob;v.bytes.resize(n);return nvs_get_blob(handle_,key,v.bytes.data(),&n)==ESP_OK;}
  v.kind=Kind::Invalid;return true;
}
bool NvsStore::write(const char* key,Kind kind,const uint8_t* p,size_t n){
  if(!open_||!allowed(key))return false;
  esp_err_t e=ESP_FAIL;
  if(kind==Kind::U8&&n==1)e=nvs_set_u8(handle_,key,*p);
  if(kind==Kind::U32&&n==4){uint32_t value=uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);e=nvs_set_u32(handle_,key,value);}
  if(kind==Kind::Blob&&n<=160)e=nvs_set_blob(handle_,key,p,n);
  trace(72,e);if(e!=ESP_OK)return false;trace(73);e=nvs_commit(handle_);trace(74,e);return e==ESP_OK;
}
bool NvsStore::remove(const char* key){return open_&&allowed(key)&&nvs_erase_key(handle_,key)==ESP_OK&&nvs_commit(handle_)==ESP_OK;}
bool NvsStore::reopen(){
  if(open_){nvs_close(handle_);open_=false;}
  // Force re-read from flash; no cached record can satisfy verification.
  trace(75);if(!partition_||nvs_flash_deinit_partition("nvs")!=ESP_OK||nvs_flash_init_partition_ptr(partition_)!=ESP_OK)return false;trace(76);
  return open();
}
DigestResult unrelatedDigest(uint8_t out[32]){
  struct Entry{std::string name;std::array<uint8_t,32> hash;};std::vector<Entry> entries;
  if(heap_caps_get_free_size(MALLOC_CAP_8BIT)<98304||heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)<49152)return DigestResult::HeapUnavailable;
  entries.reserve(640);
  nvs_iterator_t it=nullptr;esp_err_t e=nvs_entry_find("nvs",nullptr,NVS_TYPE_ANY,&it);
  while(e==ESP_OK){
    nvs_entry_info_t info;nvs_entry_info(it,&info);
    if(strcmp(info.namespace_name,"hatchai-pair")||!allowed(info.key)){
      if(entries.size()>=640){nvs_release_iterator(it);return DigestResult::ScanFailed;}
      nvs_handle_t h;if(nvs_open_from_partition("nvs",info.namespace_name,NVS_READONLY,&h)!=ESP_OK){nvs_release_iterator(it);return DigestResult::ScanFailed;}
      std::vector<uint8_t> bytes;size_t length=0;bool ok=true;
      switch(info.type){
#define READ_NUMBER(TYPE,NAME,FUNC) case NVS_TYPE_##NAME:{TYPE v;ok=nvs_get_##FUNC(h,info.key,&v)==ESP_OK;bytes.resize(sizeof(v));memcpy(bytes.data(),&v,sizeof(v));break;}
        READ_NUMBER(uint8_t,U8,u8) READ_NUMBER(int8_t,I8,i8) READ_NUMBER(uint16_t,U16,u16) READ_NUMBER(int16_t,I16,i16)
        READ_NUMBER(uint32_t,U32,u32) READ_NUMBER(int32_t,I32,i32) READ_NUMBER(uint64_t,U64,u64) READ_NUMBER(int64_t,I64,i64)
#undef READ_NUMBER
        case NVS_TYPE_STR:ok=nvs_get_str(h,info.key,nullptr,&length)==ESP_OK&&length<=20480;if(ok){bytes.resize(length);ok=nvs_get_str(h,info.key,reinterpret_cast<char*>(bytes.data()),&length)==ESP_OK;}break;
        case NVS_TYPE_BLOB:ok=nvs_get_blob(h,info.key,nullptr,&length)==ESP_OK&&length<=20480;if(ok){bytes.resize(length);ok=nvs_get_blob(h,info.key,bytes.data(),&length)==ESP_OK;}break;
        default:ok=false;
      }
      nvs_close(h);if(!ok){HatchPairing::erase(bytes.data(),bytes.size());nvs_release_iterator(it);return DigestResult::ScanFailed;}
      Entry entry;entry.name=info.namespace_name;entry.name.push_back('\0');entry.name+=info.key;entry.name.push_back('\0');entry.name.push_back(char(info.type));
      const bool hashed=digest(bytes.data(),bytes.size(),entry.hash.data());HatchPairing::erase(bytes.data(),bytes.size());
      if(!hashed){nvs_release_iterator(it);return DigestResult::ScanFailed;}
      entries.push_back(entry);
    }
    e=nvs_entry_next(&it);
  }
  nvs_release_iterator(it);if(e!=ESP_ERR_NVS_NOT_FOUND)return DigestResult::ScanFailed;
  std::sort(entries.begin(),entries.end(),[](const Entry&a,const Entry&b){return a.name<b.name;});
  mbedtls_sha256_context context;mbedtls_sha256_init(&context);bool ok=mbedtls_sha256_starts(&context,0)==0;
  for(const auto& entry:entries){const uint32_t n=entry.name.size();ok=ok&&mbedtls_sha256_update(&context,reinterpret_cast<const uint8_t*>(&n),sizeof(n))==0&&mbedtls_sha256_update(&context,reinterpret_cast<const uint8_t*>(entry.name.data()),entry.name.size())==0&&mbedtls_sha256_update(&context,entry.hash.data(),32)==0;}
  ok=ok&&mbedtls_sha256_finish(&context,out)==0;mbedtls_sha256_free(&context);return ok?DigestResult::Ok:DigestResult::ScanFailed;
}
}
