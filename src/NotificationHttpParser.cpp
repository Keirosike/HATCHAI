#include "NotificationHttpParser.h"
#include "NotificationUtcClock.h"
#include "NotificationPairingProtocol.h"
#include <cstring>
#include <limits.h>
namespace HatchPairing {
namespace {
struct View {const char* p;size_t n;};
char lower(char c){return c>='A'&&c<='Z'?char(c+32):c;}
bool equal(View v,const char* s){if(v.n!=std::strlen(s))return false;for(size_t i=0;i<v.n;++i)if(lower(v.p[i])!=lower(s[i]))return false;return true;}
View trim(View v){while(v.n&&(v.p[0]==' '||v.p[0]=='\t')){++v.p;--v.n;}while(v.n&&(v.p[v.n-1]==' '||v.p[v.n-1]=='\t'))--v.n;return v;}
bool number(View v,uint64_t maximum,uint64_t& out){
  out=0;if(!v.n)return false;
  for(size_t i=0;i<v.n;++i){if(v.p[i]<'0'||v.p[i]>'9')return false;const unsigned d=v.p[i]-'0';if(out>maximum/10||(out==maximum/10&&d>maximum%10))return false;out=out*10+d;}return true;
}
bool token(char c){return c!=0&&((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||std::strchr("!#$%&'*+-.^_`|~",c)!=nullptr);}
bool line(const char* p,size_t n,size_t& at,View& out){
  const size_t start=at;
  for(;at<n&&at+1<HttpHeaderLimit;++at){
    if(p[at]=='\r'&&at+1<n&&p[at+1]=='\n'){out={p+start,at-start};at+=2;return true;}
    if(p[at]=='\r'||p[at]=='\n'||p[at]==0)return false;
  }return false;
}
bool leap(unsigned y){return y%4==0&&(y%100!=0||y%400==0);}
bool date(View v,uint64_t now,uint64_t& delay){
  if(v.n!=29||now<NotificationUtcClock::MinimumUtc||now>=NotificationUtcClock::MaximumUtc||
    v.p[3]!=','||v.p[4]!=' '||v.p[7]!=' '||v.p[11]!=' '||v.p[16]!=' '||v.p[19]!=':'||v.p[22]!=':'||v.p[25]!=' '||
    std::memcmp(v.p+26,"GMT",3))return false;
  uint64_t day,year,hour,minute,second;
  if(!number({v.p+5,2},31,day)||!number({v.p+12,4},2099,year)||year<1970||
    !number({v.p+17,2},23,hour)||!number({v.p+20,2},59,minute)||!number({v.p+23,2},59,second))return false;
  const char* months[]={"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"};
  const char* weekdays[]={"Sun","Mon","Tue","Wed","Thu","Fri","Sat"};
  unsigned month=0;for(unsigned i=0;i<12;++i)if(!std::memcmp(v.p+8,months[i],3))month=i+1;
  if(!month||!day)return false;const unsigned lengths[]={31,28,31,30,31,30,31,31,30,31,30,31};
  if(day>lengths[month-1]+(month==2&&leap(unsigned(year))?1:0))return false;
  uint64_t days=0;for(unsigned y=1970;y<year;++y)days+=leap(y)?366:365;
  for(unsigned m=1;m<month;++m)days+=lengths[m-1]+(m==2&&leap(unsigned(year))?1:0);
  days+=day-1;if(std::memcmp(v.p,weekdays[(days+4)%7],3))return false;
  const uint64_t stamp=days*86400+hour*3600+minute*60+second;
  delay=stamp>now?(stamp-now)*1000:0;return true;
}
}
bool parseHeaders(const char* p,size_t n,uint64_t utc,NotificationHttpResponse& out,bool& chunked,size_t& expected){
  size_t at=0;View v;uint64_t status=0;
  if(!line(p,n,at,v)||v.n<13||(std::memcmp(v.p,"HTTP/1.1 ",9)&&std::memcmp(v.p,"HTTP/1.0 ",9))||
    !number({v.p+9,3},599,status)||status<200||v.p[12]!=' ')return false;
  for(size_t i=13;i<v.n;++i)if(static_cast<unsigned char>(v.p[i])<32||static_cast<unsigned char>(v.p[i])>126)return false;
  bool hasLength=false,hasEncoding=false,hasRetry=false;chunked=false;uint64_t contentLength=0,retry=0;
  for(;;){
    if(!line(p,n,at,v))return false;if(!v.n)break;
    size_t colon=0;while(colon<v.n&&v.p[colon]!=':'){if(!token(v.p[colon]))return false;++colon;}
    if(colon==0||colon==v.n)return false;
    View name={v.p,colon},value=trim({v.p+colon+1,v.n-colon-1});
    for(size_t i=0;i<value.n;++i){const unsigned char c=value.p[i];if((c<32&&c!='\t')||c>126)return false;}
    if(equal(name,"content-length")){
      if(hasLength||!number(value,HttpBodyLimit,contentLength))return false;hasLength=true;
    }else if(equal(name,"transfer-encoding")){
      if(chunked||!equal(value,"chunked")||std::memcmp(p,"HTTP/1.1",8))return false;chunked=true;
    }
    else if(equal(name,"content-encoding")){
      if(hasEncoding||!equal(value,"identity"))return false;hasEncoding=true;
    }else if(equal(name,"retry-after")){
      if(hasRetry)return false;hasRetry=true;uint64_t seconds=0;
      if(number(value,UINT64_MAX/1000,seconds))retry=seconds*1000;
      else if(!date(value,utc,retry))return false;
    }
  }
  if(at!=n||at>HttpHeaderLimit||hasLength==chunked||((status==204||status==304)&&(contentLength||chunked)))return false;
  out.status=int(status);out.retryAfterMs=retry;
  out.outcome=httpTransportResult(int(status),nullptr,0,retry).outcome;
  expected=size_t(contentLength);
  return true;
}
namespace {
void clearResponse(NotificationHttpResponse& r){erase(r.body.data(),r.body.size());r.status=0;r.length=0;r.retryAfterMs=0;r.outcome=TransportOutcome::MalformedResponse;}
bool field(View v,View& name,View& value){
  size_t colon=0;while(colon<v.n&&v.p[colon]!=':'){if(!token(v.p[colon]))return false;++colon;}
  if(!colon||colon==v.n)return false;name={v.p,colon};value=trim({v.p+colon+1,v.n-colon-1});
  for(size_t i=0;i<value.n;++i){const unsigned char c=value.p[i];if((c<32&&c!='\t')||c>126)return false;}return true;
}
bool extensions(View v){
  size_t at=0;
  while(at<v.n){
    if(v.p[at++]!=';')return false;
    const size_t name=at;while(at<v.n&&token(v.p[at]))++at;if(at==name)return false;
    if(at<v.n&&v.p[at]=='='){
      ++at;if(at==v.n)return false;
      if(v.p[at]=='"'){
        ++at;bool closed=false;
        while(at<v.n){unsigned char c=v.p[at++];if(c=='"'){closed=true;break;}
          if(c=='\\'){if(at==v.n)return false;c=v.p[at++];}
          if(c<32||c>126)return false;
        }if(!closed)return false;
      }else{const size_t start=at;while(at<v.n&&token(v.p[at]))++at;if(at==start)return false;}
    }
  }return true;
}
}
NotificationHttpStreamParser::~NotificationHttpStreamParser(){reset(0);}
void NotificationHttpStreamParser::reset(uint64_t utc){
  erase(headers_.data(),headers_.size());erase(line_.data(),line_.size());clearResponse(response_);
  utc_=utc;phase_=Phase::Headers;headerUsed_=lineUsed_=decoded_=remaining_=metadata_=trailers_=chunks_=wire_=0;
}
HttpStreamState NotificationHttpStreamParser::state()const{
  return phase_==Phase::Complete?HttpStreamState::Complete:phase_==Phase::Failed?HttpStreamState::Failed:HttpStreamState::NeedMore;
}
HttpStreamState NotificationHttpStreamParser::fail(){
  clearResponse(response_);erase(headers_.data(),headers_.size());erase(line_.data(),line_.size());phase_=Phase::Failed;return state();
}
void NotificationHttpStreamParser::complete(){
  response_.length=response_.status==200?decoded_:0;response_.body[response_.length]=0;
  erase(headers_.data(),headers_.size());erase(line_.data(),line_.size());phase_=Phase::Complete;
}
bool NotificationHttpStreamParser::headerDone(){
  bool chunked=false;size_t expected=0;
  if(!parseHeaders(headers_.data(),headerUsed_,utc_,response_,chunked,expected))return false;
  erase(headers_.data(),headers_.size());remaining_=expected;
  phase_=chunked?Phase::Size:Phase::Fixed;if(!chunked&&!remaining_)complete();return true;
}
bool NotificationHttpStreamParser::metadataLine(){
  const View v={line_.data(),lineUsed_-2};
  if(phase_==Phase::Trailers){
    if(!v.n){complete();return true;}
    View name,value;if(!field(v,name,value))return false;
    // Only inert extension trailers are accepted. No framing/auth/routing semantics.
    if(name.n<3||lower(name.p[0])!='x'||name.p[1]!='-')return false;
  }else{
    size_t at=0,n=0;
    while(at<v.n&&v.p[at]!=';'){
      const char c=v.p[at++];unsigned digit;
      if(c>='0'&&c<='9')digit=c-'0';else if(c>='a'&&c<='f')digit=c-'a'+10;else if(c>='A'&&c<='F')digit=c-'A'+10;else return false;
      if(n>(HttpBodyLimit-decoded_)/16||n*16+digit>HttpBodyLimit-decoded_)return false;n=n*16+digit;
    }
    if(!at||v.p[0]==';'||!extensions({v.p+at,v.n-at}))return false;
    if(!n)phase_=Phase::Trailers;
    else{if(++chunks_>HttpChunkCountLimit)return false;remaining_=n;phase_=Phase::Data;}
  }
  lineUsed_=0;erase(line_.data(),line_.size());return true;
}
HttpStreamState NotificationHttpStreamParser::feed(const char* bytes,size_t length){
  if(phase_==Phase::Failed)return state();
  if((!bytes&&length)||length>HttpHeaderLimit+HttpBodyLimit+HttpMetadataLimit-wire_)return fail();
  for(size_t i=0;i<length;++i){
    if(phase_==Phase::Complete)return fail();++wire_;const char c=bytes[i];
    if(phase_==Phase::Headers){
      if(headerUsed_==headers_.size())return fail();headers_[headerUsed_++]=c;
      if(headerUsed_>=4&&!std::memcmp(headers_.data()+headerUsed_-4,"\r\n\r\n",4))if(!headerDone())return fail();
    }else if(phase_==Phase::Fixed||phase_==Phase::Data){
      if(decoded_>=HttpBodyLimit)return fail();if(response_.status==200)response_.body[decoded_]=c;
      ++decoded_;if(--remaining_==0){if(phase_==Phase::Fixed)complete();else phase_=Phase::DataCr;}
    }else{
      if(++metadata_>HttpMetadataLimit)return fail();
      if(phase_==Phase::DataCr){if(c!='\r')return fail();phase_=Phase::DataLf;}
      else if(phase_==Phase::DataLf){if(c!='\n')return fail();phase_=Phase::Size;}
      else{
        if(phase_==Phase::Trailers&&++trailers_>HttpTrailerLimit)return fail();
        const size_t limit=phase_==Phase::Size?HttpChunkLineLimit:line_.size();
        if(lineUsed_==limit||c==0)return fail();
        if(lineUsed_&&line_[lineUsed_-1]=='\r'&&c!='\n')return fail();
        if(c=='\n'&&(!lineUsed_||line_[lineUsed_-1]!='\r'))return fail();
        line_[lineUsed_++]=c;if(c=='\n'&&!metadataLine())return fail();
      }
    }
  }return state();
}
HttpStreamState NotificationHttpStreamParser::end(){return phase_==Phase::Complete?state():fail();}
bool NotificationHttpStreamParser::result(NotificationHttpResponse& out)const{
  clearResponse(out);if(phase_!=Phase::Complete)return false;out=response_;return true;
}
bool parseNotificationHttp(const char* bytes,size_t length,uint64_t utc,NotificationHttpResponse& out){
  NotificationHttpStreamParser parser;parser.reset(utc);clearResponse(out);
  return parser.feed(bytes,length)==HttpStreamState::Complete&&parser.end()==HttpStreamState::Complete&&parser.result(out);
}
}
