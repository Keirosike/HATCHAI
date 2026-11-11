#pragma once
#include "CameraEventStore.h"

#include <Arduino.h>
#include <WebServer.h>
#include "IncubatorController.h"
#include "NetworkManager.h"
#include "ChickBuzzer.h"
#include "CloudSync.h"

class HatchWebServer {
public:
  HatchWebServer(IncubatorController& controller, NetworkManager& network);

  void begin();
  void attachCameraEvents(CameraEventStore* events){_cameraEvents=events;}
  void attachCloudSync(CloudSync* sync){_cloudSync=sync;}
  void handleClient();
  void cameraSnapshot(int8_t& upper,int8_t& lower,bool& upperChick,bool& lowerChick)const {if(_cameraEvents&&_cameraEvents->active()){_cameraEvents->snapshot(upper,lower,upperChick,lowerChick);return;}const auto now=millis();upper=!_cameras[0].known?-1:uint32_t(now-_cameras[0].seen)<20000?1:0;lower=!_cameras[1].known?-1:uint32_t(now-_cameras[1].seen)<20000?1:0;upperChick=upper==1&&_cameras[0].detector&&_cameras[0].chick;lowerChick=lower==1&&_cameras[1].detector&&_cameras[1].chick;}

private:
  CameraEventStore* _cameraEvents=nullptr;
  CloudSync* _cloudSync=nullptr;
  void registerRoutes();
  void handleCameraEvent();
  void handleCameraStatus();
  struct CameraState {String ip;uint32_t seen=0,sequence=0,boot=0;bool known=false,chick=false,detector=false;};
  CameraState _cameras[2];
  String _cameraIp;
  uint32_t _cameraSeenMs=0, _cameraSequence=0;
  bool _cameraSeen=false, _cameraChick=false, _cameraDetectorOk=false;
  uint32_t _cameraBoot=0;
  ChickBuzzer _chickBuzzer;
  void handleApiData();
  void handleApiControl();
  void handleApiTurn();
  void handleApiPredict();
  void handleApiSafety();
  void handleAccountGet();
  void handleAccountSave();
  void handleSessionStart();
  void handleSessionKeepAlive();
  void handleSessionEnd();
  void handleSessionStatus();
  void handleCloudEnrollment();
  void handleWifiScan();
  void handleWifiConnect();
  void handleWifiForget();
  void handleOptions();
  void handleStaticFile();
  void sendJson(const String& payload, int statusCode = 200);
  void sendNotFound();
  void addCorsHeaders();

  String contentTypeFor(const String& path) const;
  bool parseBoolArg(const String& name, bool fallback);
  float parseFloatArg(const String& name, float fallback);
  uint16_t parseMinutesArg(const String& name, uint16_t fallback);
  String bodyArg(const String& name);
  String jsonBodyValue(const String& name);
  bool credentialsValid(const String& username, const String& password);
  String storedUsername();
  String storedPassword();
  bool hasActiveSession() const;
  void refreshSession(const String& token, const String& username);

  WebServer _server;
  IncubatorController& _controller;
  NetworkManager& _network;
  String _sessionToken;
  String _sessionUsername;
  unsigned long _sessionLastSeenMs = 0;
};
