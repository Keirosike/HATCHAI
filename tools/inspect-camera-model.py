"""Inspect the exact camera artifact; optional CPU smoke inference is not target latency."""
import argparse,collections,hashlib,json,time
from pathlib import Path
import numpy as np
import tflite
parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');parser.add_argument('--report',default='dist/camera-tools/model-report.json');args=parser.parse_args()
p=Path('esp32-devcam/model/mobilenetv2_full_int8.tflite');raw=p.read_bytes();contract=json.loads(p.with_name('model-contract.json').read_text())
assert hashlib.sha256(raw).hexdigest()==contract['sha256']
model=tflite.Model.GetRootAsModel(raw,0);assert model.Version()==3 and model.SubgraphsLength()==1
sg=model.Subgraphs(0);names={getattr(tflite.BuiltinOperator,n):n for n in dir(tflite.BuiltinOperator) if n.isupper()}
report={'sha256':contract['sha256'],'model_bytes':len(raw),'schema_version':model.Version(),'operators':dict(collections.Counter(names[model.OperatorCodes(sg.Operators(i).OpcodeIndex()).BuiltinCode()] for i in range(sg.OperatorsLength()))),'tensors':{}}
for name,idx in [('input',sg.Inputs(0)),('output',sg.Outputs(0))]:
 t=sg.Tensors(idx);q=t.Quantization();assert t.Type()==tflite.TensorType.INT8
 shape=[int(x) for x in t.ShapeAsNumpy()];assert shape==contract[name+'_shape']
 scale=float(q.Scale(0));zero=int(q.ZeroPoint(0));assert scale==contract[name+'_scale'] and zero==contract[name+'_zero_point']
 report['tensors'][name]={'shape':shape,'dtype':'int8','scale':scale,'zero_point':zero}
assert set(report['operators'])=={'MUL','ADD','CONV_2D','DEPTHWISE_CONV_2D','MEAN','FULLY_CONNECTED','LOGISTIC'}
report['float32_tensors']=sum(sg.Tensors(i).Type()==tflite.TensorType.FLOAT32 for i in range(sg.TensorsLength()));assert report['float32_tensors']==0
if args.execute:
 import tensorflow as tf
 interpreter=tf.lite.Interpreter(model_content=raw,num_threads=1);interpreter.allocate_tensors();input=interpreter.get_input_details()[0];output=interpreter.get_output_details()[0]
 rng=np.random.default_rng(7);results=[]
 for kind,image in [('black',np.zeros((1,160,160,3),dtype=np.uint8)),('gray',np.full((1,160,160,3),128,dtype=np.uint8)),('white',np.full((1,160,160,3),255,dtype=np.uint8)),('noise',rng.integers(0,256,(1,160,160,3),dtype=np.uint8))]:
  interpreter.set_tensor(input['index'],(image.astype(np.int16)-128).astype(np.int8));start=time.perf_counter();interpreter.invoke();elapsed=(time.perf_counter()-start)*1000
  quantized=int(interpreter.get_tensor(output['index'])[0,0]);probability=(quantized+128)/256;assert 0<=probability<1
  results.append({'synthetic_image':kind,'output_int8':quantized,'chick_probability':probability,'host_cpu_ms':round(elapsed,3)})
 report['cpu_smoke']=results
report['target_measurements']='ESP32-S3 PSRAM high-water and inference latency require a separately authorized target run; firmware logs them.'
Path(args.report).parent.mkdir(parents=True,exist_ok=True);Path(args.report).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
