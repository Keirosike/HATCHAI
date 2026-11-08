#pragma once
#include "NotificationTransportResult.h"
#include <array>
namespace HatchPairing {
constexpr size_t HttpHeaderLimit=2048,HttpBodyLimit=1024;
constexpr size_t HttpChunkLineLimit=64,HttpTrailerLimit=256,HttpMetadataLimit=1024,HttpChunkCountLimit=128;
struct NotificationHttpResponse {
  TransportOutcome outcome=TransportOutcome::MalformedResponse;
  int status=0;uint64_t retryAfterMs=0;size_t length=0;
  std::array<char,HttpBodyLimit+1> body{};
};
enum class HttpStreamState { NeedMore, Complete, Failed };
class NotificationHttpStreamParser {
public:
  NotificationHttpStreamParser(){reset(0);}
  ~NotificationHttpStreamParser();
  NotificationHttpStreamParser(const NotificationHttpStreamParser&)=delete;
  NotificationHttpStreamParser& operator=(const NotificationHttpStreamParser&)=delete;
  void reset(uint64_t validatedUtc);
  HttpStreamState feed(const char* bytes,size_t length);
  HttpStreamState end(); // EOF before complete is always a failure.
  bool result(NotificationHttpResponse& out)const;
private:
  enum class Phase { Headers, Fixed, Size, Data, DataCr, DataLf, Trailers, Complete, Failed };
  Phase phase_=Phase::Headers;
  std::array<char,HttpHeaderLimit> headers_{};
  std::array<char,HttpTrailerLimit> line_{};
  NotificationHttpResponse response_;
  uint64_t utc_=0;
  size_t headerUsed_=0,lineUsed_=0,decoded_=0,remaining_=0,metadata_=0,trailers_=0,chunks_=0,wire_=0;
  HttpStreamState state()const;
  HttpStreamState fail();
  bool headerDone();
  bool metadataLine();
  void complete();
};
static_assert(sizeof(NotificationHttpStreamParser)<=3584,"stream parser memory budget exceeded");
// Compatibility wrapper around streaming feed + EOF.
bool parseNotificationHttp(const char* bytes,size_t length,uint64_t validatedUtc,NotificationHttpResponse& out);
}
