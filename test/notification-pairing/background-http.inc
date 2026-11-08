struct MockBackgroundIo:NotificationMockIo {
  std::vector<NotificationRequestEnvelope> started;
  std::vector<uint64_t> cancelled;bool accepts=true;
  bool start(const NotificationRequestEnvelope& r)override{started.push_back(r);return accepts;}
  void cancel(uint64_t,uint64_t ticket)override{cancelled.push_back(ticket);}
};
struct BackgroundFixture {
  NotificationUtcClock clock;MockBackgroundIo io;NotificationBackgroundTransport transport;
  uint32_t now=100;uint64_t utc=NotificationUtcClock::MinimumUtc;
  BackgroundFixture():transport(io,clock){CHECK(clock.synchronize(utc,now));transport.sample(now,utc);}
  Outbound request(uint64_t ticket=1,uint64_t generation=1){
    Outbound r;r.generation=generation;r.ticket=ticket;r.operation=Operation::ChallengeStart;
    r.request.method="POST";r.request.path="/device/pairing/challenge";r.request.body="{}";return r;
  }
  void pump(){transport.pump(now,utc);}
};
std::string http(const std::string& body="{}",int status=200,const std::string& extra=""){
  return "HTTP/1.1 "+std::to_string(status)+" Result\r\nContent-Length: "+std::to_string(body.size())+"\r\n"+extra+"\r\n"+body;
}
bool parseHttp(const std::string& raw,NotificationHttpResponse& out,uint64_t utc=NotificationUtcClock::MinimumUtc){
  return parseNotificationHttp(raw.data(),raw.size(),utc,out);
}
void backgroundHttpTests(){
  run("UTC gate rejects unsynchronized invalid and out of range time",[]{
    NotificationUtcClock c;CHECK(!c.valid(NotificationUtcClock::MinimumUtc,0));CHECK(!c.synchronize(0,0));
    CHECK(!c.synchronize(NotificationUtcClock::MaximumUtc,0));CHECK(c.synchronize(NotificationUtcClock::MinimumUtc,0));
    CHECK(c.valid(NotificationUtcClock::MinimumUtc+1,1000));
  });
  run("UTC synchronization freshness expires exactly at its boundary",[]{
    NotificationUtcClock c;const uint64_t u=NotificationUtcClock::MinimumUtc;CHECK(c.synchronize(u,0));
    CHECK(c.valid(u+86399,86399999));CHECK(!c.valid(u+86400,86400000));
    CHECK(c.synchronize(u+86400,86400000));CHECK(c.valid(u+86400,86400000));
  });
  run("UTC gate latches forward backward and local timezone jumps",[]{
    for(int delta:{-6,6,28800}){
      NotificationUtcClock c;const uint64_t u=NotificationUtcClock::MinimumUtc+100;CHECK(c.synchronize(u,0));
      CHECK(!c.valid(u+delta,0));CHECK(!c.valid(u,0));CHECK(!c.synchronize(u,0));
      c.reset();CHECK(c.synchronize(u,0));CHECK(c.valid(u,0));
    }
  });
  run("UTC clock accepts bounded drift and monotonic rollover",[]{
    NotificationUtcClock c;const uint64_t u=NotificationUtcClock::MinimumUtc;CHECK(c.synchronize(u,UINT32_MAX-499));
    CHECK(c.valid(u+1,500));CHECK(c.valid(u+6,500));CHECK(!c.valid(u+7,500));
  });
  run("Clock gating prevents signing and blocks operation signing after a clock jump",[]{
    NotificationUtcClock clock;MockTransport transport;MockNonce nonce;NotificationPairingClient c(transport,nonce,clock);
    CHECK(c.configure(credentials()));const uint64_t utc=NotificationUtcClock::MinimumUtc;
    CHECK(!c.start(100,utc));CHECK(transport.sent.empty());CHECK(clock.synchronize(utc,100));CHECK(c.start(100,utc));
    auto sent=transport.sent.back();DynamicJsonDocument request(1024),response(1024);CHECK(!deserializeJson(request,sent.request.body));
    response["sessionId"]=request["requestId"];response["challenge"]="start:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";response["expiresIn"]=60;
    const std::string body=encoded(response);CHECK(!c.complete(sent.generation,sent.ticket,200,body.data(),body.size(),100,utc+28800));
    CHECK(transport.sent.size()==1);
  });
  run("HTTP parser accepts bounded explicit length and case insensitive headers",[]{
    NotificationHttpResponse out;CHECK(parseHttp("HTTP/1.0 200 OK\r\ncOnTeNt-LeNgTh:\t2 \r\nContent-Encoding: identity\r\n\r\n{}",out));
    CHECK(out.status==200);CHECK(out.outcome==TransportOutcome::Success);CHECK(out.length==2);CHECK(std::string(out.body.data(),out.length)=="{}");
  });
  run("HTTP body accepts exact maximum and rejects oversize mismatch or trailing responses",[]{
    NotificationHttpResponse out;CHECK(parseHttp(http(std::string(1024,'x')),out));CHECK(out.length==1024);
    CHECK(!parseHttp(http(std::string(1025,'x')),out));CHECK(out.length==0);
    CHECK(!parseHttp("HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n{}",out));
    CHECK(!parseHttp(http()+http(),out));CHECK(!parseHttp("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\nx",out));
  });
  run("HTTP header budget accepts exactly 2048 bytes and rejects the next byte",[]{
    NotificationHttpResponse out;const std::string prefix="HTTP/1.1 200 OK\r\nContent-Length: 0\r\nX-Pad: ";
    const std::string raw=prefix+std::string(2048-prefix.size()-4,'x')+"\r\n\r\n";
    CHECK(raw.size()==2048);CHECK(parseHttp(raw,out));CHECK(!parseHttp(prefix+std::string(2049-prefix.size()-4,'x')+"\r\n\r\n",out));
  });
  run("HTTP malformed status lines informational statuses and bare linefeeds fail closed",[]{
    NotificationHttpResponse out;
    for(const std::string status:{"HTTP/2 200 OK","HTTP/1.1 20 OK","HTTP/1.1 600 Bad","HTTP/1.1 099 Bad","HTTP/1.1 200OK","HTTP/1.1 100 Continue","http/1.1 200 OK"})
      CHECK(!parseHttp(status+"\r\nContent-Length: 0\r\n\r\n",out));
    CHECK(!parseHttp("HTTP/1.1 200 OK\nContent-Length: 0\n\n",out));
  });
  run("HTTP header syntax rejects folds controls whitespace names and missing colons",[]{
    NotificationHttpResponse out;
    for(const std::string bad:{" Content-Length: 0","Bad Name: 0","X","X : y",": y","X: a\tb\x01","X: a\nb"})
      CHECK(!parseHttp(http("{}",200,bad+"\r\n"),out));
    std::string raw=http();raw.insert(23,1,'\0');CHECK(!parseHttp(raw,out));
  });
  run("HTTP rejects conflicting duplicate or ambiguous Content Length",[]{
    NotificationHttpResponse out;
    for(const std::string value:{"2","3","2, 2","+2","-2","2x","18446744073709551616"})
      CHECK(!parseHttp(http("{}",200,"Content-Length: "+value+"\r\n"),out));
    CHECK(!parseHttp("HTTP/1.1 200 OK\r\n\r\n{}",out));
    CHECK(!parseHttp("HTTP/1.1 204 No Content\r\nContent-Length: 2\r\n\r\n{}",out));
  });
  run("HTTP rejects conflicting transfer framing and compression",[]{
    NotificationHttpResponse out;
    for(const std::string value:{"chunked","Chunked","gzip, chunked","identity",""})
      CHECK(!parseHttp(http("{}",200,"Transfer-Encoding: "+value+"\r\n"),out));
    CHECK(parseHttp("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n",out));
    CHECK(!parseHttp("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nZ\r\n",out));
    for(const std::string value:{"gzip","br","deflate","identity, gzip"})CHECK(!parseHttp(http("{}",200,"Content-Encoding: "+value+"\r\n"),out));
  });
  run("HTTP Retry After delta bounds reject overflow signs and fractional values",[]{
    NotificationHttpResponse out;CHECK(parseHttp(http("secret",429,"Retry-After: 60\r\n"),out));
    CHECK(out.outcome==TransportOutcome::RateLimited);CHECK(out.retryAfterMs==60000);CHECK(out.length==0);CHECK(out.body[0]==0);
    CHECK(parseHttp(http("",429,"Retry-After: 18446744073709551\r\n"),out));CHECK(out.retryAfterMs==18446744073709551000ULL);
    for(const std::string value:{"18446744073709552","-1","+1","1.5","","60, 120"})CHECK(!parseHttp(http("",429,"Retry-After: "+value+"\r\n"),out));
    CHECK(!parseHttp(http("",429,"Retry-After: 1\r\nRetry-After: 1\r\n"),out));
  });
  run("HTTP Retry After supports strict IMF fixdate with valid UTC only",[]{
    NotificationHttpResponse out;const std::string future="Retry-After: Mon, 01 Jan 2024 00:01:00 GMT\r\n";
    CHECK(parseHttp(http("",429,future),out));CHECK(out.retryAfterMs==60000);CHECK(!parseHttp(http("",429,future),out,0));
    CHECK(parseHttp(http("",429,"Retry-After: Sun, 31 Dec 2023 23:59:00 GMT\r\n"),out));CHECK(out.retryAfterMs==0);
    for(const std::string value:{"Tue, 01 Jan 2024 00:01:00 GMT","Mon, 32 Jan 2024 00:01:00 GMT","Mon, 01 Jan 2024 00:61:00 GMT","Mon, 01 Jan 2024 00:01:00 UTC","Mon, 01 Jan 2024 00:01:60 GMT","Mon, 01 Jan 2100 00:01:00 GMT"})
      CHECK(!parseHttp(http("",429,"Retry-After: "+value+"\r\n"),out));
  });
  run("HTTP auth validation and server errors discard response bodies",[]{
    NotificationHttpResponse out;for(int status:{400,401,403,429,500,503}){
      CHECK(parseHttp(http("SECRET_CODE",status),out));CHECK(out.outcome==httpTransportResult(status,nullptr,0).outcome);
      CHECK(out.length==0);for(char c:out.body)CHECK(c==0);
    }
    CHECK(parseHttp(http("SECRET_CODE"),out));CHECK(!parseHttp("broken",out));CHECK(out.length==0);for(char c:out.body)CHECK(c==0);
  });
  run("HTTP parser rejects every truncation and clears previous private data",[]{
    const std::string raw=http("PRIVATE_CODE",200,"X-Test: value\r\n");NotificationHttpResponse out;
    for(size_t n=0;n<raw.size();++n){CHECK(parseHttp(raw,out));CHECK(!parseNotificationHttp(raw.data(),n,NotificationUtcClock::MinimumUtc,out));
      CHECK(out.length==0);for(char c:out.body)CHECK(c==0);}
  });
  run("Coordinator allows one active one pending and rejects overflow and duplicates",[]{
    BackgroundFixture f;auto first=f.request();CHECK(f.transport.submit(first));CHECK(!f.transport.submit(first));
    f.pump();CHECK(f.io.started.size()==1);CHECK(f.transport.submit(f.request(2)));CHECK(!f.transport.submit(f.request(3)));
    const std::string raw=http();CHECK(f.transport.receive(1,1,raw.data(),raw.size(),f.now,f.utc));
    f.pump();CHECK(f.io.started.size()==1);NotificationCompletionEnvelope out;CHECK(f.transport.take(out));CHECK(out.ticket==1);CHECK(out.generation==1);
    CHECK(out.outcome==TransportOutcome::Success);f.pump();CHECK(f.io.started.size()==2);CHECK(f.io.started.back().ticket==2);
  });
  run("Coordinator cancellation bypasses a full request queue and rejects stale responses",[]{
    BackgroundFixture f;CHECK(f.transport.submit(f.request()));f.pump();CHECK(f.transport.submit(f.request(2)));
    f.transport.abort(1);CHECK(f.io.cancelled.size()==1);const std::string raw=http();CHECK(!f.transport.receive(1,1,raw.data(),raw.size(),f.now,f.utc));
    f.pump();CHECK(f.io.started.back().ticket==2);f.transport.abort(2);CHECK(!f.transport.failure(1,2,TransportOutcome::DnsFailure,f.now,f.utc));
  });
  run("Coordinator fences generations and erases cancelled queued completions",[]{
    BackgroundFixture f;CHECK(f.transport.submit(f.request()));f.pump();const std::string raw=http("SECRET");
    CHECK(f.transport.receive(1,1,raw.data(),raw.size(),f.now,f.utc));f.transport.invalidateBefore(2);
    NotificationCompletionEnvelope out;CHECK(!f.transport.take(out));CHECK(out.body[0]==0);CHECK(!f.transport.submit(f.request(2,1)));
    CHECK(f.transport.submit(f.request(2,2)));f.pump();CHECK(!f.transport.receive(1,1,raw.data(),raw.size(),f.now,f.utc));
  });
  run("Coordinator rejects invalid UTC oversized requests and method or path changes",[]{
    BackgroundFixture f;Outbound r=f.request();r.request.body.assign(2049,'x');CHECK(!f.transport.submit(r));
    r=f.request();r.request.path="/chick-detected";CHECK(!f.transport.submit(r));r=f.request();r.request.method="GET";CHECK(!f.transport.submit(r));
    f.clock.reset();CHECK(!f.transport.submit(f.request()));CHECK(f.io.started.empty());
  });
  run("Coordinator rechecks UTC before mock dispatch without blocking",[]{
    BackgroundFixture f;CHECK(f.transport.submit(f.request()));f.transport.pump(f.now,f.utc+28800);CHECK(f.io.started.empty());
    NotificationCompletionEnvelope out;CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::ValidationFailure);
  });
  run("Idle coordinator still observes and latches UTC jumps",[]{
    BackgroundFixture f;f.transport.pump(f.now,f.utc+28800);CHECK(!f.clock.valid(f.utc,f.now));
    CHECK(!f.transport.submit(f.request()));CHECK(f.io.started.empty());
  });
  run("Coordinator accepts exactly 2048 request bytes and clears pending cancellation",[]{
    BackgroundFixture f;Outbound r=f.request();r.request.body.assign(2048,'x');CHECK(f.transport.submit(r));
    f.transport.abort(1);f.pump();CHECK(f.io.started.empty());CHECK(!f.transport.submit(r));
    CHECK(f.transport.submit(f.request(2)));f.pump();CHECK(f.io.started.size()==1);
  });
  run("Coordinator deadlines include queue wait and reject exact boundary completions",[]{
    BackgroundFixture f;CHECK(f.transport.submit(f.request()));f.pump();CHECK(f.transport.submit(f.request(2)));
    const std::string raw=http();CHECK(!f.transport.receive(1,1,raw.data(),raw.size(),f.now+12000,f.utc+12));
    NotificationCompletionEnvelope out;CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::OperationTimeout);
    f.now+=12000;f.utc+=12;f.pump();CHECK(f.transport.take(out));CHECK(out.ticket==2);CHECK(out.outcome==TransportOutcome::OperationTimeout);CHECK(f.io.started.size()==1);
  });
  run("Coordinator timeout rollover and explicit expiry reject stale failure callbacks",[]{
    BackgroundFixture f;f.clock.reset();f.now=UINT32_MAX-500;CHECK(f.clock.synchronize(f.utc,f.now));f.transport.sample(f.now,f.utc);
    CHECK(f.transport.submit(f.request()));f.pump();f.transport.pump(uint32_t(f.now+12000),f.utc+12);
    NotificationCompletionEnvelope out;CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::OperationTimeout);
    CHECK(!f.transport.failure(1,1,TransportOutcome::DnsFailure,uint32_t(f.now+12001),f.utc+12));
  });
  run("Coordinator bounded parser maps 429 and 5xx and never retains their bodies",[]{
    BackgroundFixture f;NotificationCompletionEnvelope out;
    CHECK(f.transport.submit(f.request()));f.pump();std::string raw=http("SECRET",429,"Retry-After: 60\r\n");
    CHECK(f.transport.receive(1,1,raw.data(),raw.size(),f.now,f.utc));CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::RateLimited);
    CHECK(out.retryAfterMs==60000);CHECK(out.length==0);CHECK(out.body[0]==0);
    CHECK(f.transport.submit(f.request(2)));f.pump();raw=http("SECRET",503);CHECK(f.transport.receive(1,2,raw.data(),raw.size(),f.now,f.utc));
    CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::ServerFailure);CHECK(out.length==0);
  });
  run("Coordinator mock failures malformed responses and failed start callbacks are sanitized",[]{
    BackgroundFixture f;f.io.accepts=false;CHECK(f.transport.submit(f.request()));f.pump();NotificationCompletionEnvelope out;
    CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::NetworkUnavailable);f.io.accepts=true;
    CHECK(f.transport.submit(f.request(2)));f.pump();CHECK(f.transport.failure(1,2,TransportOutcome::TlsVerificationFailure,f.now,f.utc));
    CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::TlsVerificationFailure);CHECK(out.length==0);
    CHECK(f.transport.submit(f.request(3)));f.pump();CHECK(!f.transport.receive(1,3,"SECRET malformed",16,f.now,f.utc));
    CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::MalformedResponse);CHECK(out.body[0]==0);
  });
  run("Client coordinator integration honors cooldown cancellation and generation fences",[]{
    BackgroundFixture f;MockNonce nonce;NotificationPairingClient client(f.transport,nonce,f.clock);CHECK(client.configure(credentials()));
    CHECK(client.start(f.now,f.utc));f.pump();const auto first=f.io.started.back();
    const std::string raw=http("SECRET",429,"Retry-After: 10\r\n");CHECK(f.transport.receive(first.generation,first.ticket,raw.data(),raw.size(),f.now,f.utc));
    NotificationCompletionEnvelope completion;CHECK(f.transport.take(completion));
    TransportResult result;result.outcome=completion.outcome;result.httpStatus=completion.status;result.retryAfterMs=completion.retryAfterMs;
    CHECK(!client.complete(completion.generation,completion.ticket,result,f.now,f.utc));CHECK(client.cancel(f.now,f.utc));
    CHECK(client.publicStatusJson().find("SECRET")==std::string::npos);CHECK(client.status().state==State::Cancelled);
    client.tick(f.now+9999,f.utc+9);f.transport.pump(f.now+9999,f.utc+9);CHECK(f.io.started.size()==1);
    client.tick(f.now+10000,f.utc+10);f.transport.pump(f.now+10000,f.utc+10);CHECK(f.io.started.size()==1);
    CHECK(!f.transport.receive(first.generation,first.ticket,raw.data(),raw.size(),f.now+10000,f.utc+10));
  });
}
