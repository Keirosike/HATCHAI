#include "idf_store.h"
#include "write_gate.h"
#include "raw_nvs.h"
#include "spi_flash_chip_driver.h"
#include "sdkconfig.h"
#include "esp_rom_uart.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_flash_internal.h"
#include "esp_flash_partitions.h"
#include "esp_mac.h"
#include "esp_partition.h"
#include "esp_rom_md5.h"
#include "nvs_flash.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "bootloader_random.h"
#include "bootloader_flash_config.h"
#include "esp_rom_spiflash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/base64.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/ecdh.h"
#include "mbedtls/gcm.h"
#include "mbedtls/hkdf.h"
#include "mbedtls/md.h"
#include <array>
#include <cstdio>
#include <cstring>
#include <string>
#if !CONFIG_IDF_TARGET_ESP32 || !CONFIG_APP_BUILD_TYPE_RAM || CONFIG_APP_BUILD_USE_FLASH_SECTIONS
#error This utility must be a classic ESP32 RAM-only image
#endif
using namespace HatchUsb;
using HatchPairing::erase;
static WriteGate writeGate;
extern "C" const spi_flash_chip_t esp_flash_chip_generic;
extern "C" esp_err_t __real_esp_flash_init_main(esp_flash_t*);
static esp_err_t no_mode_write(esp_flash_t*){return ESP_OK;}
extern "C" esp_err_t __wrap_esp_flash_init_main(esp_flash_t* chip){
 static spi_flash_chip_t driver=esp_flash_chip_generic;driver.set_io_mode=no_mode_write;
 chip->chip_drv=&driver;chip->read_mode=SPI_FLASH_SLOWRD;return __real_esp_flash_init_main(chip);
}
extern "C" esp_err_t __real_esp_flash_write(esp_flash_t*,const void*,uint32_t,uint32_t);
extern "C" esp_err_t __real_esp_flash_erase_region(esp_flash_t*,uint32_t,uint32_t);
extern "C" esp_err_t __wrap_esp_flash_write(esp_flash_t* chip,const void* data,uint32_t address,uint32_t size){
 return chip==esp_flash_default_chip&&writeGate.allow(address,size)?__real_esp_flash_write(chip,data,address,size):ESP_ERR_NOT_ALLOWED;
}
extern "C" esp_err_t __wrap_esp_flash_erase_region(esp_flash_t* chip,uint32_t address,uint32_t size){
 return chip==esp_flash_default_chip&&writeGate.allow(address,size)?__real_esp_flash_erase_region(chip,address,size):ESP_ERR_NOT_ALLOWED;
}
extern "C" esp_err_t __wrap_esp_flash_write_encrypted(esp_flash_t*,uint32_t,const void*,uint32_t){writeGate.allow(0,1);return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_flash_erase_chip(esp_flash_t*){writeGate.allow(0,1);return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __real_esp_partition_write(const esp_partition_t*,size_t,const void*,size_t);
extern "C" esp_err_t __real_esp_partition_write_raw(const esp_partition_t*,size_t,const void*,size_t);
extern "C" esp_err_t __real_esp_partition_erase_range(const esp_partition_t*,size_t,size_t);
static bool partitionAllowed(const esp_partition_t* p,size_t offset,size_t size){
 if(!p||p->address!=0x9000||p->size!=0x5000||offset>p->size||size>p->size-offset){writeGate.allow(0,1);return false;}
 return writeGate.allow(p->address+offset,size);
}
extern "C" esp_err_t __wrap_esp_partition_write(const esp_partition_t* p,size_t offset,const void* data,size_t size){return partitionAllowed(p,offset,size)?__real_esp_partition_write(p,offset,data,size):ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_partition_write_raw(const esp_partition_t* p,size_t offset,const void* data,size_t size){return partitionAllowed(p,offset,size)?__real_esp_partition_write_raw(p,offset,data,size):ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_partition_erase_range(const esp_partition_t* p,size_t offset,size_t size){return partitionAllowed(p,offset,size)?__real_esp_partition_erase_range(p,offset,size):ESP_ERR_NOT_ALLOWED;}
namespace {
constexpr char Protocol[]="HATCHAI-NVS-USB-v1";
constexpr char Prefix[]="HATCHAI-USB-1";
constexpr char ProofDomain[]="HATCHAI-NVS-READBACK-v1";
constexpr size_t ResponseBytes=105;
constexpr uint32_t FlashSectorSize=0x1000;
struct Wipe {void* bytes;size_t length;~Wipe(){erase(bytes,length);}};
void stop(){for(;;)vTaskDelay(pdMS_TO_TICKS(1000));}
bool rawSnapshot(uint8_t hash[32]){
 std::vector<uint8_t> bytes(0x5000);
 const bool ok=esp_flash_read(esp_flash_default_chip,bytes.data(),0x9000,bytes.size())==ESP_OK&&
   validateRawNvs(bytes.data(),bytes.size())&&digest(bytes.data(),bytes.size(),hash);
 erase(bytes.data(),bytes.size());return ok;
}
int entropy(void*,unsigned char* output,size_t length){esp_fill_random(output,length);return 0;}
void sendLine(const std::string& line){for(char c:line)esp_rom_output_tx_one_char(uint8_t(c));esp_rom_output_tx_one_char('\n');}
void flashDiagnostic(esp_err_t rc,uint32_t physical,uint32_t usable){
  // Only bounded numeric metadata, never arbitrary SDK messages or buffers.
  const uint32_t safeRc=(rc>=0&&rc<=0xffff)?uint32_t(rc):0xffff;
  char text[160];snprintf(text,sizeof(text),"HATCHAI-FLASH-DIAG rc=%lu physical=%lu usable=%lu rom=%lu",
    (unsigned long)safeRc,(unsigned long)physical,(unsigned long)usable,(unsigned long)g_rom_flashchip.chip_size);sendLine(text);
}
std::string base64(const uint8_t* p,size_t n){uint8_t out[512];size_t used=0;if(mbedtls_base64_encode(out,sizeof(out)-1,&used,p,n))return "";return std::string(reinterpret_cast<char*>(out),used);}
bool decode(const char* s,uint8_t* out,size_t capacity,size_t& used){return s&&strlen(s)<=1024&&mbedtls_base64_decode(out,capacity,&used,reinterpret_cast<const uint8_t*>(s),strlen(s))==0;}
bool line(char* out,size_t capacity,int64_t deadline){
  size_t n=0;while(esp_timer_get_time()<deadline){uint8_t b;if(esp_rom_output_rx_one_char(&b)!=0){vTaskDelay(1);continue;}
    if(b=='\r')continue;
    if(b=='\n'){out[n]=0;return n>0;}
    if(b<32||b>126||n+1>=capacity)return false;
    out[n++]=char(b);}
  return false;
}
void put32(uint8_t*p,uint32_t n){for(unsigned i=0;i<4;++i)p[i]=uint8_t(n>>(8*i));}
uint32_t get32(const uint8_t*p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
void sequenceBytes(uint64_t n,uint8_t out[8]){for(unsigned i=0;i<8;++i)out[7-i]=uint8_t(n>>(8*i));}
bool protect(bool encrypt,const uint8_t key[32],const uint8_t challenge[32],uint64_t sequence,const uint8_t* input,size_t length,uint8_t* output,size_t& used){
  uint8_t iv[12],aad[sizeof(Protocol)-1+32+8];memcpy(iv,encrypt?"D2H!":"H2D!",4);sequenceBytes(sequence,iv+4);
  memcpy(aad,Protocol,sizeof(Protocol)-1);memcpy(aad+sizeof(Protocol)-1,challenge,32);sequenceBytes(sequence,aad+sizeof(Protocol)-1+32);
  mbedtls_gcm_context gcm;mbedtls_gcm_init(&gcm);bool ok=mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,key,256)==0;
  if(ok&&encrypt){used=length+16;ok=mbedtls_gcm_crypt_and_tag(&gcm,MBEDTLS_GCM_ENCRYPT,length,iv,sizeof(iv),aad,sizeof(aad),input,output,16,output+length)==0;}
  else if(ok&&length>=16){used=length-16;ok=mbedtls_gcm_auth_decrypt(&gcm,used,iv,sizeof(iv),aad,sizeof(aad),input+used,16,input,output)==0;}else ok=false;
  mbedtls_gcm_free(&gcm);return ok;
}
const uint8_t* traceKey=nullptr;const uint8_t* traceChallenge=nullptr;
unsigned traceSequence=0,traceCounter=0;int64_t traceStart=0;
void encryptedTrace(unsigned stage,int rc){
 if(!traceKey||!traceChallenge||!traceSequence||traceCounter>=96)return;
 uint8_t payload[16];payload[0]=uint8_t(stage);payload[1]=0;
 const unsigned code=rc>=0&&rc<=65535?unsigned(rc):65535;payload[2]=uint8_t(code);payload[3]=uint8_t(code>>8);
 put32(payload+4,uint32_t((esp_timer_get_time()-traceStart)/1000));
 put32(payload+8,uint32_t(heap_caps_get_free_size(MALLOC_CAP_8BIT)));
 put32(payload+12,uint32_t(uxTaskGetStackHighWaterMark(nullptr)));
 const uint64_t ticket=(uint64_t(traceSequence)<<32)|++traceCounter;
 uint8_t iv[12],aad[sizeof(Protocol)-1+32+8],output[32];memcpy(iv,"S2H!",4);sequenceBytes(ticket,iv+4);
 memcpy(aad,Protocol,sizeof(Protocol)-1);memcpy(aad+sizeof(Protocol)-1,traceChallenge,32);sequenceBytes(ticket,aad+sizeof(Protocol)-1+32);
 mbedtls_gcm_context gcm;mbedtls_gcm_init(&gcm);
 const bool ok=mbedtls_gcm_setkey(&gcm,MBEDTLS_CIPHER_ID_AES,traceKey,256)==0&&
  mbedtls_gcm_crypt_and_tag(&gcm,MBEDTLS_GCM_ENCRYPT,sizeof(payload),iv,sizeof(iv),aad,sizeof(aad),payload,output,16,output+16)==0;
 mbedtls_gcm_free(&gcm);
 if(ok)sendLine(std::string("HATCHAI-STAGE-1 ")+std::to_string(traceSequence)+" "+std::to_string(traceCounter)+" "+base64(output,sizeof(output)));
 erase(payload,sizeof(payload));erase(output,sizeof(output));
}
enum class LayoutResult:uint8_t {Ok,ReadFailed,TableInvalid,EntriesInvalid,NvsInvalid,FlagsUnsupported};
struct ExpectedPartition {const char* label;uint8_t type;uint8_t subtype;uint32_t offset;uint32_t size;};
constexpr ExpectedPartition ExpectedPartitions[]={
  {"nvs",1,2,0x9000,0x5000},{"otadata",1,0,0xe000,0x2000},
  {"app0",0,0x10,0x10000,0x140000},{"app1",0,0x11,0x150000,0x140000},
  {"spiffs",1,0x82,0x290000,0x160000},{"coredump",1,3,0x3f0000,0x10000}};
LayoutResult physicalNvsPartition(esp_partition_t& output){
  std::array<esp_partition_info_t,ESP_PARTITION_TABLE_MAX_ENTRIES> table{};
  if(esp_flash_read(esp_flash_default_chip,table.data(),ESP_PARTITION_TABLE_OFFSET,sizeof(table))!=ESP_OK)return LayoutResult::ReadFailed;
  const size_t count=sizeof(ExpectedPartitions)/sizeof(ExpectedPartitions[0]);
  const uint8_t* marker=reinterpret_cast<const uint8_t*>(&table[count]);
  if(table[count].magic!=ESP_PARTITION_MAGIC_MD5||table[count+1].magic!=0xffff||
     table[count+1].type!=PART_TYPE_END||table[count+1].subtype!=PART_SUBTYPE_END)return LayoutResult::TableInvalid;
  for(size_t i=2;i<ESP_PARTITION_MD5_OFFSET;++i)if(marker[i]!=0xff)return LayoutResult::TableInvalid;
  md5_context_t md5;uint8_t calculated[16];esp_rom_md5_init(&md5);
  esp_rom_md5_update(&md5,reinterpret_cast<const uint8_t*>(table.data()),count*sizeof(esp_partition_info_t));esp_rom_md5_final(calculated,&md5);
  if(memcmp(calculated,marker+ESP_PARTITION_MD5_OFFSET,sizeof(calculated)))return LayoutResult::TableInvalid;
  uint32_t previousEnd=0;
  for(size_t i=0;i<count;++i){
    const auto& entry=table[i];const auto& expected=ExpectedPartitions[i];
    size_t labelLength=strnlen(reinterpret_cast<const char*>(entry.label),sizeof(entry.label));
    if(entry.magic!=ESP_PARTITION_MAGIC||labelLength!=strlen(expected.label)||memcmp(entry.label,expected.label,labelLength)||entry.type!=expected.type||entry.subtype!=expected.subtype||
       entry.pos.offset!=expected.offset||entry.pos.size!=expected.size||!entry.pos.size||entry.pos.offset%FlashSectorSize||entry.pos.size%FlashSectorSize||
       entry.pos.offset>0x400000||entry.pos.size>0x400000-entry.pos.offset||entry.pos.offset<previousEnd)return LayoutResult::EntriesInvalid;
    if(entry.flags&(PART_FLAG_ENCRYPTED|PART_FLAG_READONLY))return LayoutResult::FlagsUnsupported;
    if(entry.flags&~uint32_t(PART_FLAG_ENCRYPTED|PART_FLAG_READONLY))return LayoutResult::FlagsUnsupported;
    previousEnd=entry.pos.offset+entry.pos.size;
  }
  const auto& nvs=table[0];
  if(nvs.type!=ESP_PARTITION_TYPE_DATA||nvs.subtype!=ESP_PARTITION_SUBTYPE_DATA_NVS||nvs.pos.offset!=0x9000||nvs.pos.size!=0x5000)return LayoutResult::NvsInvalid;
  output={};output.flash_chip=esp_flash_default_chip;output.type=ESP_PARTITION_TYPE_DATA;output.subtype=ESP_PARTITION_SUBTYPE_DATA_NVS;
  output.address=nvs.pos.offset;output.size=nvs.pos.size;output.erase_size=FlashSectorSize;memcpy(output.label,"nvs",4);
  output.encrypted=false;output.readonly=false;return LayoutResult::Ok;
}
const char* layoutError(LayoutResult result){
  switch(result){case LayoutResult::ReadFailed:return "layout_read_failed";case LayoutResult::TableInvalid:return "layout_table_invalid";
    case LayoutResult::EntriesInvalid:return "layout_entries_invalid";case LayoutResult::NvsInvalid:return "layout_nvs_invalid";
    case LayoutResult::FlagsUnsupported:return "layout_flags_unsupported";default:return "layout_unknown";}
}
}
extern "C" void app_main(){
  // No GPIO actuator initialization, networking, boot metadata writes, automatic erase or reset.
  // IDF's existing UART0 console setup supplies 115200 baud; ROM RX has no echo.
  esp_chip_info_t chip;esp_chip_info(&chip);uint32_t flashSize=0;
  if(chip.model!=CHIP_ESP32){sendLine("HATCHAI-USB-ERROR chip_incompatible");stop();}
  esp_err_t flashRc=esp_flash_init_default_chip();uint32_t physical=0;
  if(flashRc!=ESP_OK||!esp_flash_default_chip){flashDiagnostic(flashRc,physical,flashSize);sendLine("HATCHAI-USB-ERROR flash_init_failed");stop();}
  flashRc=esp_flash_get_physical_size(esp_flash_default_chip,&physical);
  if(flashRc!=ESP_OK){flashDiagnostic(flashRc,physical,flashSize);sendLine("HATCHAI-USB-ERROR flash_size_query_failed");stop();}
  if(physical!=0x400000){flashDiagnostic(ESP_OK,physical,flashSize);sendLine("HATCHAI-USB-ERROR flash_size_mismatch");stop();}
  // Same RAM metadata helper used by the classic ESP32 bootloader. The value
  // comes from independent driver detection, never from the expected constant.
  bootloader_flash_update_size(physical);
  // IDF 5.4.4 caches the initial ROM limit in this public descriptor. Physical
  // detection intentionally does not replace a nonzero cached size. Reconcile
  // RAM metadata only, using the independently verified physical result; do not
  // repeat init_default_chip(), whose stale-size comparison returns 0x104.
  esp_flash_default_chip->size=physical;
  uint32_t confirmedPhysical=0;
  flashRc=esp_flash_get_physical_size(esp_flash_default_chip,&confirmedPhysical);
  if(flashRc!=ESP_OK){flashDiagnostic(flashRc,confirmedPhysical,flashSize);sendLine("HATCHAI-USB-ERROR flash_size_query_failed");stop();}
  if(confirmedPhysical!=physical){flashDiagnostic(ESP_OK,confirmedPhysical,flashSize);sendLine("HATCHAI-USB-ERROR flash_size_mismatch");stop();}
  flashRc=esp_flash_get_size(esp_flash_default_chip,&flashSize);
  flashDiagnostic(flashRc,physical,flashSize);
  if(flashRc!=ESP_OK){sendLine("HATCHAI-USB-ERROR flash_size_query_failed");stop();}
  if(flashSize!=physical||g_rom_flashchip.chip_size!=physical){sendLine("HATCHAI-USB-ERROR flash_size_mismatch");stop();}
  esp_partition_t part{};const LayoutResult layout=physicalNvsPartition(part);
  if(layout!=LayoutResult::Ok){sendLine(std::string("HATCHAI-USB-ERROR ")+layoutError(layout));stop();}
  // No NVS SDK calls or namespace creation before authenticated authorization.
  uint8_t rawBefore[32];if(!rawSnapshot(rawBefore)){sendLine("HATCHAI-USB-ERROR raw_nvs_invalid");stop();}
  NvsStore store(&part);
  uint8_t mac[6],challenge[32],devicePublic[65];esp_read_mac(mac,ESP_MAC_WIFI_STA);
  mbedtls_ctr_drbg_context rng;mbedtls_ctr_drbg_init(&rng);
  // RF is off; explicitly enable the hardware entropy source only while seeding.
  bootloader_random_enable();esp_fill_random(challenge,sizeof(challenge));
  int err=mbedtls_ctr_drbg_seed(&rng,entropy,nullptr,reinterpret_cast<const uint8_t*>(Protocol),sizeof(Protocol)-1);bootloader_random_disable();if(err)stop();
  mbedtls_ecp_group group;mbedtls_ecp_group_init(&group);mbedtls_mpi privateKey;mbedtls_mpi_init(&privateKey);mbedtls_ecp_point publicKey;mbedtls_ecp_point_init(&publicKey);
  size_t publicLength=0;
  if(mbedtls_ecp_group_load(&group,MBEDTLS_ECP_DP_SECP256R1)||mbedtls_ecp_gen_keypair(&group,&privateKey,&publicKey,mbedtls_ctr_drbg_random,&rng)||mbedtls_ecp_point_write_binary(&group,&publicKey,MBEDTLS_ECP_PF_UNCOMPRESSED,&publicLength,devicePublic,sizeof(devicePublic))||publicLength!=65)stop();
  char macText[13];snprintf(macText,sizeof(macText),"%02x%02x%02x%02x%02x%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
  sendLine(std::string(Prefix)+" "+macText+" "+base64(challenge,32)+" "+base64(devicePublic,65));
  uint8_t sessionKey[32]={},acceptedPeer[65]={};bool established=false;
  const int64_t deadline=esp_timer_get_time()+120000000;
  for(unsigned sequence=1;sequence<=3;++sequence){
    traceSequence=sequence;traceCounter=0;traceStart=esp_timer_get_time();
    char input[1024];if(!line(input,sizeof(input),deadline)){trace(90,1);break;}
    trace(10);
    char* save=nullptr;char* prefix=strtok_r(input," ",&save);char* seq=strtok_r(nullptr," ",&save);char* peerText=strtok_r(nullptr," ",&save);char* packetText=strtok_r(nullptr," ",&save);
    if(!prefix||strcmp(prefix,Prefix)||!seq||strlen(seq)!=1||seq[0]!=char('0'+sequence)||!peerText||!packetText||strtok_r(nullptr," ",&save)){trace(90,3);break;}
    uint8_t peer[65],encrypted[512],plain[512];size_t peerLength=0,encryptedLength=0,plainLength=0;
    Wipe plainWipe{plain,sizeof(plain)};
    if(!decode(peerText,peer,sizeof(peer),peerLength)||peerLength!=65||!decode(packetText,encrypted,sizeof(encrypted),encryptedLength)||encryptedLength<24){trace(90,4);break;}
    if(!established){
      mbedtls_ecp_point point;mbedtls_ecp_point_init(&point);mbedtls_mpi shared;mbedtls_mpi_init(&shared);uint8_t secret[32],info[sizeof(Protocol)-1+6+65+65];
      err=mbedtls_ecp_point_read_binary(&group,&point,peer,65)||mbedtls_ecp_check_pubkey(&group,&point)||mbedtls_ecdh_compute_shared(&group,&shared,&point,&privateKey,mbedtls_ctr_drbg_random,&rng)||mbedtls_mpi_write_binary(&shared,secret,32);
      if(!err){size_t at=0;memcpy(info+at,Protocol,sizeof(Protocol)-1);at+=sizeof(Protocol)-1;memcpy(info+at,mac,6);at+=6;memcpy(info+at,devicePublic,65);at+=65;memcpy(info+at,peer,65);
        err=mbedtls_hkdf(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),challenge,32,secret,32,info,sizeof(info),sessionKey,32);}
      erase(secret,sizeof(secret));mbedtls_mpi_free(&shared);mbedtls_ecp_point_free(&point);if(err)break;memcpy(acceptedPeer,peer,65);established=true;
    }else if(!equal(peer,acceptedPeer,65)){trace(90,5);break;}
    traceKey=sessionKey;traceChallenge=challenge;traceSink()=encryptedTrace;
    if(!protect(false,sessionKey,challenge,sequence,encrypted,encryptedLength,plain,plainLength)||plainLength<8){trace(90,2);break;}
    trace(20);
    const unsigned op=plain[0],flags=plain[1];const uint32_t expected=get32(plain+2);const size_t recordLength=unsigned(plain[6])|(unsigned(plain[7])<<8);
    if(flags>3||recordLength>160||plainLength!=8+recordLength||(op!=1&&op!=2&&op!=3)||
      (op==1&&(recordLength||flags||expected))||(op==3&&(flags||expected))){trace(90,6);break;}
    if((sequence==1&&op!=1)||(sequence!=1&&op==1)){trace(90,7);break;}
    uint8_t response[ResponseBytes]={};Result result=Result::Ok;
    uint8_t before[32]={};
    if(op!=1){
      HatchPairing::Credentials checked;uint32_t generation=0;uint8_t current[32];
      // A complete, authenticated request plus valid record is mandatory. Any
      // changed/damaged NVS or SDK recovery write attempt aborts with gate shut.
      if(!HatchPairing::decodeCredential(plain+8,recordLength,checked,generation)||
         !rawSnapshot(current)||!equal(rawBefore,current,32)){sendLine("HATCHAI-USB-ERROR authorization_validation_failed");break;}
      trace(21);
      part.readonly=true;
      trace(30);esp_err_t initRc=nvs_flash_init_partition_ptr(&part);trace(31,initRc);
      if(initRc!=ESP_OK||writeGate.attempted()||!rawSnapshot(current)||!equal(rawBefore,current,32)){sendLine("HATCHAI-USB-ERROR readonly_nvs_init_refused");break;}
      trace(32);auto digestRc=unrelatedDigest(before);trace(33,int(digestRc));
      if(digestRc!=DigestResult::Ok){sendLine("HATCHAI-USB-ERROR readonly_nvs_init_refused");break;}
      if(op==2){
        if(!writeGate.authorize(established,true,true)){trace(90,10);break;}
        part.readonly=false;
        trace(40);
      }
      if(!store.open(op==2)){sendLine("HATCHAI-USB-ERROR storage_open_failed");break;}
    }
    if(op==2){Options opts;opts.resume=flags&1;opts.replace=flags&2;opts.expectedGeneration=expected;result=provision(store,plain+8,recordLength,opts);}
    if(op==3)result=verifyExisting(store,plain+8,recordLength);
    State state;uint8_t after[32]={};
    if(op!=1&&(!inspect(store,state)||unrelatedDigest(after)!=DigestResult::Ok))result=Result::Io;
    response[0]=uint8_t(result);response[1]=uint8_t(state.active);response[2]=state.enabled;response[3]=state.valid;response[4]=state.pending;put32(response+5,state.generation);memcpy(response+9,rawBefore,32);
    if(op!=1&&!equal(before,after,32))response[0]=9;
    if(op!=1&&(result==Result::Ok||result==Result::AlreadyVerified)&&response[0]!=9){
      Value actual;HatchPairing::Credentials credential;uint32_t generation=0;
      if(!store.read(state.active==0?"slot0":"slot1",actual)||!HatchPairing::decodeCredential(actual.bytes.data(),actual.bytes.size(),credential,generation)){response[0]=uint8_t(Result::Readback);}
      else{
        if(!digest(actual.bytes.data(),actual.bytes.size(),response+41))response[0]=uint8_t(Result::Readback);
        uint8_t proof[sizeof(ProofDomain)-1+32+160];size_t at=0;
        memcpy(proof,ProofDomain,sizeof(ProofDomain)-1);at+=sizeof(ProofDomain)-1;memcpy(proof+at,challenge,32);at+=32;memcpy(proof+at,actual.bytes.data(),actual.bytes.size());at+=actual.bytes.size();
        if(mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),credential.key,32,proof,at,response+73))response[0]=uint8_t(Result::Readback);
        erase(proof,sizeof(proof));}
      erase(actual.bytes.data(),actual.bytes.size());
    }
    erase(plain,sizeof(plain));uint8_t output[ResponseBytes+16];size_t outputLength=0;
    if(!protect(true,sessionKey,challenge,sequence,response,sizeof(response),output,outputLength))break;
    sendLine(std::string(Prefix)+" "+std::string(1,char('0'+sequence))+" "+base64(output,outputLength));
    erase(response,sizeof(response));if(op!=1)break;
  }
  writeGate.close();
  traceSink()=nullptr;traceKey=nullptr;traceChallenge=nullptr;
  erase(sessionKey,sizeof(sessionKey));mbedtls_mpi_free(&privateKey);mbedtls_ecp_point_free(&publicKey);mbedtls_ecp_group_free(&group);mbedtls_ctr_drbg_free(&rng);
  stop(); // No auto-boot: supervisor must explicitly restart the installed application.
}
