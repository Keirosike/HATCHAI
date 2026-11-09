#pragma once
#include "provision_core.h"
#include "nvs.h"
#include "esp_partition.h"
namespace HatchUsb {
class NvsStore final:public Store {
public:
  explicit NvsStore(const esp_partition_t* partition):partition_(partition){}
  ~NvsStore(){if(open_)nvs_close(handle_);}
  bool open(bool writable=true);
  bool read(const char* key,Value& value) override;
  bool write(const char* key,Kind kind,const uint8_t* bytes,size_t length) override;
  bool remove(const char* key) override;
  bool reopen() override;
private:const esp_partition_t* partition_;nvs_handle_t handle_=0;bool open_=false;
};
// Stable logical digest of every NVS entry except the six provisioner-owned keys.
enum class DigestResult:uint8_t {Ok,HeapUnavailable,ScanFailed};
DigestResult unrelatedDigest(uint8_t out[32]);
}
