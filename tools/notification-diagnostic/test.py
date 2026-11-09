"""Offline tests with public synthetic NVS pages; no serial access."""
import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parent
SOURCE=(ROOT/'main/main.cpp').read_text()
sys.path.insert(0,str(ROOT.parent/'notification-provisioner'))
import provision as p

class Tests(unittest.TestCase):
    def test_no_nvs_initialization_or_commands(self):
        for call in ('nvs_flash_init','nvs_open','nvs_set_','nvs_commit','provision(','Session('):self.assertNotIn(call,SOURCE)
        ast.parse((ROOT/'diagnose.py').read_text())

    def test_native_denials_and_damaged_pages(self):
        wrappers=SOURCE[SOURCE.index('extern "C" esp_err_t __wrap_esp_flash_write('):SOURCE.index('namespace {')]
        helpers=SOURCE[SOURCE.index('uint32_t u32'):SOURCE.index('struct Part')]
        validator=SOURCE[SOURCE.index('bool nvs()'):SOURCE.index('\n}\nextern "C" void app_main')]
        harness='''#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cassert>
#include <cstdio>
using esp_err_t=int;struct esp_flash_t{};
constexpr int ESP_ERR_NOT_ALLOWED=0x106;
uint8_t memory[0x5000];unsigned writes=0;
int esp_flash_read(void*,void* out,unsigned address,unsigned length){if(address<0x9000||address+length>0xe000)return 1;memcpy(out,memory+address-0x9000,length);return 0;}
'''+wrappers+helpers+validator+'''
int main(){
 assert(__wrap_esp_flash_write(nullptr,nullptr,0,16)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_flash_write_encrypted(nullptr,0,nullptr,16)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_flash_erase_region(nullptr,0,4096)==ESP_ERR_NOT_ALLOWED);
 assert(__wrap_esp_flash_erase_chip(nullptr)==ESP_ERR_NOT_ALLOWED);
 memset(memory,255,sizeof(memory));assert(nvs());
 // A freeing/recovery page must be rejected, never repaired.
 memory[0]=0xf8;assert(!nvs());assert(writes==0);
 memset(memory,255,sizeof(memory));memory[100]=0;assert(!nvs());
 memset(memory,255,sizeof(memory));memory[0]=0xfe;memory[8]=0xfe;
 uint32_t checksum=crc(memory+4,24);memcpy(memory+28,&checksum,4);
 assert(nvs());memory[28]^=1;assert(!nvs());assert(writes==0);
 puts("Native diagnostic: 10 assertions passed");}
'''
        build=ROOT/'build/native';build.mkdir(parents=True,exist_ok=True)
        code=build/'test.cpp';code.write_text(harness)
        zig=ROOT.parent.parent/'test/notification-pairing/.tools/ziglang/zig.exe'
        exe=build/'test.exe'
        result=subprocess.run([str(zig),'c++','-std=c++14','-O1',str(code),'-o',str(exe)],capture_output=True,timeout=120)
        self.assertEqual(result.returncode,0,'Native diagnostic compilation failed')
        result=subprocess.run([str(exe)],capture_output=True,timeout=10)
        self.assertEqual(result.returncode,0,'Native diagnostic assertion failed')

    def test_image_and_provisioner_unchanged(self):
        import hashlib
        p.inspect_image(ROOT/'build/hatchai_readonly_diagnostic.bin')
        self.assertEqual(hashlib.sha256((ROOT.parent/'notification-provisioner/build/hatchai_usb_provisioner.bin').read_bytes()).hexdigest(),'a57124281954d69b21ffc15e753d5f68e5000eb3f3b5aa4ff6dfb99c19ff802a')

if __name__=='__main__':unittest.main()
