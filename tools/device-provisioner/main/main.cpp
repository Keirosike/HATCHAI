// Independent RAM-only device setup agent. No retired provisioner dependency.
#include "transaction.h"
#include "raw_page.h"
#include "sdkconfig.h"
#include "esp_flash.h"
#include "esp_flash_internal.h"
#include "spi_flash_chip_driver.h"
#include "esp_rom_spiflash.h"
#include "bootloader_flash_config.h"
#include "esp_flash_encrypt.h"
#include "esp_secure_boot.h"
#include "esp_partition.h"
#include "esp_mac.h"
#include "esp_chip_info.h"
#include "esp_rom_uart.h"
#include "esp_rom_md5.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "bootloader_random.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/ecdh.h"
#include "mbedtls/hkdf.h"
#include "mbedtls/gcm.h"
#include "mbedtls/sha256.h"
#include "mbedtls/base64.h"
#include <vector>
#include <array>
#include <algorithm>
#include <string>
#include <cstdio>
#if !CONFIG_APP_BUILD_TYPE_RAM || CONFIG_APP_BUILD_USE_FLASH_SECTIONS
#error RAM-only build required
#endif
using namespace DeviceSetup;
static bool gate=false,denied=false;
static esp_partition_t partition;
extern "C" const spi_flash_chip_t esp_flash_chip_generic;
extern "C" esp_err_t __real_esp_flash_init_main(esp_flash_t*);
static esp_err_t noModeWrite(esp_flash_t*){return ESP_OK;}
extern "C" esp_err_t __wrap_esp_flash_init_main(esp_flash_t* chip){static spi_flash_chip_t driver=esp_flash_chip_generic;driver.set_io_mode=noModeWrite;chip->chip_drv=&driver;chip->read_mode=SPI_FLASH_SLOWRD;return __real_esp_flash_init_main(chip);}
extern "C" esp_err_t __real_esp_flash_write(esp_flash_t*,const void*,uint32_t,uint32_t);
extern "C" esp_err_t __wrap_esp_flash_write(esp_flash_t* chip,const void* data,uint32_t at,uint32_t n){if(chip!=esp_flash_default_chip||!allowedWrite(gate,partition.address,partition.size,at,n)){denied=true;return ESP_ERR_NOT_ALLOWED;}return __real_esp_flash_write(chip,data,at,n);}
// No physical sector/chip erase is allowed, even after authorization. Full NVS
// fails closed instead of garbage collection or destructive recovery.
extern "C" esp_err_t __wrap_esp_flash_erase_region(esp_flash_t*,uint32_t,uint32_t){denied=true;return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_flash_erase_chip(esp_flash_t*){denied=true;return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_flash_write_encrypted(esp_flash_t*,uint32_t,const void*,uint32_t){denied=true;return ESP_ERR_NOT_ALLOWED;}
namespace {
void wipe(void* p,size_t n){volatile uint8_t* b=(volatile uint8_t*)p;while(n--)*b++=0;}
void emit(const std::string& s){for(char c:s)esp_rom_output_tx_one_char(c);esp_rom_output_tx_one_char('\n');}
[[noreturn]] void stop(unsigned code){gate=false;char s[32];snprintf(s,sizeof(s),"HDS1 STOP %u",code);emit(s);for(;;)vTaskDelay(pdMS_TO_TICKS(1000));}
uint32_t u32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
bool erased(const uint8_t* p,size_t n){while(n--)if(*p++!=255)return false;return true;}
std::string b64(const uint8_t* p,size_t n){char out[1400];size_t used=0;if(mbedtls_base64_encode((uint8_t*)out,sizeof(out),&used,p,n))stop(10);return std::string(out,used);}
bool decode(const char* p,uint8_t* out,size_t cap,size_t& n){return !mbedtls_base64_decode(out,cap,&n,(const uint8_t*)p,strlen(p));}
int randomBytes(void*,unsigned char* out,size_t n){esp_fill_random(out,n);return 0;}
bool rawNvs(bool reserve=true){uint8_t page[4096];unsigned empty=0;for(uint32_t at=partition.address;at<partition.address+partition.size;at+=4096){if(esp_flash_read(nullptr,page,at,sizeof(page))||!validPage(page))return false;if(rawErased(page,sizeof(page)))++empty;}return !reserve||empty>=2;}
bool layout(uint32_t size){uint8_t table[0xc00];if(esp_flash_read(nullptr,table,0x8000,sizeof(table)))return false;bool found=false,md5=false;uint32_t end=0x9000;
 for(unsigned at=0;at<sizeof(table);at+=32){uint8_t* p=table+at;if(p[0]==0xeb&&p[1]==0xeb){md5_context_t c;uint8_t h[16];esp_rom_md5_init(&c);esp_rom_md5_update(&c,table,at);esp_rom_md5_final(h,&c);md5=!memcmp(h,p+16,16)&&erased(p+2,14)&&erased(p+32,sizeof(table)-at-32);break;}
 if(p[0]!=0xaa||p[1]!=0x50||!memchr(p+12,0,16)||u32(p+28)){return false;}uint32_t a=u32(p+4),n=u32(p+8);if(!n||a<end||a>size||n>size-a)return false;end=a+n;
 if(!strcmp((char*)p+12,"nvs")){if(found||p[2]!=1||p[3]!=2||a!=0x9000||n!=(HATCH_ROLE?0x6000u:0x5000u))return false;partition={};partition.flash_chip=esp_flash_default_chip;partition.type=ESP_PARTITION_TYPE_DATA;partition.subtype=ESP_PARTITION_SUBTYPE_DATA_NVS;partition.address=a;partition.size=n;partition.erase_size=4096;memcpy(partition.label,"nvs",4);partition.readonly=true;found=true;}}
 return found&&md5;}
struct Adapter:Store {
 bool get(const char* ns,const char* key,Value& v)override{v=Value();nvs_handle_t h;auto e=nvs_open_from_partition("nvs",ns,NVS_READONLY,&h);if(e==ESP_ERR_NVS_NOT_FOUND)return true;if(e)return false;nvs_type_t t;e=nvs_find_key(h,key,&t);if(e==ESP_ERR_NVS_NOT_FOUND){nvs_close(h);return true;}if(e){nvs_close(h);return false;}size_t n=sizeof(v.bytes);
 if(t==NVS_TYPE_U8){v.type=1;n=1;e=nvs_get_u8(h,key,v.bytes);}else if(t==NVS_TYPE_STR){v.type=2;e=nvs_get_str(h,key,(char*)v.bytes,&n);}else if(t==NVS_TYPE_BLOB){v.type=3;e=nvs_get_blob(h,key,v.bytes,&n);}else e=ESP_FAIL;v.size=n;nvs_close(h);return !e;}
 bool put(const char* ns,const char* key,uint8_t type,const void* bytes,size_t n)override{
  const bool cloud=!strcmp(ns,HATCH_ROLE?"hatchai-cloud":"hatchai-sync")&&(!strcmp(key,"device")||!strcmp(key,"key-id")||!strcmp(key,"key")||!strcmp(key,"enabled"));
  const bool wifi=HATCH_ROLE&&!strcmp(ns,"hatchai-wifi")&&(!strcmp(key,"ssid")||!strcmp(key,"password")||!strcmp(key,"controller-url"));
  if(!gate||(!cloud&&!wifi&&(strcmp(ns,"hatchai-setup")||strcmp(key,"txn"))))return false;
  nvs_handle_t h;if(nvs_open_from_partition("nvs",ns,NVS_READWRITE,&h))return false;esp_err_t e=ESP_FAIL;
  if(type==1&&n==1)e=nvs_set_u8(h,key,*(uint8_t*)bytes);else if(type==2&&n<=96&&((char*)bytes)[n-1]==0)e=nvs_set_str(h,key,(const char*)bytes);else if(type==3&&n<=96)e=nvs_set_blob(h,key,bytes,n);
  if(!e){e=nvs_commit(h);}nvs_close(h);return !e;
 }
};
bool managed(const char* ns,const char* key){return (!strcmp(ns,HATCH_ROLE?"hatchai-cloud":"hatchai-sync")&&(!strcmp(key,"enabled")||!strcmp(key,"device")||!strcmp(key,"key-id")||!strcmp(key,"key")))||(HATCH_ROLE&&!strcmp(ns,"hatchai-wifi")&&(!strcmp(key,"ssid")||!strcmp(key,"password")||!strcmp(key,"controller-url")))||(!strcmp(ns,"hatchai-setup")&&!strcmp(key,"txn"));}
bool digestUnrelated(uint8_t out[32]){struct Entry{std::string name;std::array<uint8_t,32> hash;};std::vector<Entry> entries;if(heap_caps_get_free_size(MALLOC_CAP_8BIT)<98304||heap_caps_get_largest_free_block(MALLOC_CAP_8BIT)<49152)return false;entries.reserve(192);nvs_iterator_t it=nullptr;auto e=nvs_entry_find("nvs",nullptr,NVS_TYPE_ANY,&it);
 while(e==ESP_OK){nvs_entry_info_t info;if(nvs_entry_info(it,&info)){nvs_release_iterator(it);return false;}if(!managed(info.namespace_name,info.key)){if(entries.size()>=192){nvs_release_iterator(it);return false;}nvs_handle_t h;if(nvs_open_from_partition("nvs",info.namespace_name,NVS_READONLY,&h)){nvs_release_iterator(it);return false;}std::vector<uint8_t> value;size_t n=0;esp_err_t rc=ESP_FAIL;
#define NUMBER(T,N,F) case NVS_TYPE_##N:{T x;rc=nvs_get_##F(h,info.key,&x);value.resize(sizeof(x));memcpy(value.data(),&x,sizeof(x));break;}
 switch(info.type){NUMBER(uint8_t,U8,u8) NUMBER(int8_t,I8,i8) NUMBER(uint16_t,U16,u16) NUMBER(int16_t,I16,i16) NUMBER(uint32_t,U32,u32) NUMBER(int32_t,I32,i32) NUMBER(uint64_t,U64,u64) NUMBER(int64_t,I64,i64)
 case NVS_TYPE_STR:rc=nvs_get_str(h,info.key,nullptr,&n);if(!rc&&n<=partition.size){value.resize(n);rc=nvs_get_str(h,info.key,(char*)value.data(),&n);}else rc=ESP_FAIL;break;
 case NVS_TYPE_BLOB:rc=nvs_get_blob(h,info.key,nullptr,&n);if(!rc&&n<=partition.size){value.resize(n);rc=nvs_get_blob(h,info.key,value.data(),&n);}else rc=ESP_FAIL;break;default:break;}
#undef NUMBER
 nvs_close(h);if(rc){nvs_release_iterator(it);return false;}Entry item;item.name=info.namespace_name;item.name.push_back(0);item.name+=info.key;item.name.push_back(0);item.name.push_back(char(info.type));mbedtls_sha256(value.data(),value.size(),item.hash.data(),0);wipe(value.data(),value.size());entries.push_back(item);}e=nvs_entry_next(&it);}nvs_release_iterator(it);if(e!=ESP_ERR_NVS_NOT_FOUND)return false;
 std::sort(entries.begin(),entries.end(),[](const Entry&a,const Entry&b){return a.name<b.name;});mbedtls_sha256_context c;mbedtls_sha256_init(&c);mbedtls_sha256_starts(&c,0);for(auto& x:entries){uint32_t n=x.name.size();mbedtls_sha256_update(&c,(uint8_t*)&n,4);mbedtls_sha256_update(&c,(uint8_t*)x.name.data(),n);mbedtls_sha256_update(&c,x.hash.data(),32);}mbedtls_sha256_finish(&c,out);mbedtls_sha256_free(&c);return true;}
}
extern "C" void app_main(){
 esp_chip_info_t info;esp_chip_info(&info);if((HATCH_ROLE==0&&info.model!=CHIP_ESP32)||(HATCH_ROLE!=0&&info.model!=CHIP_ESP32S3)||esp_secure_boot_enabled()||esp_flash_encryption_enabled())stop(11);
 uint8_t mac[6];if(esp_read_mac(mac,ESP_MAC_WIFI_STA)||memcmp(mac,expectedMac(HATCH_ROLE),6))stop(16);
 uint32_t physical=0,usable=0;if((!esp_flash_default_chip&&esp_flash_init_default_chip())||esp_flash_get_physical_size(nullptr,&physical)||physical!=(HATCH_ROLE?0x1000000u:0x400000u))stop(12);
 bootloader_flash_update_size(physical);esp_flash_default_chip->size=physical;if(esp_flash_get_size(nullptr,&usable)||usable!=physical||g_rom_flashchip.chip_size!=physical||!layout(physical)||!rawNvs())stop(13);
 // SDK recovery writes are denied during both initializations. No erase fallback.
 if(nvs_flash_init_partition_ptr(&partition)||denied)stop(14);
 uint8_t before[32];if(!digestUnrelated(before))stop(15);
 uint8_t challenge[32],publicBytes[65];
 bootloader_random_enable();esp_fill_random(challenge,32);
 mbedtls_ecp_group group;mbedtls_ecp_group_init(&group);mbedtls_mpi secret;mbedtls_mpi_init(&secret);mbedtls_ecp_point pub;mbedtls_ecp_point_init(&pub);size_t n;
 if(mbedtls_ecp_group_load(&group,MBEDTLS_ECP_DP_SECP256R1)||mbedtls_ecp_gen_keypair(&group,&secret,&pub,randomBytes,nullptr)||mbedtls_ecp_point_write_binary(&group,&pub,MBEDTLS_ECP_PF_UNCOMPRESSED,&n,publicBytes,65))stop(17);
 char header[140];snprintf(header,sizeof(header),"HDS1 %u %02x%02x%02x%02x%02x%02x %lu %lu %lu ",HATCH_ROLE,mac[0],mac[1],mac[2],mac[3],mac[4],mac[5],(unsigned long)physical,(unsigned long)usable,(unsigned long)g_rom_flashchip.chip_size);
 emit(std::string(header)+b64(challenge,32)+" "+b64(publicBytes,65));
 char input[1400]={};size_t at=0;const int64_t deadline=esp_timer_get_time()+180000000;
 while(esp_timer_get_time()<deadline&&at<sizeof(input)-1){uint8_t c;if(!esp_rom_output_rx_one_char(&c)){if(c=='\n')break;if(c!='\r')input[at++]=char(c);}else vTaskDelay(1);}
 if(!at||at>=sizeof(input)-1||esp_timer_get_time()>=deadline)stop(18);
 char* save=nullptr;char* label=strtok_r(input," ",&save);char* peerText=strtok_r(nullptr," ",&save);char* cipherText=strtok_r(nullptr," ",&save);if(!label||strcmp(label,"HDS1")||!peerText||!cipherText||strtok_r(nullptr," ",&save))stop(19);
 uint8_t peer[65],cipher[600],plain[600],sharedBytes[32],session[32];size_t peerN,cipherN;
 if(!decode(peerText,peer,65,peerN)||peerN!=65||!decode(cipherText,cipher,sizeof(cipher),cipherN)||cipherN!=sizeof(Plan)+2+16)stop(20);
 mbedtls_ecp_point other;mbedtls_ecp_point_init(&other);mbedtls_mpi shared;mbedtls_mpi_init(&shared);
 if(mbedtls_ecp_point_read_binary(&group,&other,peer,65)||mbedtls_ecp_check_pubkey(&group,&other)||mbedtls_ecdh_compute_shared(&group,&shared,&other,&secret,randomBytes,nullptr)||mbedtls_mpi_write_binary(&shared,sharedBytes,32))stop(21);
 uint8_t context[6+65+65];memcpy(context,mac,6);memcpy(context+6,publicBytes,65);memcpy(context+71,peer,65);
 if(mbedtls_hkdf(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),challenge,32,sharedBytes,32,context,sizeof(context),session,32)){stop(22);}wipe(sharedBytes,32);bootloader_random_disable();
 uint8_t nonce[12]={};memcpy(nonce,"HOST",4);nonce[11]=1;mbedtls_gcm_context gcm;mbedtls_gcm_init(&gcm);
 if(mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,session,256)||mbedtls_gcm_auth_decrypt(&gcm,cipherN-16,nonce,12,challenge,32,cipher+cipherN-16,16,cipher,plain))stop(23);
 Plan plan;memcpy(&plan,plain+2,sizeof(plan));const bool resume=plain[0]&1,replace=plain[0]&2;
 if((plain[0]&~3)||plain[1]!=0xA5||!valid(plan)||plan.role!=HATCH_ROLE||memcmp(plan.mac,mac,6))stop(24);
 if(HATCH_ROLE){unsigned a,b,c,d;char extra;char canonical[80];if(sscanf(plan.controller,"http://%u.%u.%u.%u%c",&a,&b,&c,&d,&extra)!=4||a>255||b>255||c>255||d>255||!(a==10||(a==172&&b>=16&&b<=31)||(a==192&&b==168)))stop(24);snprintf(canonical,sizeof(canonical),"http://%u.%u.%u.%u",a,b,c,d);if(strcmp(canonical,plan.controller))stop(24);}

 uint8_t hash[32];mbedtls_sha256((uint8_t*)&plan,sizeof(plan),hash,0);
 // Reinitialize writable descriptor with the physical write gate still closed.
 if(nvs_flash_deinit_partition("nvs")){stop(25);}partition.readonly=false;
 if(nvs_flash_init_partition_ptr(&partition)||denied)stop(26);
 nvs_stats_t stats{};if(nvs_get_stats("nvs",&stats)||stats.free_entries<126)stop(26);
 uint8_t check[32];if(!digestUnrelated(check)||memcmp(check,before,32))stop(27);
 gate=true;Adapter adapter;Code result=install(adapter,plan,hash,mac,HATCH_ROLE,true,resume,replace);gate=false;
 // Discard SDK caches and verify all values from freshly initialized storage.
 if(!rawNvs(false)||nvs_flash_deinit_partition("nvs")){stop(28);}partition.readonly=true;
 if(nvs_flash_init_partition_ptr(&partition)||denied)stop(29);
 if(result==Ok)result=install(adapter,plan,hash,mac,HATCH_ROLE,true,true,false);
 uint8_t after[32];if(!digestUnrelated(after)||memcmp(before,after,32))stop(30);
 uint8_t reply[65];reply[0]=result;memcpy(reply+1,hash,32);memcpy(reply+33,after,32);
 uint8_t encrypted[81];memcpy(nonce,"DEV!",4);
 if(mbedtls_gcm_crypt_and_tag(&gcm,MBEDTLS_GCM_ENCRYPT,sizeof(reply),nonce,12,challenge,32,reply,encrypted,16,encrypted+65))stop(31);
 emit("HDS1 RESULT "+b64(encrypted,sizeof(encrypted)));wipe(&plan,sizeof(plan));wipe(plain,sizeof(plain));wipe(session,32);mbedtls_gcm_free(&gcm);stop(0);
}
