#pragma once
#include <Arduino.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
struct CloudSyncSample {uint32_t capturedAt;int16_t temperatureCenti;uint16_t humidityCenti,sensorAgeMs;bool valid,heater,lower,upper,automatic;int8_t upperCamera=-1,lowerCamera=-1;bool upperChick=false,lowerChick=false;};
static_assert(sizeof(CloudSyncSample)<=24,"Bounded queue payload");
class CameraEventStore;
class CloudSync {
public:void attachCameraEvents(CameraEventStore* events){cameraEvents_=events;}void begin();bool submit(const CloudSyncSample& sample);bool requestEnrollment(const String& setupToken);bool ready()const{return configured_.load();}String statusJson()const;
private:CameraEventStore* cameraEvents_=nullptr;struct EnrollmentRequest{char token[44];};std::atomic<uint32_t> accepted_{0},dropped_{0},failed_{0},rejected_{0},state_{0};std::atomic<bool> configured_{false};QueueHandle_t queue_=nullptr,enrollmentQueue_=nullptr;char keyId_[65]={};uint8_t key_[32]={};static void task(void* argument);void run();
};
