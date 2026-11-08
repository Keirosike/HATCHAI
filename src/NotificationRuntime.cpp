#include "NotificationRuntime.h"
#include "LcdStatusDisplay.h"
#include <Preferences.h>
#include <WiFi.h>
#include <esp_sntp.h>
#include <esp_system.h>
#include <esp_heap_caps.h>
#include <time.h>
#include <cstring>
namespace HatchPairing {
namespace {
portMUX_TYPE syncLock=portMUX_INITIALIZER_UNLOCKED;
uint32_t syncSequence=0;
void synchronized(struct timeval*){portENTER_CRITICAL(&syncLock);++syncSequence;portEXIT_CRITICAL(&syncLock);}
bool loadCredentials(Credentials& out){
  erase(out.key,sizeof(out.key));out.keyLength=0;out.deviceId.clear();out.keyId.clear();
  Preferences prefs;if(!prefs.begin("hatchai-pair",true))return false;
  const uint8_t active=prefs.getUChar("active",255);const bool enabled=prefs.getUChar("enabled",0)==1;
  const uint32_t generation=prefs.getUInt("generation",0);const char* slot=active==0?"slot0":"slot1";
  CredentialRecord record;const size_t length=active<=1?prefs.getBytesLength(slot):0;
  bool read=length>0&&length<=record.bytes.size();
  if(read){record.length=length;read=prefs.getBytes(slot,record.bytes.data(),length)==length;}
  prefs.end();return read&&selectedCredential(active,enabled,generation,record.bytes.data(),record.length,out);
}
}
NotificationRuntime::NotificationRuntime():owner_(https_,clock_,mailbox_,identity_),client_(owner_,nonce_,clock_){}
bool NotificationRuntime::HardwareNonce::fill(uint8_t* bytes,size_t length){esp_fill_random(bytes,length);return true;}
void NotificationRuntime::begin(){
  if(task_)return;
  if(xTaskCreatePinnedToCore(entry,"hatchai-push",16384,this,1,&task_,0)!=pdPASS)task_=nullptr;
}
void NotificationRuntime::entry(void* self){static_cast<NotificationRuntime*>(self)->run();}
void NotificationRuntime::run(){
  https_.attach(owner_);owner_.claimOwner();Credentials credentials;
  const bool loaded=loadCredentials(credentials);if(loaded)client_.configure(credentials);
  erase(credentials.key,sizeof(credentials.key));credentials.keyLength=0;
  portENTER_CRITICAL(&lock_);credentials_=loaded;taskReady_=true;portEXIT_CRITICAL(&lock_);
  sntp_set_time_sync_notification_cb(synchronized);
  uint32_t observed=0;
  // Only accept the pre-existing system UTC if SNTP explicitly reports completion.
  if(sntp_get_sync_status()==SNTP_SYNC_STATUS_COMPLETED){const uint64_t utc=time(nullptr);clock_.synchronize(utc,millis());}
  for(;;){
    const uint32_t now=millis();const uint64_t utc=time(nullptr);uint32_t sequence;
    portENTER_CRITICAL(&syncLock);sequence=syncSequence;portEXIT_CRITICAL(&syncLock);
    if(sequence!=observed){observed=sequence;clock_.synchronize(utc,now);}
    const bool timeReady=clock_.valid(utc,now);
    bool start,cancel;
    portENTER_CRITICAL(&lock_);start=start_;cancel=cancel_;start_=cancel_=false;portEXIT_CRITICAL(&lock_);
    owner_.ownerStep(now,utc);
    if(cancel)client_.cancel(now,utc);
    else if(start&&loaded&&timeReady&&WiFi.status()==WL_CONNECTED)client_.start(now,utc);
    client_.tick(now,utc);owner_.ownerStep(now,utc);https_.update(millis(),uint64_t(time(nullptr)));
    NotificationCompletionEnvelope completion;
    if(owner_.take(completion)){
      portENTER_CRITICAL(&lock_);lastOutcome_=completion.outcome;portEXIT_CRITICAL(&lock_);
      TransportResult result;result.outcome=completion.outcome;result.httpStatus=completion.status;result.body=completion.body.data();
      result.length=completion.length;result.retryAfterMs=completion.retryAfterMs;
      client_.complete(completion.generation,completion.ticket,result,millis(),uint64_t(time(nullptr)),esp_random());
      erase(completion.body.data(),completion.body.size());
    }
    publish(millis(),timeReady);vTaskDelay(pdMS_TO_TICKS(10));
  }
}
void NotificationRuntime::publish(uint32_t now,bool timeReady){
  const PublicStatus status=client_.status();
  const bool connected=WiFi.status()==WL_CONNECTED;
  const uint32_t minimum=heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);
  const uint32_t largest=heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT);
  const uint32_t stack=uxTaskGetStackHighWaterMark(nullptr)*sizeof(StackType_t);
  portENTER_CRITICAL(&lock_);public_=status;timeReady_=timeReady;network_=connected;published_=now;
  minimumHeap_=minimum;largestHeap_=largest;stackRemaining_=stack;
  erase(lcdCode_,sizeof(lcdCode_));
  if(status.state==State::CodeVisible&&!cancel_)std::memcpy(lcdCode_,client_.code_,sizeof(lcdCode_));
  portEXIT_CRITICAL(&lock_);
}
bool NotificationRuntime::requestStart(){
  const uint32_t now=millis();portENTER_CRITICAL(&lock_);
  const bool allowed=taskReady_&&credentials_&&timeReady_&&network_&&!public_.busy&&!start_&&!cancel_&&
    (!lastStart_||uint32_t(now-lastStart_)>=10000)&&uint32_t(now-published_)<2000;
  if(allowed){start_=true;lastStart_=now;}portEXIT_CRITICAL(&lock_);return allowed;
}
void NotificationRuntime::requestCancel(){portENTER_CRITICAL(&lock_);cancel_=true;start_=false;erase(lcdCode_,sizeof(lcdCode_));portEXIT_CRITICAL(&lock_);}
String NotificationRuntime::statusJson(){
  PublicStatus status;bool credentials,timeReady,network,ready;uint32_t age,minimum,largest,stack;TransportOutcome outcome;
  portENTER_CRITICAL(&lock_);status=public_;status.busy=status.busy||start_||cancel_;credentials=credentials_;timeReady=timeReady_;network=network_;ready=taskReady_;age=millis()-published_;
  minimum=minimumHeap_;largest=largestHeap_;stack=stackRemaining_;outcome=lastOutcome_;portEXIT_CRITICAL(&lock_);
  const char* states[]={"Unavailable","Idle","Requesting","CodeVisible","Redeemed","Registered","Cancelling","Cancelled","Expired","Error"};
  return String("{\"state\":\"")+states[unsigned(status.state)]+"\",\"busy\":"+(status.busy?"true":"false")+
    ",\"credentialsReady\":"+(credentials?"true":"false")+",\"utcReady\":"+(timeReady?"true":"false")+
    ",\"networkReady\":"+(network?"true":"false")+",\"taskReady\":"+(ready?"true":"false")+",\"stale\":"+(age>=2000?"true":"false")+
    ",\"transportOutcome\":"+String(unsigned(outcome))+",\"minimumInternalHeap\":"+String(minimum)+",\"largestInternalBlock\":"+String(largest)+",\"networkStackRemaining\":"+String(stack)+"}";
}
void NotificationRuntime::updatePhysicalDisplay(LcdStatusDisplay& display){
  char code[17]={};portENTER_CRITICAL(&lock_);
  if(displayPairingCode(public_.state==State::CodeVisible,millis(),published_,cancel_))std::memcpy(code,lcdCode_,sizeof(code));
  portEXIT_CRITICAL(&lock_);display.setNotificationPairingCode(code);erase(code,sizeof(code));
}
}
