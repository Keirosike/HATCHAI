#include "NotificationPairingClient.h"
#include "NotificationCredentialStore.h"
#include "NotificationBackgroundTransport.h"
#include "NotificationTaskOwnership.h"
#include "NotificationIntegrationPolicy.h"
#include <ArduinoJson.h>
#include <functional>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <vector>
#include <cstring>

using namespace HatchPairing;
namespace HatchPairing {
struct PairingTestAccess {
  static bool codeEmpty(const NotificationPairingClient& c) {for(char v:c.code_)if(v)return false;return true;}
  static void exhaust(NotificationPairingClient& c){c.generation_=UINT64_MAX;}
  static bool noCredentials(const NotificationPairingClient& c){if(c.credentials_.keyLength||!c.credentials_.deviceId.empty()||!c.credentials_.keyId.empty())return false;for(uint8_t v:c.credentials_.key)if(v)return false;return true;}
};
}
namespace {
#define CHECK(x) do{if(!(x))throw std::runtime_error(std::string("check failed at line ")+std::to_string(__LINE__));}while(0)
Credentials credentials(){Credentials c;c.deviceId=ControllerId;c.keyId="test-key-v1";c.keyLength=32;for(unsigned i=0;i<32;i++)c.key[i]=uint8_t(i);return c;}
std::string encoded(const JsonDocument& doc){std::string out;serializeJson(doc,out);return out;}
struct MockNonce:NonceSource {
  unsigned sequence=1;bool enabled=true;
  bool fill(uint8_t* bytes,size_t length)override{if(!enabled)return false;for(size_t i=0;i<length;i++)bytes[i]=uint8_t(sequence+i);sequence+=37;return true;}
};
struct MockTransport:Transport {
  std::vector<Outbound> sent;std::vector<uint64_t> aborted;bool accept=true;
  bool submit(const Outbound& request)override{if(!accept)return false;sent.push_back(request);return true;}
  void abort(uint64_t ticket)override{aborted.push_back(ticket);}
};
struct Fixture {
  MockTransport transport;MockNonce nonce;NotificationPairingClient client;
  uint32_t now=1000;uint64_t utc=1794096000;std::string pair;
  Fixture():client(transport,nonce){CHECK(client.configure(credentials()));}
  bool reply(const std::string& response,int status=200){
    CHECK(!transport.sent.empty());const Outbound r=transport.sent.back();
    return client.complete(r.generation,r.ticket,status,response.data(),response.size(),now,utc);
  }
  bool challenge(){
    const Outbound request=transport.sent.back();DynamicJsonDocument sent(2048);CHECK(!deserializeJson(sent,request.request.body));
    DynamicJsonDocument response(1024);response["sessionId"]=sent["requestId"];
    response["challenge"]=std::string(sent["operation"].as<const char*>())+":abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    response["expiresIn"]=60;return reply(encoded(response));
  }
  bool code(const std::string& value="ABCDEFGHIJKLMNOP"){
    DynamicJsonDocument sent(2048);CHECK(!deserializeJson(sent,transport.sent.back().request.body));pair=sent["sessionId"].as<const char*>();
    DynamicJsonDocument response(1024);response["pairingId"]=pair;response["code"]=value;response["expiresIn"]=300;
    return reply(encoded(response));
  }
  void open(){CHECK(client.start(now,utc));CHECK(challenge());CHECK(code());CHECK(client.status().state==State::CodeVisible);}
  bool remote(const char* state){DynamicJsonDocument doc(512);doc["pairingId"]=pair;doc["state"]=state;return reply(encoded(doc));}
  void status(const char* state){CHECK(client.requestStatus(now,utc));CHECK(challenge());CHECK(remote(state));}
};
int failures=0,passed=0;
void run(const char* name,const std::function<void()>& test){
  try{test();++passed;std::cout<<"PASS "<<name<<'\n';}
  catch(const std::exception& e){++failures;std::cerr<<"FAIL "<<name<<": "<<e.what()<<'\n';}
}
#include "storage-retry.inc"
#include "background-http.inc"
#include "stream-ownership.inc"
void selfTests(){
  run("Certificate UTC conversion matches Unix dates and Gregorian leap rules",[]{
    uint64_t utc=99;CHECK(certificateDateUtc(1970,1,1,0,0,0,utc));CHECK(utc==0);
    CHECK(certificateDateUtc(2024,1,1,0,0,0,utc));CHECK(utc==1704067200ULL);
    CHECK(certificateDateUtc(2024,2,29,0,0,0,utc));CHECK(utc==1709164800ULL);
    CHECK(!certificateDateUtc(2100,2,29,0,0,0,utc));CHECK(certificateDateUtc(2000,2,29,0,0,0,utc));
  });
  run("Certificate expiry and not yet valid checks enforce inclusive exact boundaries",[]{
    CHECK(certificateWindowValid(100,100,200));CHECK(certificateWindowValid(200,100,200));
    CHECK(!certificateWindowValid(99,100,200));CHECK(!certificateWindowValid(201,100,200));CHECK(!certificateWindowValid(150,200,100));
  });
  run("Invalid certificate calendar fields fail closed",[]{
    uint64_t utc=99;
    CHECK(!certificateDateUtc(1969,12,31,0,0,0,utc));CHECK(utc==0);
    CHECK(!certificateDateUtc(2024,13,1,0,0,0,utc));CHECK(!certificateDateUtc(2024,4,31,0,0,0,utc));
    CHECK(!certificateDateUtc(2024,1,1,24,0,0,utc));CHECK(!certificateDateUtc(2024,1,1,0,60,0,utc));CHECK(!certificateDateUtc(2024,1,1,0,0,60,utc));
  });
  run("Real storage selection validates enabled selector generation and record",[]{
    CredentialRecord record;CHECK(encodeCredential(credentials(),3,record));Credentials out;
    CHECK(selectedCredential(0,true,3,record.bytes.data(),record.length,out));CHECK(out.valid());
    for(unsigned active:{2u,255u}){CHECK(!selectedCredential(active,true,3,record.bytes.data(),record.length,out));CHECK(out.keyLength==0);}
    CHECK(!selectedCredential(0,false,3,record.bytes.data(),record.length,out));CHECK(!out.keyLength);
    CHECK(!selectedCredential(0,true,2,record.bytes.data(),record.length,out));CHECK(!out.keyLength);
    CHECK(!selectedCredential(1,true,3,record.bytes.data(),record.length-1,out));CHECK(!out.keyLength);
  });
  run("Dashboard pairing requires server session matching bounded token and origin",[]{
    CHECK(pairingRouteAllowed(true,36,true,true));CHECK(!pairingRouteAllowed(false,36,true,true));
    CHECK(!pairingRouteAllowed(true,36,false,true));CHECK(!pairingRouteAllowed(true,36,true,false));
    CHECK(!pairingRouteAllowed(true,0,true,true));CHECK(!pairingRouteAllowed(true,97,true,true));
  });
  run("Physical LCD bridge rejects stale background snapshots across rollover",[]{
    CHECK(displayPairingCode(true,1999,0));CHECK(!displayPairingCode(true,2000,0));CHECK(!displayPairingCode(false,1,0));
    CHECK(!displayPairingCode(true,1,0,true));
    CHECK(displayPairingCode(true,500,UINT32_MAX-499));CHECK(!displayPairingCode(true,1500,UINT32_MAX-499));
  });
  storageRetryTests();
  backgroundHttpTests();
  streamOwnershipTests();
  run("Oversized credential input is rejected without retaining credentials",[]{Fixture f;Credentials c=credentials();c.keyId.assign(100000,'x');CHECK(!f.client.configure(c));CHECK(PairingTestAccess::noCredentials(f.client));CHECK(f.client.status().state==State::Unavailable);});
  run("Unavailable until valid injected test credentials",[]{MockTransport t;MockNonce n;NotificationPairingClient c(t,n);CHECK(c.status().state==State::Unavailable);CHECK(!c.start(1,1));CHECK(t.sent.empty());});
  run("Invalid key lengths and controller/key identities fail closed",[]{for(size_t length:{size_t(0),size_t(16),size_t(31),size_t(33),size_t(64)}){Fixture f;Credentials c=credentials();c.keyLength=length;CHECK(!f.client.configure(c));CHECK(!f.client.start(0,1));}Fixture f;Credentials c=credentials();c.deviceId="hatchai-inc01-cam01";CHECK(!f.client.configure(c));c=credentials();c.keyId="invalid/key";CHECK(!f.client.configure(c));});
  run("Idle Requesting CodeVisible Redeemed Registered transitions",[]{Fixture f;CHECK(f.client.status().state==State::Idle);CHECK(f.client.start(f.now,f.utc));CHECK(f.client.status().state==State::Requesting);CHECK(f.challenge());CHECK(f.code());f.status("redeemed");CHECK(f.client.status().state==State::Redeemed);CHECK(PairingTestAccess::codeEmpty(f.client));f.status("registered");CHECK(f.client.status().state==State::Registered);CHECK(!f.client.status().busy);});
  run("Duplicate starts cannot enqueue another active operation",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(!f.client.start(f.now,f.utc));CHECK(f.transport.sent.size()==1);CHECK(f.challenge());CHECK(f.code());CHECK(!f.client.start(f.now,f.utc));CHECK(!f.client.configure(credentials()));});
  run("Cancellation before issuance invalidates late challenge",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));const Outbound old=f.transport.sent.back();CHECK(f.client.cancel(f.now,f.utc));CHECK(f.client.status().state==State::Cancelled);CHECK(!f.client.complete(old.generation,old.ticket,200,"{}",2,f.now,f.utc));CHECK(f.transport.sent.size()==1);});
  run("Cancellation during start cannot redisplay a late code",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(f.challenge());const Outbound old=f.transport.sent.back();CHECK(f.client.cancel(f.now,f.utc));CHECK(f.client.status().state==State::Cancelling);CHECK(!f.client.cancel(f.now,f.utc));CHECK(!f.client.complete(old.generation,old.ticket,200,"{}",2,f.now,f.utc));CHECK(f.challenge());DynamicJsonDocument sent(2048);deserializeJson(sent,f.transport.sent.back().request.body);f.pair=sent["pairingId"].as<const char*>();CHECK(f.remote("cancelled"));CHECK(f.client.status().state==State::Cancelled);CHECK(PairingTestAccess::codeEmpty(f.client));});
  run("Visible code clears immediately on cancellation",[]{Fixture f;f.open();CHECK(!PairingTestAccess::codeEmpty(f.client));CHECK(f.client.cancel(f.now,f.utc));CHECK(PairingTestAccess::codeEmpty(f.client));CHECK(f.challenge());CHECK(f.remote("cancelled"));CHECK(!f.client.status().busy);});
  run("Cancellation losing to registration reports Registered",[]{Fixture f;f.open();CHECK(f.client.cancel(f.now,f.utc));CHECK(f.challenge());CHECK(f.remote("registered"));CHECK(f.client.status().state==State::Registered);});
  run("Unconfirmed cancellation fails closed rather than declaring success",[]{Fixture f;f.open();CHECK(f.client.cancel(f.now,f.utc));CHECK(f.challenge());CHECK(!f.remote("challenge"));CHECK(f.client.status().state==State::Error);CHECK(f.client.status().busy);CHECK(PairingTestAccess::codeEmpty(f.client));});
  run("Generation prevents old operation completing a new attempt",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));const Outbound old=f.transport.sent.back();CHECK(f.client.cancel(f.now,f.utc));CHECK(f.client.start(f.now,f.utc));CHECK(!f.client.complete(old.generation,old.ticket,200,"{}",2,f.now,f.utc));CHECK(f.client.status().state==State::Requesting);});
  run("Duplicate response ticket cannot advance state twice",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));const Outbound old=f.transport.sent.back();CHECK(f.challenge());CHECK(!f.client.complete(old.generation,old.ticket,200,"{}",2,f.now,f.utc));CHECK(f.transport.sent.size()==2);});
  run("Malformed and oversized responses produce generic protocol errors",[]{for(const std::string& body:{std::string("{"),std::string("{} trailing"),std::string("[]"),std::string(1025,'x')}){Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(!f.reply(body));CHECK(f.client.status().state==State::Error);CHECK(f.client.status().error==Error::Protocol);}});
  run("Response session ID and challenge purpose are bound",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(!f.reply("{\"sessionId\":\"abcdefghijklmnopqrstuv\",\"challenge\":\"cancel:abcdefghijklmnopqrstuv\",\"expiresIn\":60}"));CHECK(f.transport.sent.size()==1);});
  run("Unexpected fields, wrong TTL and malformed codes are rejected",[]{for(const std::string& code:{std::string("short"),std::string("ABCDEFGHIJKLMNOPQ"),std::string("abcdef0123456789")}){Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(f.challenge());CHECK(!f.code(code));CHECK(PairingTestAccess::codeEmpty(f.client));}Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(!f.reply("{\"expiresIn\":300}"));});
  run("Response pairing ID must match the pending target",[]{Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));CHECK(f.challenge());CHECK(!f.reply("{\"pairingId\":\"wrong-id-abcdefghijklmnop\",\"state\":\"registered\"}"));CHECK(f.client.status().state==State::Error);});
  run("Transport rejection never blocks or exposes a code",[]{Fixture f;f.transport.accept=false;CHECK(!f.client.start(f.now,f.utc));CHECK(f.client.status().error==Error::Transport);CHECK(PairingTestAccess::codeEmpty(f.client));});
  run("Pending request times out at fifteen seconds",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));f.client.tick(f.now+15000,f.utc);CHECK(f.client.status().error==Error::Timeout);CHECK(!f.transport.aborted.empty());CHECK(!f.reply("{}"));});
  run("A response at the request timeout boundary is rejected",[]{Fixture f;CHECK(f.client.start(f.now,f.utc));f.now+=15000;CHECK(!f.reply("{}"));CHECK(f.client.status().error==Error::Timeout);});
  run("Five minute display expiry is conservative and cannot be extended by status",[]{Fixture f;f.open();f.now+=299999;CHECK(f.client.status().codeAvailable);++f.now;f.client.tick(f.now,f.utc);CHECK(f.client.status().state==State::Expired);CHECK(PairingTestAccess::codeEmpty(f.client));CHECK(f.challenge());CHECK(f.remote("issued"));CHECK(f.client.status().state==State::Expired);});
  run("Maximum uncertain remote lifetime releases the operation",[]{Fixture f;f.open();f.now+=660000;f.client.tick(f.now,f.utc);CHECK(f.client.status().state==State::Expired);CHECK(!f.client.status().busy);CHECK(f.client.start(f.now,f.utc));});
  run("Timers remain valid across millis rollover",[]{Fixture f;f.now=0xffffff00U;f.open();f.now+=300000;f.client.tick(f.now,f.utc);CHECK(PairingTestAccess::codeEmpty(f.client));CHECK(f.client.status().state==State::Expired);});
  run("Automatic status polling is bounded and single-flight",[]{Fixture f;f.open();const size_t n=f.transport.sent.size();f.client.tick(f.now+4999,f.utc);CHECK(f.transport.sent.size()==n);f.client.tick(f.now+5000,f.utc);CHECK(f.transport.sent.size()==n+1);f.client.tick(f.now+5001,f.utc);CHECK(f.transport.sent.size()==n+1);});
  run("Public status never includes codes, keys, protocol bodies or identifiers",[]{Fixture f;f.open();const std::string status=f.client.publicStatusJson();CHECK(status.find("ABCDEFGHIJKLMNOP")==std::string::npos);CHECK(status.find("test-key-v1")==std::string::npos);CHECK(status.find(f.pair)==std::string::npos);CHECK(status.find("signature")==std::string::npos);CHECK(status.find("keyId")==std::string::npos);CHECK(status.find("CodeVisible")!=std::string::npos);});
  run("Remote errors are sanitized and preserve uncertain-target protection",[]{Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));CHECK(!f.reply("sensitive diagnostic must not escape",503));CHECK(f.client.status().busy);CHECK(f.client.publicStatusJson().find("sensitive")==std::string::npos);CHECK(!f.client.start(f.now,f.utc));});
  run("Nonce and UTC validation fail closed",[]{Fixture f;f.nonce.enabled=false;CHECK(!f.client.start(f.now,f.utc));CHECK(f.transport.sent.empty());Fixture g;CHECK(!g.client.start(g.now,0));CHECK(g.transport.sent.empty());});
  run("Generation counter cannot wrap",[]{Fixture f;PairingTestAccess::exhaust(f.client);CHECK(!f.client.start(f.now,f.utc));CHECK(f.client.status().error==Error::Exhausted);CHECK(f.transport.sent.empty());});
  run("Local signature verification rejects changed method/path/payload/signature",[]{Credentials c=credentials();SignedRequest r;const std::string body="{\"deviceId\":\"hatchai-inc01-controller\",\"keyId\":\"test-key-v1\",\"requestId\":\"abcdefghijklmnopqrstuv\"}";CHECK(sign("POST","/device/pairing/challenge",body,c,r));CHECK(verify("POST",r.path,body,c,r.signature));CHECK(!verify("GET",r.path,body,c,r.signature));CHECK(!verify("POST","/device/pairing/start",body,c,r.signature));std::string signature=r.signature;signature[0]=signature[0]=='A'?'B':'A';CHECK(!verify("POST",r.path,body,c,signature));});
  run("Canonical JSON enforces byte depth node and UTF8 bounds",[]{std::string out="old";CHECK(!canonicalJson(std::string(2049,' '),out));CHECK(out.empty());CHECK(!canonicalJson(std::string(10,'[')+"0"+std::string(10,']'),out));std::string wide="[";for(unsigned i=0;i<128;i++){if(i)wide+=",";wide+="null";}wide+="]";CHECK(!canonicalJson(wide,out));CHECK(!canonicalJson(std::string("\"")+char(0xc0)+char(0x80)+"\"",out));CHECK(!canonicalJson("true false",out));});
  run("Base64url omits padding for all remainder lengths",[]{const uint8_t bytes[]={0x66,0x6f,0x6f};CHECK(base64url(bytes,0)=="");CHECK(base64url(bytes,1)=="Zg");CHECK(base64url(bytes,2)=="Zm8");CHECK(base64url(bytes,3)=="Zm9v");const uint8_t other[]={0xff};CHECK(base64url(other,1)=="_w");});
  run("Valid-shaped challenge with wrong TTL or additional fields is rejected",[]{for(bool extra:{false,true}){Fixture f;CHECK(f.client.start(f.now,f.utc));DynamicJsonDocument sent(2048),response(1024);deserializeJson(sent,f.transport.sent.back().request.body);response["sessionId"]=sent["requestId"];response["challenge"]="start:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";response["expiresIn"]=extra?60:59;if(extra)response["code"]="DO-NOT-EXPOSE";CHECK(!f.reply(encoded(response)));CHECK(f.client.status().error==Error::Protocol);CHECK(f.client.publicStatusJson().find("DO-NOT")==std::string::npos);}});
  run("Late status response after display expiry cannot restore a code",[]{Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));const Outbound old=f.transport.sent.back();f.now+=300000;f.client.tick(f.now,f.utc);CHECK(!f.client.complete(old.generation,old.ticket,200,"{}",2,f.now,f.utc));CHECK(PairingTestAccess::codeEmpty(f.client));CHECK(f.client.status().state==State::Expired);});
  run("Uncertain remote failure can be resolved with explicit cancellation",[]{Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));CHECK(!f.reply("failure",503));CHECK(f.client.status().busy);CHECK(f.client.cancel(f.now,f.utc));CHECK(f.challenge());CHECK(f.remote("cancelled"));CHECK(!f.client.status().busy);CHECK(f.client.start(f.now,f.utc));});
  std::cout<<"Native state/protocol checks: "<<passed<<" passed, "<<failures<<" failed\n";
}
void vectors(){
  const std::string input((std::istreambuf_iterator<char>(std::cin)),std::istreambuf_iterator<char>());
  DynamicJsonDocument requests(65536),results(65536);CHECK(!deserializeJson(requests,input));JsonArray out=results.to<JsonArray>();
  for(JsonObject request:requests.as<JsonArray>()){
    JsonObject result=out.createNestedObject();const std::string action=request["action"].as<const char*>();
    const std::string payload=request["payload"].as<const char*>();
    if(action=="canonical") {std::string canonical;const bool ok=canonicalJson(payload,canonical);result["ok"]=ok;if(ok)result["canonical"]=canonical;}
    else {
      Credentials c=credentials();if(request.containsKey("keyLength"))c.keyLength=request["keyLength"].as<size_t>();
      if(request.containsKey("deviceId"))c.deviceId=request["deviceId"].as<const char*>();
      if(request.containsKey("keyId"))c.keyId=request["keyId"].as<const char*>();
      SignedRequest signedRequest;const bool ok=sign(request["method"].as<const char*>(),request["path"].as<const char*>(),payload,c,signedRequest);
      result["ok"]=ok;if(ok){result["canonical"]=signedRequest.canonical;result["payloadHash"]=signedRequest.payloadHash;result["signature"]=signedRequest.signature;result["body"]=signedRequest.body;}
    }
  }
  serializeJson(results,std::cout);std::cout<<'\n';
}
}
int main(int argc,char** argv){try{if(argc>1&&std::string(argv[1])=="--vectors")vectors();else selfTests();return failures?1:0;}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
