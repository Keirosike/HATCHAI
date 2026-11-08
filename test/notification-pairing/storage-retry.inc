// Included inside the native harness namespace; public deterministic test keys only.
bool transportReply(Fixture& f,TransportOutcome outcome,uint64_t retryAfter=0,uint32_t jitter=0){
  const auto sent=f.transport.sent.back();TransportResult r;r.outcome=outcome;r.httpStatus=0;r.retryAfterMs=retryAfter;
  return f.client.complete(sent.generation,sent.ticket,r,f.now,f.utc,jitter);
}
void storageRetryTests(){
  run("Credential codec roundtrips explicit binary fields and maximum key ID",[]{
    Credentials c=credentials();c.keyId.assign(64,'x');CredentialRecord r;CHECK(encodeCredential(c,7,r));
    CHECK(r.length<=CredentialRecordCapacity);Credentials got;uint32_t g=0;
    CHECK(decodeCredential(r.bytes.data(),r.length,got,g));CHECK(g==7);CHECK(got.deviceId==ControllerId);
    CHECK(got.keyId==c.keyId);CHECK(!std::memcmp(c.key,got.key,32));
  });
  run("Credential encoding rejects wrong identity key sizes and zero generation",[]{
    CredentialRecord r;Credentials c=credentials();c.deviceId="hatchai-inc01-cam01";CHECK(!encodeCredential(c,1,r));
    for(size_t n:{size_t(0),size_t(31),size_t(33)}){c=credentials();c.keyLength=n;CHECK(!encodeCredential(c,1,r));}
    c=credentials();CHECK(!encodeCredential(c,0,r));c.keyId.assign(65,'x');CHECK(!encodeCredential(c,1,r));
  });
  run("Unsupported credential version truncated records and every byte corruption fail closed",[]{
    CredentialRecord r;CHECK(encodeCredential(credentials(),1,r));Credentials out=credentials();uint32_t g=99;
    for(size_t n=0;n<r.length;++n){CHECK(!decodeCredential(r.bytes.data(),n,out,g));CHECK(out.keyLength==0);CHECK(g==0);}
    for(size_t i=0;i<r.length;++i){CredentialRecord bad=r;bad.bytes[i]^=1;CHECK(!decodeCredential(bad.bytes.data(),bad.length,out,g));}
    r.bytes[4]=2;CHECK(!decodeCredential(r.bytes.data(),r.length,out,g));
  });
  run("Missing credentials and invalid selector never scan another slot",[]{
    MockNotificationCredentialStore s;Credentials c=credentials();uint32_t g=0;CHECK(!s.load(c,g));CHECK(c.keyLength==0);
    CHECK(s.rotate(credentials(),1));for(int selector:{-2,-1,2,255}){s.active=selector;CHECK(!s.load(c,g));CHECK(!s.rotate(credentials(),2));}
  });
  run("Successful rotation commits verified inactive record and increasing key version",[]{
    MockNotificationCredentialStore s;CHECK(s.rotate(credentials(),1));Credentials next=credentials();next.keyId="test-key-v2";next.key[0]=42;
    CHECK(s.rotate(next,2));CHECK(s.active==1);Credentials got;uint32_t g=0;CHECK(s.load(got,g));CHECK(g==2);CHECK(got.key[0]==42);
    CHECK(!s.rotate(credentials(),1));CHECK(!s.rotate(next,3));
  });
  run("Interrupted rotation preserves the explicitly selected credential",[]{
    MockNotificationCredentialStore s;CHECK(s.rotate(credentials(),1));s.nextFault=MockNotificationCredentialStore::Fault::InterruptedWrite;
    Credentials next=credentials();next.keyId="test-key-v2";CHECK(!s.rotate(next,2));CHECK(s.active==0);
    Credentials got;uint32_t g=0;CHECK(s.load(got,g));CHECK(g==1);CHECK(got.keyId=="test-key-v1");
  });
  run("Failed readback and failed selector commit cannot activate a new key",[]{
    for(auto fault:{MockNotificationCredentialStore::Fault::FailedReadback,MockNotificationCredentialStore::Fault::SelectorWrite}){
      MockNotificationCredentialStore s;CHECK(s.rotate(credentials(),1));s.nextFault=fault;
      Credentials next=credentials();next.keyId="test-key-v2";CHECK(!s.rotate(next,2));CHECK(s.active==0);
      Credentials got;uint32_t g=0;CHECK(s.load(got,g));CHECK(g==1);
    }
  });
  run("Revoked or corrupt selected slot cannot fall back to the old key",[]{
    MockNotificationCredentialStore s;CHECK(s.rotate(credentials(),1));Credentials next=credentials();next.keyId="test-key-v2";CHECK(s.rotate(next,2));
    s.revokeSelected();Credentials got=credentials();uint32_t g=99;CHECK(!s.load(got,g));CHECK(!got.keyLength);CHECK(g==0);
    MockNotificationCredentialStore t;CHECK(t.rotate(credentials(),1));CHECK(t.rotate(next,2));t.slots[1].bytes[20]^=1;
    CHECK(!t.load(got,g));CHECK(!t.rotate(credentials(),3));
  });
  run("First interrupted write does not become implicit provisioning",[]{
    MockNotificationCredentialStore s;s.nextFault=MockNotificationCredentialStore::Fault::InterruptedWrite;
    CHECK(!s.rotate(credentials(),1));Credentials got;uint32_t g=0;CHECK(!s.load(got,g));CHECK(!s.rotate(credentials(),2));
  });
  run("A selector changed back to a retired slot cannot resurrect its old key",[]{
    MockNotificationCredentialStore s;CHECK(s.rotate(credentials(),1));Credentials next=credentials();next.keyId="test-key-v2";
    CHECK(s.rotate(next,2));s.active=0;Credentials got;uint32_t g=0;CHECK(!s.load(got,g));CHECK(!got.keyLength);
  });
  run("Retry backoff is bounded exponential with injected bounded jitter",[]{
    NotificationRetryScheduler r;
    for(unsigned i=0;i<3;++i){CHECK(r.schedule(TransportOutcome::DnsFailure,100,0,UINT32_MAX));
      const uint32_t base=1000u<<i;CHECK(r.delayMs()>=base);CHECK(r.delayMs()<=base+base/4);
      CHECK(!r.ready(100+r.delayMs()-1));CHECK(r.ready(100+r.delayMs()));r.consume();}
    CHECK(!r.schedule(TransportOutcome::DnsFailure,100,0,0));CHECK(!r.waiting());
  });
  run("HTTP response classification distinguishes auth validation limits and server failures",[]{
    CHECK(httpTransportResult(200,nullptr,0).outcome==TransportOutcome::Success);
    CHECK(httpTransportResult(429,nullptr,0,15000).outcome==TransportOutcome::RateLimited);
    CHECK(httpTransportResult(429,nullptr,0,15000).retryAfterMs==15000);
    for(int status:{401,403})CHECK(httpTransportResult(status,nullptr,0).outcome==TransportOutcome::AuthenticationFailure);
    CHECK(httpTransportResult(400,nullptr,0).outcome==TransportOutcome::ValidationFailure);
    CHECK(httpTransportResult(503,nullptr,0).outcome==TransportOutcome::ServerFailure);
    CHECK(httpTransportResult(302,nullptr,0).outcome==TransportOutcome::MalformedResponse);
  });
  run("Retry After is a lower bound and long delays never shorten into retries",[]{
    NotificationRetryScheduler r;CHECK(r.schedule(TransportOutcome::RateLimited,4,60000,0));CHECK(r.delayMs()==60000);
    CHECK(!r.ready(60003));CHECK(r.ready(60004));r.reset();CHECK(r.schedule(TransportOutcome::RateLimited,0,0x100000100ULL,0));
    CHECK(r.delayMs()==0x100000100ULL);CHECK(!r.ready(0x7fffffff));CHECK(!r.ready(0xffffffff));
    CHECK(!r.ready(0xff));CHECK(r.ready(0x100));
  });
  run("Retry monotonic elapsed deadlines survive rollover",[]{
    NotificationRetryScheduler r;CHECK(r.schedule(TransportOutcome::ServerFailure,UINT32_MAX-500,0,0));
    CHECK(!r.ready(498));CHECK(r.ready(499));
  });
  run("Authentication TLS validation malformed and cancellation outcomes are not retried",[]{
    for(auto o:{TransportOutcome::AuthenticationFailure,TransportOutcome::TlsVerificationFailure,TransportOutcome::ValidationFailure,
      TransportOutcome::MalformedResponse,TransportOutcome::Cancelled,TransportOutcome::Success}){
      NotificationRetryScheduler r;CHECK(!r.schedule(o,0,0,0));CHECK(!r.waiting());
    }
  });
  run("All transient outcomes receive bounded scheduling",[]{
    for(auto o:{TransportOutcome::NetworkUnavailable,TransportOutcome::DnsFailure,TransportOutcome::ConnectionTimeout,
      TransportOutcome::OperationTimeout,TransportOutcome::RateLimited,TransportOutcome::ServerFailure}){
      NotificationRetryScheduler r;CHECK(r.schedule(o,0,0,0));CHECK(r.delayMs()==1000);
    }
  });
  run("Structured success preserves protocol validation",[]{
    Fixture f;CHECK(f.client.start(f.now,f.utc));const auto sent=f.transport.sent.back();
    DynamicJsonDocument body(1024),request(1024);CHECK(!deserializeJson(request,sent.request.body));
    body["sessionId"]=request["requestId"];body["challenge"]="start:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";body["expiresIn"]=60;
    const std::string json=encoded(body);TransportResult r;r.body=json.data();r.length=json.size();
    CHECK(f.client.complete(sent.generation,sent.ticket,r,f.now,f.utc));CHECK(f.transport.sent.back().operation==Operation::Start);
  });
  run("429 cooldown blocks status and ambiguous start retries reconcile only",[]{
    Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(f.challenge());CHECK(!transportReply(f,TransportOutcome::RateLimited,10000));
    const size_t count=f.transport.sent.size();CHECK(!f.client.start(f.now,f.utc));CHECK(!f.client.requestStatus(f.now,f.utc));
    f.client.tick(f.now+9999,f.utc);CHECK(f.transport.sent.size()==count);
    f.now+=10000;f.client.tick(f.now,f.utc);CHECK(f.transport.sent.back().operation==Operation::ChallengeStatus);
    CHECK(f.challenge());CHECK(f.transport.sent.back().operation==Operation::Status);
    for(size_t i=2;i<f.transport.sent.size();++i)CHECK(f.transport.sent[i].operation!=Operation::Start);
  });
  run("Cancellation during cooldown clears code and honors the server delay",[]{
    Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));CHECK(!transportReply(f,TransportOutcome::RateLimited,12000));
    const size_t count=f.transport.sent.size();CHECK(f.client.cancel(f.now,f.utc));CHECK(PairingTestAccess::codeEmpty(f.client));
    CHECK(f.client.status().state==State::Cancelling);f.client.tick(f.now+11999,f.utc);CHECK(f.transport.sent.size()==count);
    f.now+=12000;f.client.tick(f.now,f.utc);CHECK(f.transport.sent.back().operation==Operation::ChallengeCancel);
  });
  run("Expiry wins over a pending cooldown and cannot resurrect a session",[]{
    Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));CHECK(!transportReply(f,TransportOutcome::RateLimited,1000000));
    const size_t count=f.transport.sent.size();f.now+=660000;f.client.tick(f.now,f.utc);CHECK(f.client.status().state==State::Expired);
    CHECK(f.client.status().busy);f.client.tick(f.now+1000001,f.utc);CHECK(f.transport.sent.size()==count);CHECK(!f.client.status().busy);
  });
  run("Cancelling an unissued pairing cannot bypass Retry After or restart automatically",[]{
    Fixture f;CHECK(f.client.start(f.now,f.utc));CHECK(!transportReply(f,TransportOutcome::RateLimited,10000));
    CHECK(f.client.cancel(f.now,f.utc));CHECK(f.client.status().state==State::Cancelled);CHECK(!f.client.start(f.now,f.utc));
    const size_t count=f.transport.sent.size();f.client.tick(f.now+10000,f.utc);CHECK(f.transport.sent.size()==count);
    CHECK(!f.client.status().busy);
  });
  run("Late transport results cannot schedule retries for a new generation",[]{
    Fixture f;CHECK(f.client.start(f.now,f.utc));const auto old=f.transport.sent.back();CHECK(f.client.cancel(f.now,f.utc));
    CHECK(f.client.start(f.now,f.utc));TransportResult r;r.outcome=TransportOutcome::ServerFailure;
    CHECK(!f.client.complete(old.generation,old.ticket,r,f.now,f.utc));const size_t count=f.transport.sent.size();
    f.client.tick(f.now+1001,f.utc);CHECK(f.transport.sent.size()==count);
  });
  run("Structured failures never expose diagnostic bodies or automatically retry auth",[]{
    Fixture f;f.open();CHECK(f.client.requestStatus(f.now,f.utc));auto sent=f.transport.sent.back();
    TransportResult r;r.outcome=TransportOutcome::AuthenticationFailure;r.body="secret-key-or-code";r.length=18;
    CHECK(!f.client.complete(sent.generation,sent.ticket,r,f.now,f.utc));
    CHECK(f.client.publicStatusJson().find("secret")==std::string::npos);const size_t count=f.transport.sent.size();
    f.client.tick(f.now+10000,f.utc);CHECK(f.transport.sent.size()==count);
  });
}
