#include "esp_flash.h"
#include "esp_flash_internal.h"
#include "spi_flash_chip_driver.h"
#include "esp_rom_spiflash.h"
#include "bootloader_flash_config.h"
#include "esp_chip_info.h"
#include "esp_flash_encrypt.h"
#include "esp_secure_boot.h"
#include "esp_mac.h"
#include "esp_rom_uart.h"
#include "esp_rom_md5.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cstdint>
#include <cstdio>
#include <cstring>
extern "C" const spi_flash_chip_t esp_flash_chip_generic;
extern "C" esp_err_t __real_esp_flash_init_main(esp_flash_t*);
static esp_err_t no_mode_write(esp_flash_t*){return ESP_OK;}
extern "C" esp_err_t __wrap_esp_flash_init_main(esp_flash_t* chip){
  // Pinned IDF adaptation: avoid vendor probing/reset and all QE status writes.
  // Single-bit slow reads require no persistent mode change.
  static spi_flash_chip_t readonlyDriver=esp_flash_chip_generic;
  readonlyDriver.set_io_mode=no_mode_write;
  chip->chip_drv=&readonlyDriver;chip->read_mode=SPI_FLASH_SLOWRD;
  return __real_esp_flash_init_main(chip);
}
extern "C" esp_err_t __wrap_esp_flash_write(esp_flash_t*,const void*,uint32_t,uint32_t){return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_flash_write_encrypted(esp_flash_t*,uint32_t,const void*,uint32_t){return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_flash_erase_region(esp_flash_t*,uint32_t,uint32_t){return ESP_ERR_NOT_ALLOWED;}
extern "C" esp_err_t __wrap_esp_flash_erase_chip(esp_flash_t*){return ESP_ERR_NOT_ALLOWED;}
namespace {
void emit(const char* text){while(*text)esp_rom_output_tx_one_char(*text++);esp_rom_output_tx_one_char('\n');}
[[noreturn]] void finish(const char* code){emit(code);for(;;)vTaskDelay(pdMS_TO_TICKS(1000));}
uint32_t u32(const uint8_t* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;}
uint32_t crc(const uint8_t* p,size_t n,uint32_t seed=0xffffffff){uint32_t c=seed^0xffffffff;for(size_t i=0;i<n;++i){c^=p[i];for(int b=0;b<8;++b)c=(c>>1)^(0xedb88320u&uint32_t(-int32_t(c&1)));}return c^0xffffffff;}
bool erased(const uint8_t* p,size_t n){for(size_t i=0;i<n;++i)if(p[i]!=255)return false;return true;}
struct Part {const char* name;uint8_t type,sub;uint32_t start,size;};
constexpr Part parts[]={{"nvs",1,2,0x9000,0x5000},{"otadata",1,0,0xe000,0x2000},{"app0",0,16,0x10000,0x140000},{"app1",0,17,0x150000,0x140000},{"spiffs",1,130,0x290000,0x160000},{"coredump",1,3,0x3f0000,0x10000}};
enum TableCode:uint8_t {TableOk=0,TableRead=1,TableEntry=2,TableTerminator=3,TableMd5=4};
TableCode table(){uint8_t data[0xc00];if(esp_flash_read(nullptr,data,0x8000,sizeof(data)))return TableRead;
 for(unsigned i=0;i<6;++i){const uint8_t* p=data+i*32;const auto& e=parts[i];if(p[0]!=0xaa||p[1]!=0x50||p[2]!=e.type||p[3]!=e.sub||u32(p+4)!=e.start||u32(p+8)!=e.size||memcmp(p+12,e.name,strlen(e.name)+1)||u32(p+28))return TableEntry;}
 if(data[192]!=0xeb||data[193]!=0xeb||!erased(data+194,14)||!erased(data+224,sizeof(data)-224))return TableTerminator;
 md5_context_t ctx;uint8_t sum[16];esp_rom_md5_init(&ctx);esp_rom_md5_update(&ctx,data,192);esp_rom_md5_final(sum,&ctx);return memcmp(sum,data+208,16)?TableMd5:TableOk;}
// Raw validation only: recovery is rejected, never performed. Host independently
// validates logical entries/blob relationships and before/after equality.
enum NvsCode:uint8_t {NvsOk=0,NvsRead=1,NvsPartialErase=2,NvsPageState=3,NvsVersion=4,NvsPageCrc=5,NvsEntryState=6,NvsSpan=7,NvsKey=8,NvsEntryCrc=9,NvsBlobLength=10,NvsBlobState=11,NvsBlobCrc=12,NvsScalarSpan=13,NvsReserve=14};
struct NvsReport{NvsCode code;uint8_t page;uint8_t erasedPages;};
NvsReport nvs(){uint8_t page[4096];uint8_t empty=0;for(uint8_t index=0;index<5;++index){const unsigned address=0x9000+unsigned(index)*4096;
 if(esp_flash_read(nullptr,page,address,sizeof(page)))return {NvsRead,index,empty};
 if(erased(page,32)){if(!erased(page,sizeof(page)))return {NvsPartialErase,index,empty};++empty;char line[80];snprintf(line,sizeof(line),"HDIAG page index=%u code=0 erased=1",index);emit(line);continue;}
 if(u32(page)!=0xfffffffe&&u32(page)!=0xfffffffc)return {NvsPageState,index,empty};
 if(page[8]!=0xfe&&page[8]!=0xff)return {NvsVersion,index,empty};
 if(crc(page+4,24)!=u32(page+28))return {NvsPageCrc,index,empty};
 for(unsigned slot=0;slot<126;){unsigned state=(page[32+slot/4]>>(2*(slot%4)))&3;if(state==1)return {NvsEntryState,index,empty};if(state!=2){++slot;continue;}
  const uint8_t* p=page+64+slot*32;unsigned span=p[2];if(!span||span>126-slot)return {NvsSpan,index,empty};if(!memchr(p+8,0,16))return {NvsKey,index,empty};
  uint8_t header[28];memcpy(header,p,4);memcpy(header+4,p+8,24);if(crc(header,28)!=u32(p+4))return {NvsEntryCrc,index,empty};
  if(p[1]==0x21||p[1]==0x41||p[1]==0x42){unsigned len=p[24]|unsigned(p[25])<<8;if(len>(span-1)*32)return {NvsBlobLength,index,empty};for(unsigned j=1;j<span;++j)if(((page[32+(slot+j)/4]>>(2*((slot+j)%4)))&3)!=2)return {NvsBlobState,index,empty};if(crc(p+32,len)!=u32(p+28))return {NvsBlobCrc,index,empty};}
  else if(span!=1){return {NvsScalarSpan,index,empty};}
  slot+=span;}
 char line[80];snprintf(line,sizeof(line),"HDIAG page index=%u code=0 erased=0",index);emit(line);}
 return {empty>=2?NvsOk:NvsReserve,4,empty};}
}
extern "C" void app_main(){
 esp_chip_info_t info;esp_chip_info(&info);uint8_t mac[6];const uint8_t expected[]={0xb0,0x3f,0xd3,0x5b,0x61,0x34};
 if(info.model!=CHIP_ESP32||esp_read_mac(mac,ESP_MAC_WIFI_STA)||memcmp(mac,expected,6))finish("HDIAG identity_failed");
 if(esp_secure_boot_enabled()||esp_flash_encryption_enabled())finish("HDIAG security_failed");
 uint32_t physical=0,usable=0;esp_err_t rc=esp_flash_init_default_chip();if(rc||!esp_flash_default_chip)finish("HDIAG flash_init_failed");
 if(esp_flash_get_physical_size(nullptr,&physical)){finish("HDIAG flash_query_failed");}
 if(physical!=0x400000){finish("HDIAG flash_mismatch");}
 bootloader_flash_update_size(physical);esp_flash_default_chip->size=physical;
 uint32_t again=0;if(esp_flash_get_physical_size(nullptr,&again)||esp_flash_get_size(nullptr,&usable))finish("HDIAG flash_query_failed");
 char line[128];snprintf(line,sizeof(line),"HDIAG sizes physical=%lu usable=%lu rom=%lu",(unsigned long)again,(unsigned long)usable,(unsigned long)g_rom_flashchip.chip_size);emit(line);
 if(again!=physical||usable!=physical||g_rom_flashchip.chip_size!=physical)finish("HDIAG flash_mismatch");
 const TableCode tableCode=table();char line2[96];snprintf(line2,sizeof(line2),"HDIAG table code=%u",unsigned(tableCode));emit(line2);if(tableCode!=TableOk)finish("HDIAG table_failed");
 const NvsReport report=nvs();snprintf(line2,sizeof(line2),"HDIAG nvs code=%u page=%u erased=%u",unsigned(report.code),unsigned(report.page),unsigned(report.erasedPages));emit(line2);if(report.code!=NvsOk)finish("HDIAG nvs_failed");
 finish("HDIAG pass");
}
