#include "NotificationHttpsTransport.h"
#include "NotificationIntegrationPolicy.h"
#include <Arduino.h>
#include <WiFi.h>
// Explicit ESP-IDF bundle API: Arduino ships a same-named header for a different API.
extern "C" esp_err_t esp_crt_bundle_attach(void* configuration);
#include <esp_heap_caps.h>
#include <lwip/dns.h>
#include <lwip/tcpip.h>
#include <mbedtls/ssl.h>
#if !defined(MBEDTLS_SSL_KEEP_PEER_CERTIFICATE)
#error "Notification TLS requires retained peer certificates for explicit validity-date checks"
#endif
#include <cstring>
namespace HatchPairing {
namespace {
// Persistent callback storage: late lwIP callbacks never reference a task stack or freed object.
portMUX_TYPE dnsLock=portMUX_INITIALIZER_UNLOCKED;
uint32_t dnsEpoch=0;bool dnsDone=false,dnsOk=false;ip_addr_t dnsAddress;
void dnsFound(const char*,const ip_addr_t* address,void* argument){
  const uint32_t epoch=uint32_t(reinterpret_cast<uintptr_t>(argument));
  portENTER_CRITICAL(&dnsLock);
  if(epoch==dnsEpoch){dnsDone=true;dnsOk=address!=nullptr;if(address)dnsAddress=*address;}
  portEXIT_CRITICAL(&dnsLock);
}
void dnsBegin(void* argument){
  ip_addr_t address;
  const err_t result=dns_gethostbyname(NotificationHttpsTransport::Host,&address,dnsFound,argument);
  if(result==ERR_OK)dnsFound(nullptr,&address,argument);
  else if(result!=ERR_INPROGRESS)dnsFound(nullptr,nullptr,argument);
}
bool certificateDatesValid(const mbedtls_x509_crt* certificate,uint64_t utc){
  if(!certificate)return false;unsigned count=0;
  for(const auto* current=certificate;current;current=current->next){
    if(++count>8)return false;uint64_t from,to;
    const auto& a=current->valid_from;const auto& b=current->valid_to;
    if(!certificateDateUtc(a.year,a.mon,a.day,a.hour,a.min,a.sec,from)||
      !certificateDateUtc(b.year,b.mon,b.day,b.hour,b.min,b.sec,to)||!certificateWindowValid(utc,from,to))return false;
  }return true;
}
}
bool NotificationHttpsTransport::start(const NotificationRequestEnvelope& r){
  if(!owner_||phase_!=Phase::Idle||WiFi.status()!=WL_CONNECTED||
    heap_caps_get_free_size(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<100*1024||
    heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT)<48*1024)return false;
  const int count=snprintf(request_,sizeof(request_),"POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/json\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\nContent-Length: %u\r\n\r\n",r.path.data(),Host,unsigned(r.length));
  if(count<0||size_t(count)+r.length>sizeof(request_))return false;
  std::memcpy(request_+count,r.body.data(),r.length);length_=size_t(count)+r.length;sent_=0;
  generation_=r.generation;ticket_=r.ticket;started_=phaseAt_=millis();
  portENTER_CRITICAL(&dnsLock);
  if(dnsEpoch==UINT32_MAX){portEXIT_CRITICAL(&dnsLock);close();return false;}
  dnsGeneration_=++dnsEpoch;dnsDone=false;dnsOk=false;
  portEXIT_CRITICAL(&dnsLock);phase_=Phase::Dns;
  if(tcpip_try_callback(dnsBegin,reinterpret_cast<void*>(uintptr_t(dnsGeneration_)))!=ERR_OK){close();return false;}
  return true;
}
void NotificationHttpsTransport::close(){
  if(tls_){esp_tls_conn_destroy(tls_);tls_=nullptr;}
  erase(request_,sizeof(request_));erase(read_,sizeof(read_));phase_=Phase::Idle;length_=sent_=0;
}
void NotificationHttpsTransport::cancel(uint64_t generation,uint64_t ticket){if(generation==generation_&&ticket==ticket_)close();}
void NotificationHttpsTransport::fail(TransportOutcome outcome,uint32_t now,uint64_t utc){
  const uint64_t generation=generation_,ticket=ticket_;close();owner_->ownerFailure(generation,ticket,outcome,now,utc);
}
void NotificationHttpsTransport::update(uint32_t now,uint64_t utc){
  if(phase_==Phase::Idle)return;
  if(WiFi.status()!=WL_CONNECTED){fail(TransportOutcome::NetworkUnavailable,now,utc);return;}
  if(uint32_t(now-started_)>=11500){fail(TransportOutcome::OperationTimeout,now,utc);return;}
  if(phase_==Phase::Dns){
    bool done,ok;ip_addr_t address;
    portENTER_CRITICAL(&dnsLock);done=dnsEpoch==dnsGeneration_&&dnsDone;ok=dnsOk;if(done&&ok)address=dnsAddress;portEXIT_CRITICAL(&dnsLock);
    if(!done){if(uint32_t(now-phaseAt_)>=2000)fail(TransportOutcome::DnsFailure,now,utc);return;}
    if(!ok||!ipaddr_ntoa_r(&address,address_,sizeof(address_))){fail(TransportOutcome::DnsFailure,now,utc);return;}
    tls_=esp_tls_init();if(!tls_){fail(TransportOutcome::NetworkUnavailable,now,utc);return;}
    config_=esp_tls_cfg_t{};config_.non_block=true;config_.timeout_ms=20;
    config_.common_name=Host;config_.skip_common_name=false;config_.crt_bundle_attach=esp_crt_bundle_attach;
    phase_=Phase::Tls;phaseAt_=now;
  }
  if(phase_==Phase::Tls){
    const uint32_t elapsed=uint32_t(now-phaseAt_);
    if(elapsed>=6000||(tls_->conn_state==ESP_TLS_CONNECTING&&elapsed>=2000)){fail(TransportOutcome::ConnectionTimeout,now,utc);return;}
    // Numeric address avoids DNS inside ESP-TLS; common_name preserves hostname validation AND SNI.
    if(tls_->conn_state==ESP_TLS_CONNECTING&&tls_->sockfd>=0){
      FD_ZERO(&tls_->rset);FD_ZERO(&tls_->wset);FD_SET(tls_->sockfd,&tls_->rset);FD_SET(tls_->sockfd,&tls_->wset);
    }
    const int result=esp_tls_conn_new_async(address_,std::strlen(address_),443,&config_,tls_);
    if(result<0){fail(TransportOutcome::TlsVerificationFailure,millis(),utc);return;}
    if(result==0)return;
    if(mbedtls_ssl_get_verify_result(&tls_->ssl)!=0||!certificateDatesValid(mbedtls_ssl_get_peer_cert(&tls_->ssl),utc)){
      fail(TransportOutcome::TlsVerificationFailure,millis(),utc);return;
    }
    phase_=Phase::Write;
  }
  if(phase_==Phase::Write){
    const int result=esp_tls_conn_write(tls_,request_+sent_,length_-sent_);
    if(result==MBEDTLS_ERR_SSL_WANT_READ||result==MBEDTLS_ERR_SSL_WANT_WRITE)return;
    if(result<=0){fail(TransportOutcome::NetworkUnavailable,millis(),utc);return;}
    sent_+=size_t(result);if(sent_!=length_)return;
    erase(request_,sizeof(request_));phase_=Phase::Read;
  }
  if(phase_==Phase::Read){
    const int result=esp_tls_conn_read(tls_,read_,sizeof(read_));
    if(result==MBEDTLS_ERR_SSL_WANT_READ||result==MBEDTLS_ERR_SSL_WANT_WRITE)return;
    if(result<0&&result!=MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY){fail(TransportOutcome::NetworkUnavailable,millis(),utc);return;}
    const bool eof=result<=0;
    const bool accepted=owner_->ownerFeed(generation_,ticket_,read_,result>0?size_t(result):0,eof,millis(),utc);
    erase(read_,sizeof(read_));if(!accepted||eof)close();
  }
}
}
