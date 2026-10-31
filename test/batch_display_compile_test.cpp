#include "BatchDisplay.h"
using HatchDisplay::predictionMotor;
static_assert(predictionMotor(false,false,false,0)==-1,"No assignment cannot invent a batch estimate");
static_assert(predictionMotor(true,false,false,0)==0 && predictionMotor(true,false,false,1)==0,"Lower-only estimate never alternates to an empty upper roller");
static_assert(predictionMotor(false,true,false,0)==1 && predictionMotor(false,true,false,1)==1,"Upper-only estimate never alternates to an empty lower roller");
static_assert(predictionMotor(true,true,false,0)==1 && predictionMotor(true,true,false,1)==0 && predictionMotor(true,true,false,2)==1,"Two distinct batches alternate upper and lower estimates");
static_assert(predictionMotor(true,true,true,0)==1 && predictionMotor(true,true,true,1)==1,"Both rollers sharing one batch show only one estimate");
