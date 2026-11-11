#include "CloudSync.h"
#include "CameraEventStore.h"
#include "CloudSyncRecovery.h"
#include "CloudApiCredentialStore.h"
#include <Preferences.h>
#include <WiFi.h>
#include <esp_tls.h>
#include <esp_heap_caps.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <lwip/dns.h>
#include <lwip/tcpip.h>
#include <mbedtls/ssl.h>
#include <ArduinoJson.h>
#include "NotificationPairingProtocol.h"
#include "NotificationHttpParser.h"
#include "NotificationUtcClock.h"
#include "NotificationIntegrationPolicy.h"
extern "C" esp_err_t esp_crt_bundle_attach(void* configuration);
namespace {
constexpr const char* Host="hatchai.kurtzidrickguno-robles.workers.dev";
portMUX_TYPE lock=portMUX_INITIALIZER_UNLOCKED;uint32_t dnsEpoch=0,syncAt=0;bool dnsDone=false,dnsValid=false,clockSynced=false;ip_addr_t address;
void synchronized(struct timeval*){portENTER_CRITICAL(&lock);syncAt=millis();clockSynced=true;portEXIT_CRITICAL(&lock);}
void found(const char*,const ip_addr_t* value,void* cookie){portENTER_CRITICAL(&lock);if(uint32_t(uintptr_t(cookie))==dnsEpoch){dnsDone=true;dnsValid=value!=nullptr;if(value)address=*value;}portEXIT_CRITICAL(&lock);}
void resolve(void* cookie){ip_addr_t out;err_t rc=dns_gethostbyname(Host,&out,found,cookie);if(rc==ERR_OK)found(nullptr,&out,cookie);else if(rc!=ERR_INPROGRESS)found(nullptr,nullptr,cookie);}
bool physicalTime(uint64_t utc){bool synced;uint32_t at;portENTER_CRITICAL(&lock);synced=clockSynced;at=syncAt;portEXIT_CRITICAL(&lock);return synced&&uint32_t(millis()-at)<21600000UL&&utc>=1704067200ULL&&utc<4102444800ULL;}
std::string randomId(){uint8_t bytes[16];esp_fill_random(bytes,sizeof(bytes));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;char id[37];snprintf(id,sizeof(id),"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);return id;}
bool dates(const mbedtls_x509_crt* crt,uint64_t now){unsigned n=0;if(!crt)return false;for(;crt;crt=crt->next){uint64_t from,to;const auto& a=crt->valid_from;const auto& b=crt->valid_to;if(++n>8||!HatchPairing::certificateDateUtc(a.year,a.mon,a.day,a.hour,a.min,a.sec,from)||!HatchPairing::certificateDateUtc(b.year,b.mon,b.day,b.hour,b.min,b.sec,to)||!HatchPairing::certificateWindowValid(now,from,to))return false;}return true;}
// Single task owns DNS/TLS/parser. Numeric connect preserves explicit hostname/SNI.
bool post(const char* path,const std::string& body,const char* device,const char* keyId,const char* apiKey,HatchPairing::NotificationHttpResponse& response){
 if(heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<100*1024||heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<48*1024)return false;
 uint32_t epoch;portENTER_CRITICAL(&lock);if(dnsEpoch==UINT32_MAX){portEXIT_CRITICAL(&lock);return false;}epoch=++dnsEpoch;dnsDone=false;dnsValid=false;portEXIT_CRITICAL(&lock);if(!epoch||tcpip_try_callback(resolve,reinterpret_cast<void*>(uintptr_t(epoch)))!=ERR_OK)return false;
 const uint32_t started=millis();char ip[48]={};
 for(;;){bool done,ok;ip_addr_t copy;portENTER_CRITICAL(&lock);done=dnsDone;ok=dnsValid;if(done&&ok)copy=address;portEXIT_CRITICAL(&lock);if(done){if(!ok||!ipaddr_ntoa_r(&copy,ip,sizeof(ip)))return false;break;}if(uint32_t(millis()-started)>=2000)return false;vTaskDelay(pdMS_TO_TICKS(10));}
 esp_tls_t* tls=esp_tls_init();if(!tls)return false;esp_tls_cfg_t cfg={};cfg.non_block=true;cfg.timeout_ms=20;cfg.common_name=Host;cfg.skip_common_name=false;cfg.crt_bundle_attach=esp_crt_bundle_attach;
 bool good=false;const uint32_t connectAt=millis();
 while(uint32_t(millis()-connectAt)<6000&&WiFi.status()==WL_CONNECTED){
  if(tls->conn_state==ESP_TLS_CONNECTING&&tls->sockfd>=0){FD_ZERO(&tls->rset);FD_ZERO(&tls->wset);FD_SET(tls->sockfd,&tls->rset);FD_SET(tls->sockfd,&tls->wset);}
  int rc=esp_tls_conn_new_async(ip,strlen(ip),443,&cfg,tls);if(rc==1){good=mbedtls_ssl_get_verify_result(&tls->ssl)==0&&dates(mbedtls_ssl_get_peer_cert(&tls->ssl),time(nullptr));break;}if(rc<0)break;vTaskDelay(pdMS_TO_TICKS(10));
 }
 if(!good){esp_tls_conn_destroy(tls);return false;}
 char header[640];int count=apiKey?snprintf(header,sizeof(header),"POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\nX-HatchAI-Device: %s\r\nX-HatchAI-Key-Id: %s\r\nX-HatchAI-Api-Key: %s\r\nAccept-Encoding: identity\r\nConnection: close\r\nContent-Length: %u\r\n\r\n",path,Host,device,keyId,apiKey,unsigned(body.size())):snprintf(header,sizeof(header),"POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\nContent-Length: %u\r\n\r\n",path,Host,unsigned(body.size()));
 if(count<0||unsigned(count)>=sizeof(header)){esp_tls_conn_destroy(tls);return false;}
 const std::string wire=std::string(header,count)+body;size_t sent=0;HatchPairing::NotificationHttpStreamParser parser;parser.reset(time(nullptr));char input[256];good=false;
 while(uint32_t(millis()-started)<12000&&WiFi.status()==WL_CONNECTED){
  if(sent<wire.size()){int rc=esp_tls_conn_write(tls,wire.data()+sent,wire.size()-sent);if(rc>0)sent+=rc;else if(rc!=MBEDTLS_ERR_SSL_WANT_READ&&rc!=MBEDTLS_ERR_SSL_WANT_WRITE)break;}
  else {int rc=esp_tls_conn_read(tls,input,sizeof(input));if(rc>0){const auto state=parser.feed(input,rc);if(state==HatchPairing::HttpStreamState::Failed)break;if(state==HatchPairing::HttpStreamState::Complete){good=parser.result(response);break;}}else if(rc==0||rc==MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY){good=parser.end()==HatchPairing::HttpStreamState::Complete&&parser.result(response);break;}else if(rc!=MBEDTLS_ERR_SSL_WANT_READ&&rc!=MBEDTLS_ERR_SSL_WANT_WRITE)break;}
  vTaskDelay(pdMS_TO_TICKS(10));
 }
 HatchPairing::erase(input,sizeof(input));esp_tls_conn_destroy(tls);return good;
}
}
void CloudSync::begin(){
 CloudApiCredential credential;if(CloudApiCredentialStore::load(credential)){memcpy(key_,credential.key,32);strlcpy(keyId_,credential.keyId,sizeof(keyId_));configured_=true;}HatchPairing::erase(&credential,sizeof(credential));
 queue_=xQueueCreate(8,sizeof(CloudSyncSample));enrollmentQueue_=xQueueCreate(1,sizeof(EnrollmentRequest));if(!queue_||!enrollmentQueue_){if(queue_)vQueueDelete(queue_);if(enrollmentQueue_)vQueueDelete(enrollmentQueue_);queue_=enrollmentQueue_=nullptr;HatchPairing::erase(key_,sizeof(key_));configured_=false;return;}
 sntp_set_time_sync_notification_cb(synchronized);if(sntp_get_sync_status()==SNTP_SYNC_STATUS_COMPLETED)synchronized(nullptr);
 TaskHandle_t handle=nullptr;if(xTaskCreatePinnedToCore(task,"hatchai-sync",12288,this,1,&handle,0)!=pdPASS){vQueueDelete(queue_);vQueueDelete(enrollmentQueue_);queue_=enrollmentQueue_=nullptr;HatchPairing::erase(key_,sizeof(key_));configured_=false;}
}
bool CloudSync::submit(const CloudSyncSample& sample){if(!queue_||!configured_)return false;if(!physicalTime(sample.capturedAt)||xQueueSend(queue_,&sample,0)!=pdTRUE){++dropped_;return false;}return true;}
bool CloudSync::requestEnrollment(const String& token){if(!enrollmentQueue_||configured_||token.length()!=43)return false;for(size_t i=0;i<token.length();++i)if(!isalnum(unsigned(token[i]))&&token[i]!='_'&&token[i]!='-')return false;EnrollmentRequest request{};memcpy(request.token,token.c_str(),43);return xQueueSend(enrollmentQueue_,&request,0)==pdTRUE;}
String CloudSync::statusJson()const{return String("{\"configured\":")+(ready()?"true":"false")+",\"enrollmentPending\":"+String(enrollmentQueue_&&uxQueueMessagesWaiting(enrollmentQueue_)?"true":"false")+",\"queued\":"+String(queue_?uxQueueMessagesWaiting(queue_):0)+",\"accepted\":"+String(accepted_.load())+",\"dropped\":"+String(dropped_.load())+",\"failed\":"+String(failed_.load())+",\"rejected\":"+String(rejected_.load())+",\"state\":"+String(state_.load())+"}";}
void CloudSync::task(void* argument){static_cast<CloudSync*>(argument)->run();}
void CloudSync::run(){
 HatchPairing::Credentials credentials;credentials.deviceId=HatchPairing::ControllerId;credentials.keyId=keyId_;credentials.keyLength=configured_?32:0;if(configured_)memcpy(credentials.key,key_,32);HatchPairing::erase(key_,sizeof(key_));
 HatchPairing::NotificationUtcClock clock;CloudSyncSample sample;EnrollmentRequest enrollment{};std::string event;HatchSync::Recovery recovery,cameraRecovery;bool cameraPaused=false;uint32_t seenSync=UINT32_MAX;
 for(;;){
  if(!configured_&&xQueueReceive(enrollmentQueue_,&enrollment,0)==pdTRUE){
   if(WiFi.status()!=WL_CONNECTED||!physicalTime(time(nullptr))){xQueueOverwrite(enrollmentQueue_,&enrollment);state_=1;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
   CloudApiCredential staged;if(!CloudApiCredentialStore::loadPending(staged)){strlcpy(staged.deviceId,HatchPairing::ControllerId,sizeof(staged.deviceId));strlcpy(staged.keyId,"controller-sync-v1",sizeof(staged.keyId));esp_fill_random(staged.key,sizeof(staged.key));if(!CloudApiCredentialStore::stage(staged.deviceId,staged.keyId,staged.key)){HatchPairing::erase(&staged,sizeof(staged));++failed_;state_=6;continue;}}
   const std::string apiKey=HatchPairing::base64url(staged.key,sizeof(staged.key));
   StaticJsonDocument<320> doc;doc["deviceId"]=HatchPairing::ControllerId;doc["keyId"]=staged.keyId;doc["setupToken"]=enrollment.token;doc["apiKey"]=apiKey.c_str();std::string body;serializeJson(doc,body);
   HatchPairing::NotificationHttpResponse response;const bool received=post("/device/enroll",body,nullptr,nullptr,nullptr,response);bool accepted=false;if(received&&response.status==200){StaticJsonDocument<192> ack;if(!deserializeJson(ack,response.body.data(),response.length))accepted=ack["accepted"]==true&&String(ack["deviceId"].as<const char*>())==HatchPairing::ControllerId;}
   if(accepted&&CloudApiCredentialStore::activate(staged)){credentials.keyId=staged.keyId;credentials.keyLength=32;memcpy(credentials.key,staged.key,32);strlcpy(keyId_,staged.keyId,sizeof(keyId_));configured_=true;state_=3;}else{++failed_;state_=6;}
   HatchPairing::erase(&staged,sizeof(staged));HatchPairing::erase(enrollment.token,sizeof(enrollment.token));body.clear();continue;
  }
  if(!configured_){state_=0;vTaskDelay(pdMS_TO_TICKS(500));continue;}

  const uint64_t utc=time(nullptr);if(WiFi.status()!=WL_CONNECTED||!physicalTime(utc)){state_=1;vTaskDelay(pdMS_TO_TICKS(1000));continue;}uint32_t currentSync;portENTER_CRITICAL(&lock);currentSync=syncAt;portEXIT_CRITICAL(&lock);if(currentSync!=seenSync){clock.synchronize(utc,millis());seenSync=currentSync;}if(!clock.valid(utc,millis())){state_=1;vTaskDelay(pdMS_TO_TICKS(1000));continue;}
  HatchCameraEvent::Event cameraEvent;
  if(cameraEvents_&&!cameraPaused&&!cameraRecovery.waiting(millis())&&cameraEvents_->peek(cameraEvent)){
   uint8_t cameraNonce[24];esp_fill_random(cameraNonce,sizeof(cameraNonce));StaticJsonDocument<1024> doc;
   doc["deviceId"]=HatchPairing::ControllerId;doc["keyId"]=keyId_;doc["issuedAt"]=uint32_t(utc);doc["nonce"]=HatchPairing::base64url(cameraNonce,sizeof(cameraNonce));
   auto eventDoc=doc.createNestedObject("event");eventDoc["cameraId"]=HatchCameraEvent::Ids[cameraEvent.camera];eventDoc["eventId"]=cameraEvent.id;eventDoc["incarnation"]=cameraEvent.incarnation;eventDoc["sequence"]=cameraEvent.sequence;
   if(cameraEvent.detectedAt)eventDoc["detectedAt"]=cameraEvent.detectedAt;else eventDoc["detectedAt"]=nullptr;
   if(cameraEvent.receivedAt)eventDoc["receivedAt"]=cameraEvent.receivedAt;else eventDoc["receivedAt"]=nullptr;
   eventDoc["timeSource"]=cameraEvent.timeSource==1?"camera-utc":cameraEvent.timeSource==2?"controller-rtc":"unknown";eventDoc["confidence"]=cameraEvent.confidence;eventDoc["confirmed"]=true;
   std::string body;serializeJson(doc,body);const std::string key=HatchPairing::base64url(credentials.key,credentials.keyLength);HatchPairing::NotificationHttpResponse response;
   const bool received=post("/device/controller-camera-events",body,HatchPairing::ControllerId,keyId_,key.c_str(),response);bool ack=false;
   if(received&&response.status==200){StaticJsonDocument<192> answer;if(!deserializeJson(answer,response.body.data(),response.length))ack=answer["accepted"]==true&&answer["eventId"].is<const char*>()&&!strcmp(answer["eventId"],cameraEvent.id);}
   if(received&&response.status==409){cameraEvents_->finish(cameraEvent.id,false);cameraRecovery.reset();}
   else {const auto action=cameraRecovery.complete(received,response.status,ack,response.retryAfterMs,esp_random(),millis());
    if(action==HatchSync::Action::Acknowledge)cameraEvents_->finish(cameraEvent.id,true);
    else if(action==HatchSync::Action::Discard)cameraEvents_->finish(cameraEvent.id,false);
    else if(action==HatchSync::Action::Pause)cameraPaused=true;
   }
   vTaskDelay(pdMS_TO_TICKS(10));
  }
  if(recovery.waiting(millis())){state_=4;vTaskDelay(pdMS_TO_TICKS(250));continue;}
  if(xQueuePeek(queue_,&sample,pdMS_TO_TICKS(250))!=pdTRUE)continue;if(sample.capturedAt+604800ULL<utc){xQueueReceive(queue_,&sample,0);++dropped_;event.clear();recovery.reset();continue;}if(event.empty())event=randomId();state_=2;
  uint8_t nonce[24];esp_fill_random(nonce,sizeof(nonce));HatchPairing::TelemetryFrame frame;
  frame.capturedAt=sample.capturedAt;frame.valid=sample.valid;frame.temperatureCenti=sample.temperatureCenti;frame.humidityCenti=sample.humidityCenti;frame.sensorAgeMs=sample.sensorAgeMs;
  frame.heater=sample.heater;frame.lower=sample.lower;frame.upper=sample.upper;frame.automatic=sample.automatic;frame.upperCamera=sample.upperCamera;frame.lowerCamera=sample.lowerCamera;frame.upperChick=sample.upperChick;frame.lowerChick=sample.lowerChick;
  HatchPairing::SignedRequest request;if(!HatchPairing::signTelemetry(credentials,frame,event,uint32_t(utc),HatchPairing::base64url(nonce,sizeof(nonce)),request)){vTaskDelay(pdMS_TO_TICKS(5000));continue;}
  StaticJsonDocument<768> apiDoc;if(deserializeJson(apiDoc,request.body)){request.clear();++rejected_;vTaskDelay(pdMS_TO_TICKS(5000));continue;}apiDoc.remove("signature");std::string apiBody;serializeJson(apiDoc,apiBody);const std::string apiKey=HatchPairing::base64url(credentials.key,credentials.keyLength);
  HatchPairing::NotificationHttpResponse response;const bool received=post("/device/telemetry",apiBody,HatchPairing::ControllerId,keyId_,apiKey.c_str(),response);request.clear();apiBody.clear();bool acknowledged=false;
  if(received&&response.status==200){StaticJsonDocument<256> ack;if(!deserializeJson(ack,response.body.data(),response.length))acknowledged=ack["accepted"]==true&&ack["eventId"].is<const char*>()&&event==ack["eventId"].as<const char*>();}
  if(!received||response.status>=500)++failed_;
  if(received&&(response.status==400||response.status==401||response.status==403||response.status==413))++rejected_;
  const auto action=recovery.complete(received,response.status,acknowledged,response.retryAfterMs,esp_random(),millis());
  if(action==HatchSync::Action::Acknowledge){xQueueReceive(queue_,&sample,0);++accepted_;state_=3;event.clear();}
  else if(action==HatchSync::Action::Discard){xQueueReceive(queue_,&sample,0);++dropped_;event.clear();}
  else if(action==HatchSync::Action::Pause){state_=5;while(true)vTaskDelay(pdMS_TO_TICKS(60000));}

 }
}
