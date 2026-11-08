#pragma once
#include "NotificationPairingProtocol.h"
#include <array>

namespace HatchPairing {
// CRC32 detects accidental corruption only: neither encryption nor authentication.
constexpr size_t CredentialRecordCapacity = 160;
struct CredentialRecord {
  std::array<uint8_t,CredentialRecordCapacity> bytes{};
  size_t length=0;
  void clear(){erase(bytes.data(),bytes.size());length=0;}
  ~CredentialRecord(){clear();}
};
bool encodeCredential(const Credentials& credentials,uint32_t generation,CredentialRecord& output);
bool decodeCredential(const uint8_t* bytes,size_t length,Credentials& output,uint32_t& generation);

// Intentionally an in-memory mock, not a Preferences/NVS adapter.
class MockNotificationCredentialStore {
public:
  enum class Fault { None, InterruptedWrite, FailedReadback, SelectorWrite };
  bool load(Credentials& output,uint32_t& generation) const;
  bool rotate(const Credentials& next,uint32_t generation);
  std::array<CredentialRecord,2> slots;
  int active=-1; // -1 means no selector; only 0 and 1 can authorize a load.
  Fault nextFault=Fault::None;
  void revokeSelected();
private:
  bool revoked_[2]={false,false};
};
}
