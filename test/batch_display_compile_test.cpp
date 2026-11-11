#include "BatchDisplay.h"
using HatchDisplay::predictionMotor;
static_assert(HatchDisplay::missingLabel(false,0,15000)[0]=='L',"Loading only while startup is pending");
static_assert(HatchDisplay::missingLabel(false,15000,15000)[0]=='N',"Timeout ends loading at the boundary");
static_assert(HatchDisplay::missingLabel(true,1,15000)[0]=='N',"Completed recovery with missing metadata is not loading");
static_assert(HatchDisplay::labelSource(true,true,99,true,100)==-2,"Live metadata wins");
static_assert(HatchDisplay::labelSource(false,true,99,true,100)==1,"Newest matching SD metadata wins");
static_assert(HatchDisplay::labelSource(false,false,0,false,0)==-1,"Missing metadata does not invent a label");
static_assert(predictionMotor(false,false,false,0)==-1,"No assignment cannot invent a batch estimate");
static_assert(predictionMotor(true,false,false,0)==0 && predictionMotor(true,false,false,1)==0,"Lower-only estimate never alternates to an empty upper roller");
static_assert(predictionMotor(false,true,false,0)==1 && predictionMotor(false,true,false,1)==1,"Upper-only estimate never alternates to an empty lower roller");
static_assert(predictionMotor(true,true,false,0)==1 && predictionMotor(true,true,false,1)==0 && predictionMotor(true,true,false,2)==1,"Two distinct batches alternate upper and lower estimates");
static_assert(predictionMotor(true,true,true,0)==1 && predictionMotor(true,true,true,1)==1,"Both rollers sharing one batch show only one estimate");
