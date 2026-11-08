#pragma once
#include "NotificationPairingProtocol.h"
#include "NotificationTransportResult.h"
#include "NotificationUtcClock.h"

namespace HatchPairing {
enum class State { Unavailable, Idle, Requesting, CodeVisible, Redeemed, Registered, Cancelling, Cancelled, Expired, Error };
enum class Error { None, Credentials, Input, Transport, Timeout, Protocol, Remote, Exhausted };
enum class Operation { ChallengeStart, Start, ChallengeStatus, Status, ChallengeCancel, Cancel };
struct PublicStatus { State state; Error error; bool busy; bool codeAvailable; };
struct Outbound { uint64_t generation; uint64_t ticket; Operation operation; SignedRequest request; };
class Transport {
public:
  virtual ~Transport() {}
  // Must enqueue/copy promptly. No network implementation is included here.
  virtual bool submit(const Outbound& request) = 0;
  virtual void abort(uint64_t ticket) = 0;
};
class NonceSource {
public:
  virtual ~NonceSource() {}
  virtual bool fill(uint8_t* bytes, size_t length) = 0;
};
class NotificationPairingClient {
public:
  NotificationPairingClient(Transport& transport, NonceSource& nonces,NotificationUtcClock& clock);
#ifdef HATCHAI_PAIRING_TEST
  // Original protocol/state fixtures only. No ungated constructor in firmware.
  NotificationPairingClient(Transport& transport, NonceSource& nonces);
#endif
  ~NotificationPairingClient();
  NotificationPairingClient(const NotificationPairingClient&) = delete;
  NotificationPairingClient& operator=(const NotificationPairingClient&) = delete;
  bool configure(const Credentials& credentials);
  bool start(uint32_t nowMs, uint64_t utcSeconds);
  bool cancel(uint32_t nowMs, uint64_t utcSeconds);
  bool requestStatus(uint32_t nowMs, uint64_t utcSeconds);
  void tick(uint32_t nowMs, uint64_t utcSeconds);
  bool complete(uint64_t generation, uint64_t ticket, int httpStatus,
                const char* response, size_t length, uint32_t nowMs, uint64_t utcSeconds);
  bool complete(uint64_t generation,uint64_t ticket,const TransportResult& result,
                uint32_t nowMs,uint64_t utcSeconds,uint32_t jitter=0);
  PublicStatus status() const;
  std::string publicStatusJson() const;
private:
  friend class NotificationRuntime; // Physical-display bridge only; never an HTTP status field.
#ifdef HATCHAI_PAIRING_TEST
  friend struct PairingTestAccess;
#endif
  Transport& transport_;
  NonceSource& nonces_;
  NotificationUtcClock* clock_;
  Credentials credentials_;
  State state_ = State::Unavailable;
  Error error_ = Error::Credentials;
  uint64_t generation_ = 0, ticket_ = 0;
  bool pending_ = false, remoteTarget_ = false;
  Operation operation_ = Operation::ChallengeStart;
  uint32_t sentAt_ = 0, issuedAt_ = 0, lastPoll_ = 0;
  std::string session_, challenge_, requestId_, pairingId_;
  char code_[17] = {};
  NotificationRetryScheduler retry_;
  Operation retryOperation_=Operation::ChallengeStart;
  bool advanceGeneration();
  void clearCode();
  void abandon();
  void fail(Error error);
  bool send(Operation operation, const std::string& body, uint32_t nowMs);
  bool askChallenge(Operation operation, uint32_t nowMs, uint64_t utcSeconds);
  bool dispatchOperation(Operation operation, uint32_t nowMs);
  static bool elapsed(uint32_t nowMs, uint32_t since, uint32_t interval);
};
}
