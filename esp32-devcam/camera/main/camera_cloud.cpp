#include "camera_cloud.hpp"
#include "camera_event_record.hpp"
#include "hatch_link_config.hpp"
#include "NotificationPairingProtocol.h"
#include "NotificationHttpParser.h"
#include "NotificationUtcClock.h"
#include "NotificationIntegrationPolicy.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "esp_tls.h"
#include "esp_idf_version.h"
#include "esp_tls_private.h"
static_assert(ESP_IDF_VERSION==ESP_IDF_VERSION_VAL(5,4,4),"Re-review async TLS compatibility before changing camera SDK");
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "esp_random.h"
#include "esp_sntp.h"
#include "nvs.h"
#include "lwip/dns.h"
#include "lwip/tcpip.h"
#include "mbedtls/ssl.h"
#include "mbedtls/sha256.h"
#include "cJSON.h"
#include <time.h>
#include <atomic>
#include <stdio.h>
#include <string>
namespace HatchCameraCloud { namespace {
constexpr const char* Host="hatchai.kurtzidrickguno-robles.workers.dev";
struct Job {uint8_t* jpeg;size_t length;uint32_t captured;};
static QueueHandle_t queue=nullptr;static HatchPairing::Credentials credential;static std::atomic<bool> enabled{false};
static portMUX_TYPE guard=portMUX_INITIALIZER_UNLOCKED;static uint32_t dnsTicket=0;static bool dnsDone=false,dnsOk=false;static ip_addr_t dnsAddress;static int64_t syncUs=-1;
void synced(timeval*){portENTER_CRITICAL(&guard);syncUs=esp_timer_get_time();portEXIT_CRITICAL(&guard);}
bool clockReady(){portENTER_CRITICAL(&guard);const int64_t at=syncUs;portEXIT_CRITICAL(&guard);return at>=0&&esp_timer_get_time()-at<21600000000LL&&time(nullptr)>=1704067200&&uint64_t(time(nullptr))<4102444800ULL;}
void resolved(const char*,const ip_addr_t* ip,void* argument){portENTER_CRITICAL(&guard);if(uint32_t(uintptr_t(argument))==dnsTicket){dnsDone=true;dnsOk=ip;if(ip)dnsAddress=*ip;}portEXIT_CRITICAL(&guard);}
void resolve(void* argument){ip_addr_t ip;const auto rc=dns_gethostbyname(Host,&ip,resolved,argument);if(rc==ERR_OK)resolved(nullptr,&ip,argument);else if(rc!=ERR_INPROGRESS)resolved(nullptr,nullptr,argument);}
bool certificate(esp_tls_t* tls){auto* ssl=static_cast<mbedtls_ssl_context*>(esp_tls_get_ssl_context(tls));if(!ssl||mbedtls_ssl_get_verify_result(ssl)){return false;}const mbedtls_x509_crt* crt=mbedtls_ssl_get_peer_cert(ssl);unsigned count=0;for(;crt;crt=crt->next){uint64_t from,to;const auto a=crt->valid_from,b=crt->valid_to;if(++count>8||!HatchPairing::certificateDateUtc(a.year,a.mon,a.day,a.hour,a.min,a.sec,from)||!HatchPairing::certificateDateUtc(b.year,b.mon,b.day,b.hour,b.min,b.sec,to)||!HatchPairing::certificateWindowValid(time(nullptr),from,to)){return false;}}return count>0;}
bool post(const char* path,const std::string& signedBody,const uint8_t* jpeg,size_t jpegLength,HatchPairing::NotificationHttpResponse& response){
 if(!clockReady()||heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<100*1024||heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<48*1024){return false;}
 uint32_t ticket;portENTER_CRITICAL(&guard);if(dnsTicket==UINT32_MAX){portEXIT_CRITICAL(&guard);return false;}ticket=++dnsTicket;dnsDone=dnsOk=false;portEXIT_CRITICAL(&guard);
 if(tcpip_try_callback(resolve,reinterpret_cast<void*>(uintptr_t(ticket)))!=ERR_OK){return false;}const int64_t start=esp_timer_get_time();char address[48]={};
 for(;;){bool done,ok;ip_addr_t ip;portENTER_CRITICAL(&guard);done=dnsDone;ok=dnsOk;if(done&&ok)ip=dnsAddress;portEXIT_CRITICAL(&guard);if(done){if(!ok||!ipaddr_ntoa_r(&ip,address,sizeof(address))){return false;}break;}if(esp_timer_get_time()-start>=2000000){return false;}vTaskDelay(pdMS_TO_TICKS(10));}
 esp_tls_t* tls=esp_tls_init();if(!tls){return false;}esp_tls_cfg_t cfg={};cfg.non_block=true;cfg.timeout_ms=20;cfg.crt_bundle_attach=esp_crt_bundle_attach;cfg.common_name=Host;
 bool connected=false;const int64_t connectAt=esp_timer_get_time();while(esp_timer_get_time()-connectAt<6000000){
  // IDF 5.4.4 select() clears these sets on timeout. Restore only while TCP connects.
  if(tls->conn_state==ESP_TLS_CONNECTING&&tls->sockfd>=0){FD_ZERO(&tls->rset);FD_ZERO(&tls->wset);FD_SET(tls->sockfd,&tls->rset);FD_SET(tls->sockfd,&tls->wset);}
  const int rc=esp_tls_conn_new_async(address,strlen(address),443,&cfg,tls);if(rc==1){connected=certificate(tls);break;}if(rc<0){break;}vTaskDelay(pdMS_TO_TICKS(10));}
 if(!connected){esp_tls_conn_destroy(tls);return false;}
 const bool image=jpeg!=nullptr;const auto* payload=image?jpeg:reinterpret_cast<const uint8_t*>(signedBody.data());const size_t length=image?jpegLength:signedBody.size();
 std::string header="POST "+std::string(path)+" HTTP/1.1\r\nHost: "+Host+"\r\nContent-Type: "+(image?"image/jpeg":"application/json")+"\r\nAccept-Encoding: identity\r\nConnection: close\r\nContent-Length: "+std::to_string(length)+"\r\n";
 if(image){header+="X-Hatchai-Capture: "+signedBody+"\r\n";}header+="\r\n";if(header.size()>2500){esp_tls_conn_destroy(tls);return false;}
 size_t sent=0;char input[256];HatchPairing::NotificationHttpStreamParser parser;parser.reset(time(nullptr));bool ok=false;
 while(esp_timer_get_time()-start<12000000){int rc;if(sent<header.size()+length){const bool h=sent<header.size();const auto* p=h?reinterpret_cast<const uint8_t*>(header.data())+sent:payload+sent-header.size();const size_t n=h?header.size()-sent:length-(sent-header.size());rc=esp_tls_conn_write(tls,p,n>4096?4096:n);if(rc>0)sent+=rc;else if(rc!=MBEDTLS_ERR_SSL_WANT_READ&&rc!=MBEDTLS_ERR_SSL_WANT_WRITE){break;}}
  else{rc=esp_tls_conn_read(tls,input,sizeof(input));if(rc>0){const auto state=parser.feed(input,rc);if(state==HatchPairing::HttpStreamState::Failed){break;}if(state==HatchPairing::HttpStreamState::Complete){ok=parser.result(response);break;}}else if(rc==0||rc==MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY){ok=parser.end()==HatchPairing::HttpStreamState::Complete&&parser.result(response);break;}else if(rc!=MBEDTLS_ERR_SSL_WANT_READ&&rc!=MBEDTLS_ERR_SSL_WANT_WRITE){break;}}vTaskDelay(pdMS_TO_TICKS(10));}
 HatchPairing::erase(input,sizeof(input));esp_tls_conn_destroy(tls);return ok;
}
std::string random(bool uuid=false){uint8_t value[24];esp_fill_random(value,sizeof(value));if(!uuid){return HatchPairing::base64url(value,sizeof(value));}value[6]=(value[6]&15)|64;value[8]=(value[8]&63)|128;char out[37];snprintf(out,sizeof(out),"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",value[0],value[1],value[2],value[3],value[4],value[5],value[6],value[7],value[8],value[9],value[10],value[11],value[12],value[13],value[14],value[15]);return out;}
bool ack(const HatchPairing::NotificationHttpResponse& response,const Event& event){if(response.status!=200){return false;}auto* doc=cJSON_ParseWithLength(response.body.data(),response.length);if(!doc){return false;}const auto* id=cJSON_GetObjectItemCaseSensitive(doc,"eventId");const bool ok=cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(doc,"accepted"))&&cJSON_IsString(id)&&strcmp(id->valuestring,event.id)==0;cJSON_Delete(doc);return ok;}
void slotName(unsigned slot,char (&out)[3]){snprintf(out,sizeof(out),"e%u",slot);}
bool save(nvs_handle_t store,unsigned slot,const Event& event){uint8_t bytes[RecordBytes],check[RecordBytes];if(!encode(event,bytes)){return false;}char name[3];slotName(slot,name);size_t n=sizeof(check);return nvs_set_blob(store,name,bytes,sizeof(bytes))==ESP_OK&&nvs_commit(store)==ESP_OK&&nvs_get_blob(store,name,check,&n)==ESP_OK&&n==sizeof(check)&&memcmp(bytes,check,n)==0;}
bool remove(nvs_handle_t store,unsigned slot){char name[3];slotName(slot,name);return nvs_erase_key(store,name)==ESP_OK&&nvs_commit(store)==ESP_OK;}
void run(void*){
 nvs_handle_t store;if(nvs_open("hatchai-camevt",NVS_READWRITE,&store)!=ESP_OK){enabled=false;vTaskDelete(nullptr);return;}
 Event events[4];bool occupied[4]={};Job images[4]={};unsigned imageAttempts[4]={};
 for(unsigned i=0;i<4;i++){char name[3];slotName(i,name);uint8_t bytes[RecordBytes];size_t n=sizeof(bytes);const auto rc=nvs_get_blob(store,name,bytes,&n);if(rc==ESP_ERR_NVS_NOT_FOUND){continue;}if(rc!=ESP_OK||!decode(bytes,n,events[i])||events[i].camera!=uint8_t(credential.deviceId.back()-'0')){enabled=false;nvs_close(store);vTaskDelete(nullptr);return;}occupied[i]=true;}
 enabled=true;unsigned attempts=0;uint64_t waitMs=0;HatchPairing::NotificationUtcClock utcClock;int64_t observedSync=-1;
 while(true){
  Job incoming;if(xQueueReceive(queue,&incoming,pdMS_TO_TICKS(250))==pdTRUE){unsigned slot=0;while(slot<4&&occupied[slot])slot++;if(slot<4){Event record;record.camera=uint8_t(credential.deviceId.back()-'0');record.capturedAt=incoming.captured;const auto id=random(true);memcpy(record.id,id.c_str(),37);if(save(store,slot,record)){events[slot]=record;occupied[slot]=true;images[slot]=incoming;imageAttempts[slot]=0;}else{heap_caps_free(incoming.jpeg);enabled=false;break;}}else heap_caps_free(incoming.jpeg);}
  if(waitMs){vTaskDelay(pdMS_TO_TICKS(250));waitMs=waitMs>250?waitMs-250:0;continue;}
  if(!clockReady()){continue;}portENTER_CRITICAL(&guard);const int64_t currentSync=syncUs;portEXIT_CRITICAL(&guard);const uint32_t monotonic=uint32_t(esp_timer_get_time()/1000);if(currentSync!=observedSync){utcClock.synchronize(time(nullptr),monotonic);observedSync=currentSync;}if(!utcClock.valid(time(nullptr),monotonic)){enabled=false;break;}unsigned slot=0;while(slot<4&&!occupied[slot])slot++;if(slot==4){continue;}const Event event=events[slot];const uint64_t utc=time(nullptr);
  if(uint64_t(event.capturedAt)+604800<utc){if(!remove(store,slot)){enabled=false;break;}heap_caps_free(images[slot].jpeg);images[slot]={};occupied[slot]=false;continue;}
  const std::string body="{\"deviceId\":\""+credential.deviceId+"\",\"keyId\":\""+credential.keyId+"\",\"issuedAt\":"+std::to_string(utc)+",\"nonce\":\""+random()+"\",\"eventId\":\""+event.id+"\",\"detectedAt\":"+std::to_string(event.capturedAt)+"}";
  HatchPairing::SignedRequest signedRequest;HatchPairing::NotificationHttpResponse response;bool ok=HatchPairing::signCamera("/device/camera-events",body,credential,signedRequest)&&post("/device/camera-events",signedRequest.body,nullptr,0,response)&&ack(response,event);
  if(response.status==401||response.status==403||response.status==409){enabled=false;break;}
  if(ok&&images[slot].jpeg&&uint64_t(event.capturedAt)+900>utc&&imageAttempts[slot]<3){uint8_t hash[32];if(mbedtls_sha256(images[slot].jpeg,images[slot].length,hash,0)!=0){enabled=false;break;}const auto digest=HatchPairing::base64url(hash,32);HatchPairing::erase(hash,sizeof(hash));
   const std::string envelope="{\"deviceId\":\""+credential.deviceId+"\",\"keyId\":\""+credential.keyId+"\",\"issuedAt\":"+std::to_string(uint64_t(time(nullptr)))+",\"nonce\":\""+random()+"\",\"eventId\":\""+event.id+"\",\"contentHash\":\""+digest+"\",\"byteLength\":"+std::to_string(images[slot].length)+"}";
   ++imageAttempts[slot];response={};ok=HatchPairing::signCamera("/device/camera-captures",envelope,credential,signedRequest)&&post("/device/camera-captures",signedRequest.body,images[slot].jpeg,images[slot].length,response)&&ack(response,event);if(response.status==401||response.status==403||response.status==409){enabled=false;break;}
   if(!ok&&imageAttempts[slot]>=3){heap_caps_free(images[slot].jpeg);images[slot]={};ok=true;}
  }
  if(ok){if(!remove(store,slot)){enabled=false;break;}heap_caps_free(images[slot].jpeg);images[slot]={};occupied[slot]=false;attempts=0;waitMs=250;}
  else{attempts=attempts<8?attempts+1:8;waitMs=(uint64_t(1000)<<attempts)+(esp_random()%1000);if((response.status==429||response.status==503)&&response.retryAfterMs>waitMs)waitMs=response.retryAfterMs;}
 }
 for(auto& image:images){heap_caps_free(image.jpeg);}HatchPairing::erase(credential.key,32);nvs_close(store);while(true){Job job;if(xQueueReceive(queue,&job,pdMS_TO_TICKS(1000))==pdTRUE)heap_caps_free(job.jpeg);}
}
} // namespace
void begin(){
 if(!strlen(HatchLink::CameraId)){return;}nvs_handle_t store;if(nvs_open("hatchai-cloud",NVS_READONLY,&store)!=ESP_OK){return;}
 char device[65]={},keyId[65]={};uint8_t active=0;size_t a=sizeof(device),b=sizeof(keyId),n=sizeof(credential.key);
 const bool ok=nvs_get_u8(store,"enabled",&active)==ESP_OK&&active==1&&nvs_get_str(store,"device",device,&a)==ESP_OK&&strcmp(device,HatchLink::CameraId)==0&&nvs_get_str(store,"key-id",keyId,&b)==ESP_OK&&HatchPairing::validKeyId(keyId)&&nvs_get_blob(store,"key",credential.key,&n)==ESP_OK&&n==32;nvs_close(store);
 if(!ok||(strcmp(device,"hatchai-inc01-cam01")&&strcmp(device,"hatchai-inc01-cam02"))){HatchPairing::erase(credential.key,32);return;}
 credential.deviceId=device;credential.keyId=keyId;credential.keyLength=32;queue=xQueueCreate(2,sizeof(Job));if(!queue){HatchPairing::erase(credential.key,32);return;}esp_sntp_set_time_sync_notification_cb(synced);if(esp_sntp_get_sync_status()==SNTP_SYNC_STATUS_COMPLETED)synced(nullptr);
 TaskHandle_t task;if(xTaskCreatePinnedToCore(run,"camera-cloud",16384,nullptr,1,&task,0)!=pdPASS){enabled=false;vQueueDelete(queue);queue=nullptr;HatchPairing::erase(credential.key,32);return;}
}
bool submit(uint8_t* jpeg,size_t length,int64_t captured){if(!enabled||!queue||!clockReady()||!jpeg||length<4||length>131072){return false;}const int64_t elapsed=esp_timer_get_time()-captured;if(elapsed<0||elapsed>60000000){return false;}Job job{jpeg,length,uint32_t(time(nullptr)-elapsed/1000000)};return xQueueSend(queue,&job,0)==pdTRUE;}
} // namespace HatchCameraCloud
