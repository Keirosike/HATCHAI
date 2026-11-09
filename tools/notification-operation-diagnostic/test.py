"""Offline operation diagnostic checks. No hardware or credential-file access."""
import ast,hashlib,os,subprocess,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT.parent/'notification-provisioner'))
import provision as p
SOURCE=(ROOT/'main/main.cpp').read_text()
class Tests(unittest.TestCase):
 def test_no_authorization_or_writable_namespace(self):
  self.assertNotIn('NVS_READWRITE',SOURCE.replace('// No NVS_READWRITE, core provision(), journal operation or credential packet.',''))
  self.assertNotIn('writeGate.authorize',SOURCE)
  self.assertIn('part.readonly=true',SOURCE)
  self.assertIn('nvs_open_from_partition("nvs","hatchai-pair",NVS_READONLY',SOURCE)
  self.assertIn('pdMS_TO_TICKS(15000)',SOURCE)
  ast.parse((ROOT/'diagnose.py').read_text())
 def test_denied_data_and_recovery_writes(self):
  wrappers=SOURCE[SOURCE.index('extern "C" esp_err_t __wrap_esp_flash_write('):SOURCE.index('namespace {')]
  code='''#include <atomic>
#include <cstdint>
#include <cstddef>
#include <cassert>
using esp_err_t=int;struct esp_flash_t{};struct esp_partition_t{};
constexpr int ESP_ERR_NOT_ALLOWED=0x106;std::atomic<unsigned> denied{0};
'''+wrappers+'''
int main(){
 assert(__wrap_esp_flash_write(nullptr,nullptr,0x9000,32)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_flash_write_encrypted(nullptr,0x9000,nullptr,32)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_flash_erase_region(nullptr,0x9000,4096)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_flash_erase_chip(nullptr)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_partition_write(nullptr,0,nullptr,32)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_partition_write_raw(nullptr,0,nullptr,32)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_partition_erase_range(nullptr,0,4096)==ESP_ERR_NOT_ALLOWED);
 assert(denied==7);}
'''
  build=ROOT/'build/native';build.mkdir(parents=True,exist_ok=True)
  file=build/'denials.cpp';file.write_text(code)
  zig=ROOT.parent.parent/'test/notification-pairing/.tools/ziglang/zig.exe';exe=build/'denials.exe'
  env=dict(os.environ);env['ZIG_GLOBAL_CACHE_DIR']=str(ROOT.parent.parent/'test/notification-pairing/.build/zig-cache')
  r=subprocess.run([str(zig),'c++','-std=c++14','-O1',str(file),'-o',str(exe)],env=env,capture_output=True,timeout=120)
  self.assertEqual(r.returncode,0,'Offline compiler failed')
  r=subprocess.run([str(exe)],capture_output=True,timeout=10);self.assertEqual(r.returncode,0)
 def test_image_integrity_and_unchanged_production(self):
  p.inspect_image(ROOT/'build/hatchai_operation_diagnostic.bin')
  self.assertEqual(hashlib.sha256((ROOT.parent/'notification-provisioner/build/hatchai_usb_provisioner.bin').read_bytes()).hexdigest(),'a905f9dbc7dc2638c511dc2663f9087a3e361c545b91c0a0213790575a7bf872')
if __name__=='__main__':unittest.main()
