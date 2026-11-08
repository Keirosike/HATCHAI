std::string chunkHttp(const std::string& chunks,int status=200,const std::string& extra=""){
  return "HTTP/1.1 "+std::to_string(status)+" Result\r\nTransfer-Encoding: chunked\r\n"+extra+"\r\n"+chunks;
}
struct HostMailboxGuard:NotificationMailboxGuard {
  unsigned depth=0;void enter()override{CHECK(depth==0);++depth;}void leave()override{CHECK(depth==1);--depth;}
};
struct HostTaskIdentity:NotificationTaskIdentity {uintptr_t id=1;uintptr_t current()const override{return id;}};
struct OwnedMockIo:NotificationMockIo {
  HostMailboxGuard& guard;HostTaskIdentity& identity;
  std::vector<NotificationRequestEnvelope> started;std::vector<uint64_t> cancelled;
  NotificationTaskOwnershipAdapter* adapter=nullptr;bool accepts=true,reenter=false;
  OwnedMockIo(HostMailboxGuard& g,HostTaskIdentity& i):guard(g),identity(i){}
  bool start(const NotificationRequestEnvelope& r)override{
    CHECK(guard.depth==0);CHECK(identity.id==1);started.push_back(r);
    if(reenter){CHECK(adapter);CHECK(!adapter->ownerStep(100,NotificationUtcClock::MinimumUtc));}return accepts;
  }
  void cancel(uint64_t,uint64_t ticket)override{CHECK(guard.depth==0);CHECK(identity.id==1);cancelled.push_back(ticket);}
};
struct OwnershipFixture {
  HostMailboxGuard guard;HostTaskIdentity identity;NotificationUtcClock clock;OwnedMockIo io;
  NotificationTaskOwnershipAdapter adapter;uint32_t now=100;uint64_t utc=NotificationUtcClock::MinimumUtc;
  OwnershipFixture():io(guard,identity),adapter(io,clock,guard,identity){io.adapter=&adapter;CHECK(clock.synchronize(utc,now));CHECK(adapter.claimOwner());CHECK(adapter.ownerStep(now,utc));}
  ~OwnershipFixture(){identity.id=1;adapter.ownerStop();}
  Outbound request(uint64_t ticket=1,uint64_t generation=1){Outbound r;r.ticket=ticket;r.generation=generation;
    r.operation=Operation::ChallengeStart;r.request.method="POST";r.request.path="/device/pairing/challenge";r.request.body="{}";return r;}
  bool step(){return adapter.ownerStep(now,utc);}
  bool response(uint64_t ticket,const std::string& raw,bool eof=true,uint64_t generation=1){return adapter.ownerFeed(generation,ticket,raw.data(),raw.size(),eof,now,utc);}
};
void streamOwnershipTests(){
  run("Streaming Content Length succeeds across every two fragment split",[]{
    const std::string raw=http("{\"code\":\"PRIVATE\"}");
    for(size_t split=0;split<=raw.size();++split){NotificationHttpStreamParser p;p.reset(NotificationUtcClock::MinimumUtc);
      CHECK(p.feed(raw.data(),split)!=HttpStreamState::Failed);CHECK(p.feed(raw.data()+split,raw.size()-split)==HttpStreamState::Complete);
      CHECK(p.end()==HttpStreamState::Complete);NotificationHttpResponse out;CHECK(p.result(out));CHECK(std::string(out.body.data(),out.length)=="{\"code\":\"PRIVATE\"}");}
  });
  run("Streaming chunked framing succeeds bytewise and across every split",[]{
    const std::string raw=chunkHttp("1\r\n{\r\n1\r\n}\r\n0\r\nX-Trace: ok\r\n\r\n");
    for(size_t split=0;split<=raw.size();++split){NotificationHttpStreamParser p;p.reset(NotificationUtcClock::MinimumUtc);
      CHECK(p.feed(raw.data(),split)!=HttpStreamState::Failed);CHECK(p.feed(raw.data()+split,raw.size()-split)==HttpStreamState::Complete);
      NotificationHttpResponse out;CHECK(p.result(out));CHECK(std::string(out.body.data(),out.length)=="{}");}
    NotificationHttpStreamParser p;p.reset(NotificationUtcClock::MinimumUtc);
    for(size_t i=0;i<raw.size();++i)CHECK(p.feed(raw.data()+i,1)!=(HttpStreamState::Failed));CHECK(p.end()==HttpStreamState::Complete);
  });
  run("Streaming strict chunk extensions accept bounded tokens and quoted strings",[]{
    NotificationHttpResponse out;CHECK(parseHttp(chunkHttp("2;name=value;flag;quoted=\"a; b\\\"c\"\r\n{}\r\n0;done\r\n\r\n"),out));CHECK(out.length==2);
    for(const std::string line:{"2;","2;=x","2;name=","2;name=\"unterminated","2;name=x y","2;name=\"x\"junk"})
      CHECK(!parseHttp(chunkHttp(line+"\r\n{}\r\n0\r\n\r\n"),out));
  });
  run("Streaming malformed chunk sizes delimiters and overflows fail closed",[]{
    NotificationHttpResponse out;
    for(const std::string size:{"","Z","+2","-2","0x2","2 "," 2","FFFFFFFFFFFFFFFFFFFFFFFF"})CHECK(!parseHttp(chunkHttp(size+"\r\n{}\r\n0\r\n\r\n"),out));
    for(const std::string chunks:{"2\n{}\r\n0\r\n\r\n","2\rX{}\r\n0\r\n\r\n","2\r\n{}X\n0\r\n\r\n","2\r\n{}\rX0\r\n\r\n"})CHECK(!parseHttp(chunkHttp(chunks),out));
  });
  run("Streaming decoded chunk body limit is exact across chunks",[]{
    NotificationHttpResponse out;const std::string data(1024,'x');CHECK(parseHttp(chunkHttp("400\r\n"+data+"\r\n0\r\n\r\n"),out));CHECK(out.length==1024);
    CHECK(!parseHttp(chunkHttp("401\r\n"+data+"x\r\n0\r\n\r\n"),out));
    CHECK(!parseHttp(chunkHttp("400\r\n"+data+"\r\n1\r\nx\r\n0\r\n\r\n"),out));
  });
  run("Streaming trailer budget is exact and sensitive trailer fields are forbidden",[]{
    NotificationHttpResponse out;CHECK(parseHttp(chunkHttp("0\r\nX-Pad: "+std::string(245,'x')+"\r\n\r\n"),out));
    CHECK(!parseHttp(chunkHttp("0\r\nX-Pad: "+std::string(246,'x')+"\r\n\r\n"),out));
    for(const std::string trailer:{"Content-Length: 0","Transfer-Encoding: chunked","Retry-After: 1","Authorization: x","Content-Encoding: gzip","X Bad: x"," X-Pad: x"})
      CHECK(!parseHttp(chunkHttp("0\r\n"+trailer+"\r\n\r\n"),out));
  });
  run("Streaming chunk line count and total metadata budgets are bounded",[]{
    NotificationHttpResponse out;CHECK(parseHttp(chunkHttp("1;x="+std::string(58,'a')+"\r\nx\r\n0\r\n\r\n"),out));
    CHECK(!parseHttp(chunkHttp("1;x="+std::string(59,'a')+"\r\nx\r\n0\r\n\r\n"),out));
    std::string chunks;for(unsigned i=0;i<128;++i)chunks+="1\r\nx\r\n";CHECK(parseHttp(chunkHttp(chunks+"0\r\n\r\n"),out));
    CHECK(!parseHttp(chunkHttp(chunks+"1\r\nx\r\n0\r\n\r\n"),out));
    chunks.clear();for(unsigned i=0;i<20;++i)chunks+="1;x="+std::string(56,'a')+"\r\nx\r\n";
    CHECK(!parseHttp(chunkHttp(chunks+"0\r\n\r\n"),out));
  });
  run("Streaming ambiguous framing duplicate transfer coding and HTTP10 chunks are rejected",[]{
    NotificationHttpResponse out;
    CHECK(!parseHttp(chunkHttp("0\r\n\r\n",200,"Content-Length: 0\r\n"),out));
    CHECK(!parseHttp(chunkHttp("0\r\n\r\n",200,"Transfer-Encoding: chunked\r\n"),out));
    CHECK(!parseHttp("HTTP/1.0 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",out));
    CHECK(!parseHttp("HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n0\r\n\r\n",out));
  });
  run("Streaming extra bytes in later fragments invalidate and erase prior success",[]{
    for(const std::string raw:{http("SECRET"),chunkHttp("6\r\nSECRET\r\n0\r\n\r\n")}){
      NotificationHttpStreamParser p;p.reset(NotificationUtcClock::MinimumUtc);CHECK(p.feed(raw.data(),raw.size())==HttpStreamState::Complete);
      CHECK(p.feed("X",1)==HttpStreamState::Failed);NotificationHttpResponse out;CHECK(!p.result(out));CHECK(out.length==0);CHECK(out.body[0]==0);
    }
  });
  run("Streaming every premature chunk EOF is rejected with no partial body exposure",[]{
    const std::string raw=chunkHttp("6\r\nSECRET\r\n0\r\nX-Trace: ok\r\n\r\n");
    for(size_t cut=0;cut<raw.size();++cut){NotificationHttpStreamParser p;p.reset(NotificationUtcClock::MinimumUtc);
      CHECK(p.feed(raw.data(),cut)!=HttpStreamState::Complete);CHECK(p.end()==HttpStreamState::Failed);
      NotificationHttpResponse out;CHECK(!p.result(out));CHECK(out.length==0);for(char c:out.body)CHECK(c==0);
    }
  });
  run("Streaming 429 Retry After survives fragments and never retains error bodies",[]{
    const std::string raw=chunkHttp("6\r\nSECRET\r\n0\r\n\r\n",429,"Retry-After: 60\r\n");NotificationHttpStreamParser p;p.reset(NotificationUtcClock::MinimumUtc);
    for(size_t i=0;i<raw.size();++i)CHECK(p.feed(raw.data()+i,1)!=HttpStreamState::Failed);
    NotificationHttpResponse out;CHECK(p.result(out));CHECK(out.outcome==TransportOutcome::RateLimited);CHECK(out.retryAfterMs==60000);CHECK(out.length==0);
    for(char c:out.body)CHECK(c==0);
  });
  run("Coordinator streaming waits for EOF and rejects extra bytes before publishing",[]{
    BackgroundFixture f;CHECK(f.transport.submit(f.request()));f.pump();const std::string raw=chunkHttp("2\r\n{}\r\n0\r\n\r\n");
    CHECK(f.transport.receiveFragment(1,1,raw.data(),raw.size(),false,f.now,f.utc));NotificationCompletionEnvelope out;CHECK(!f.transport.take(out));
    CHECK(!f.transport.receiveFragment(1,1,"X",1,true,f.now,f.utc));CHECK(f.transport.take(out));CHECK(out.outcome==TransportOutcome::MalformedResponse);CHECK(out.length==0);
  });
  run("Ownership adapter rejects duplicate requests and saturated admission",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(!f.adapter.submit(f.request()));CHECK(f.adapter.submit(f.request(2)));
    CHECK(!f.adapter.submit(f.request(3)));CHECK(f.step());CHECK(f.io.started.size()==1);CHECK(f.step());CHECK(f.io.started.size()==1);
  });
  run("Ownership adapter allows only the claimed owner and prevents reentrant I O",[]{
    OwnershipFixture f;f.identity.id=2;CHECK(!f.adapter.claimOwner());CHECK(!f.step());CHECK(!f.response(1,http()));
    CHECK(!f.adapter.ownerFailure(1,1,TransportOutcome::DnsFailure,f.now,f.utc));CHECK(!f.adapter.ownerStop());
    CHECK(f.adapter.submit(f.request()));f.identity.id=1;f.io.reenter=true;CHECK(f.step());CHECK(f.io.started.size()==1);
  });
  run("Ownership cancellation works with full queues and drops stale completions",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(f.step());CHECK(f.adapter.submit(f.request(2)));CHECK(f.step());
    f.identity.id=2;f.adapter.abort(1);f.identity.id=1;CHECK(!f.response(1,http("SECRET")));CHECK(f.step());
    CHECK(f.io.cancelled.size()==1);CHECK(f.io.started.back().ticket==2);CHECK(!f.response(1,http()));
    CHECK(f.response(2,http()));NotificationCompletionEnvelope out;CHECK(f.adapter.take(out));CHECK(out.ticket==2);CHECK(out.generation==1);
  });
  run("Ownership cancellation clears a full completion slot before consumers see it",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(f.step());CHECK(f.response(1,http("SECRET")));
    f.adapter.abort(1);NotificationCompletionEnvelope out;CHECK(!f.adapter.take(out));CHECK(out.body[0]==0);CHECK(f.step());
    CHECK(f.adapter.submit(f.request(2,2)));CHECK(f.step());CHECK(!f.response(1,http("SECRET"),true,1));
  });
  run("Ownership higher generation fences older success and failure callbacks",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(f.step());CHECK(f.adapter.submit(f.request(2,2)));
    CHECK(!f.response(1,http("SECRET")));CHECK(!f.adapter.ownerFailure(1,1,TransportOutcome::DnsFailure,f.now,f.utc));
    CHECK(f.step());CHECK(f.io.cancelled.size()==1);CHECK(f.io.started.back().generation==2);
    CHECK(!f.adapter.submit(f.request(3,1)));CHECK(f.response(2,http(),true,2));
    NotificationCompletionEnvelope out;CHECK(f.adapter.take(out));CHECK(out.generation==2);
  });
  run("Ownership streaming feeds fragments without concurrent mock access",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(f.step());const std::string raw=chunkHttp("2\r\n{}\r\n0\r\n\r\n");
    for(size_t i=0;i<raw.size();++i)CHECK(f.response(1,raw.substr(i,1),false));NotificationCompletionEnvelope out;CHECK(!f.adapter.take(out));
    CHECK(f.response(1,"",true));CHECK(f.adapter.take(out));CHECK(std::string(out.body.data(),out.length)=="{}");CHECK(out.ticket==1);
  });
  run("Ownership completion handoff preserves capacity for the next pending request",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(f.adapter.submit(f.request(2)));CHECK(f.step());CHECK(f.step());
    CHECK(f.response(1,http()));NotificationCompletionEnvelope out;CHECK(f.adapter.take(out));CHECK(out.ticket==1);
    CHECK(f.adapter.submit(f.request(3)));CHECK(f.step());CHECK(f.io.started.back().ticket==2);
    CHECK(f.response(2,http()));CHECK(f.adapter.take(out));CHECK(out.ticket==2);CHECK(out.outcome==TransportOutcome::Success);
    CHECK(f.step());CHECK(f.io.started.back().ticket==3);CHECK(f.response(3,http()));CHECK(f.adapter.take(out));CHECK(out.ticket==3);
    CHECK(out.outcome==TransportOutcome::Success);
  });
  run("Ownership simulated network failures and parser failures stay sanitized",[]{
    OwnershipFixture f;f.io.accepts=false;CHECK(f.adapter.submit(f.request()));CHECK(f.step());NotificationCompletionEnvelope out;
    CHECK(f.adapter.take(out));CHECK(out.outcome==TransportOutcome::NetworkUnavailable);CHECK(out.length==0);f.io.accepts=true;
    CHECK(f.adapter.submit(f.request(2)));CHECK(f.step());CHECK(f.adapter.ownerFailure(1,2,TransportOutcome::TlsVerificationFailure,f.now,f.utc));
    CHECK(f.adapter.take(out));CHECK(out.outcome==TransportOutcome::TlsVerificationFailure);CHECK(out.body[0]==0);
    CHECK(f.adapter.submit(f.request(3)));CHECK(f.step());CHECK(!f.response(3,"SECRET malformed"));CHECK(f.adapter.take(out));CHECK(out.outcome==TransportOutcome::MalformedResponse);
  });
  run("Ownership queue timeouts remain absolute and propagate without retries",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));f.now+=12000;f.utc+=12;CHECK(f.step());
    NotificationCompletionEnvelope out;CHECK(f.adapter.take(out));CHECK(out.outcome==TransportOutcome::OperationTimeout);CHECK(f.io.started.empty());
  });
  run("Ownership stop quiesces active pending and completed work in its owner",[]{
    OwnershipFixture f;CHECK(f.adapter.submit(f.request()));CHECK(f.step());CHECK(f.adapter.submit(f.request(2)));CHECK(f.step());
    CHECK(f.adapter.ownerStop());CHECK(f.io.cancelled.size()==1);CHECK(!f.adapter.submit(f.request(3)));CHECK(!f.step());
    NotificationCompletionEnvelope out;CHECK(!f.adapter.take(out));CHECK(!f.response(1,http()));
  });
  run("Parser and ownership resident memory stay within explicit compile budgets",[]{
    CHECK(sizeof(NotificationHttpStreamParser)<=3584);CHECK(sizeof(NotificationTaskOwnershipAdapter)<=16384);
    std::cout<<"RESOURCE host bytes parser="<<sizeof(NotificationHttpStreamParser)<<" request="<<sizeof(NotificationRequestEnvelope)
      <<" completion="<<sizeof(NotificationCompletionEnvelope)<<" coordinator="<<sizeof(NotificationBackgroundTransport)
      <<" ownership="<<sizeof(NotificationTaskOwnershipAdapter)<<'\n';
  });
}
