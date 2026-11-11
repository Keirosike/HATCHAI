// Executes the actual exported firmware model; no board or cloud access.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'dist/test-output/prediction-model');
fs.mkdirSync(out,{recursive:true});
const source=path.join(out,'main.cpp'),exe=path.join(out,'checks.exe');
fs.writeFileSync(source,`#include "hatchai_random_forest_esp32_final.h"
#include <cassert>
#include <cmath>
#include <cstdio>
int main(){
 Eloquent::ML::Port::RandomForestRegressor model;
 float previous=100;unsigned cases=0;
 for(int day=1;day<=21;day++){
  float baselineInput[4]={37.8f,58,0,float(day)};
  const float baseline=model.predict(baselineInput);
  assert(std::isfinite(baseline)&&baseline>=0&&baseline<=30&&baseline<=previous);
  previous=baseline;
  for(float temperature:{-40.0f,20.0f,37.8f,80.0f})for(float humidity:{0.0f,58.0f,100.0f})for(float turner:{0.0f,1.0f}){
   float input[4]={temperature,humidity,turner,float(day)};
   assert(model.predict(input)==baseline);cases++;
  }
 }
 printf("PASS: %u real model inputs across days 1-21; finite bounded monotonic remaining-time output and current day-only feature behavior. Not a biological accuracy validation.\\n",cases);
}
`);
const zig=process.env.HATCHAI_ZIG||path.join(root,'test/notification-pairing/.tools/ziglang/zig.exe');
cp.execFileSync(zig,['c++','-std=c++14','-O1','-include','initializer_list','-Iinclude',source,'-o',exe],
 {cwd:root,stdio:'pipe',timeout:600000,env:{...process.env,ZIG_GLOBAL_CACHE_DIR:path.join(root,'dist/test-output/cloud-recovery/cache')}});
cp.execFileSync(exe,[],{stdio:'inherit',timeout:10000});
