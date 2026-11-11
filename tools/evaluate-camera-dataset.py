"""Evaluate binary whole-image INT8 classifier against explicit YOLO presence labels.
Reads archive as data only; does not extract or execute archive files.
"""
import argparse,os,json,time,hashlib,zipfile
from pathlib import Path
os.environ.setdefault('TF_CPP_MIN_LOG_LEVEL','2')
parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);parser.add_argument('--split',choices=['test','train'],default='test');parser.add_argument('--positive-object-class',type=int,required=True);parser.add_argument('--output',type=Path,default=Path('dist/camera-tools/dataset-report.json'));args=parser.parse_args()
import numpy as np
import tensorflow as tf
model=Path(__file__).resolve().parents[1]/'esp32-devcam/model/mobilenetv2_full_int8.tflite'
interpreter=tf.lite.Interpreter(model_path=str(model),num_threads=1);interpreter.allocate_tensors();inp=interpreter.get_input_details()[0];out=interpreter.get_output_details()[0]
assert inp['shape'].tolist()==[1,160,160,3] and inp['dtype']==np.int8 and inp['quantization']==(1.,-128)
assert out['shape'].tolist()==[1,1] and out['dtype']==np.int8 and out['quantization']==(1/256,-128)
rows=[];counts={'true_positive':0,'true_negative':0,'false_positive':0,'false_negative':0};classes=set()
with zipfile.ZipFile(args.archive) as archive:
 names=set(archive.namelist())
 images=sorted(n for n in names if n.startswith(args.split+'/images/') and Path(n).suffix.lower() in ('.jpg','.jpeg','.png'))
 for index,name in enumerate(images):
  label=name.replace('/images/','/labels/').rsplit('.',1)[0]+'.txt';assert label in names,'Missing label: '+name
  text=archive.read(label).decode('utf-8').strip();objects=[]
  for line in text.splitlines():
   values=line.split();assert len(values)==5 and values[0].isdigit(),'Unsupported annotation format'
   klass=int(values[0]);classes.add(klass);objects.append(klass)
   assert all(0<=float(value)<=1 for value in values[1:]),'Invalid normalized box'
  expected=args.positive_object_class in objects
  rgb=tf.io.decode_image(archive.read(name),channels=3,expand_animations=False).numpy();assert rgb.ndim==3 and rgb.shape[2]==3
  # Same half-pixel bilinear direct resize and round-half-up conversion as MobileNetInput.h.
  height,width,_=rgb.shape;ys=np.maximum((np.arange(160)+.5)*height/160-.5,0);xs=np.maximum((np.arange(160)+.5)*width/160-.5,0)
  y0=ys.astype(int);x0=xs.astype(int);y1=np.minimum(y0+1,height-1);x1=np.minimum(x0+1,width-1);dy=(ys-y0).astype(np.float32)[:,None,None];dx=(xs-x0).astype(np.float32)[None,:,None]
  a=rgb[y0[:,None],x0[None,:]].astype(np.float32)*(1-dx)+rgb[y0[:,None],x1[None,:]].astype(np.float32)*dx
  b=rgb[y1[:,None],x0[None,:]].astype(np.float32)*(1-dx)+rgb[y1[:,None],x1[None,:]].astype(np.float32)*dx
  tensor=np.clip(np.floor(a*(1-dy)+b*dy+.5),0,255).astype(np.int16)-128
  interpreter.set_tensor(inp['index'],tensor.astype(np.int8)[None]);started=time.perf_counter();interpreter.invoke();elapsed=(time.perf_counter()-started)*1000
  score=(int(interpreter.get_tensor(out['index']).flat[0])+128)/256;predicted=score>=.5
  sampled=rgb.reshape(-1,3)[::height*width//4096+1];usable=bool(np.any(sampled.max(0).astype(int)-sampled.min(0).astype(int)>=8))
  key=('true_' if predicted==expected else 'false_')+('positive' if predicted else 'negative');counts[key]+=1
  rows.append({'image':name,'expectedChick':expected,'probability':score,'predictedChick':predicted,'usableFrame':usable,'cpuInferenceMs':elapsed})
  if (index+1)%24==0:print('Evaluated',index+1,'/',len(images),flush=True)
assert classes=={args.positive_object_class},'Unmapped object classes: '+str(classes)
tp,tn,fp,fn=(counts[k] for k in ('true_positive','true_negative','false_positive','false_negative'))
report={'archiveSha256':hashlib.sha256(args.archive.read_bytes()).hexdigest(),'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'split':args.split,'images':len(rows),'positiveObjectClass':args.positive_object_class,'labelInterpretation':'at least one box of specified object class => chick; empty label => no chick','threshold':.5,'counts':counts,'accuracy':(tp+tn)/len(rows),'recall':tp/(tp+fn) if tp+fn else None,'precision':tp/(tp+fp) if tp+fp else None,'specificity':tn/(tn+fp) if tn+fp else None,'falsePositiveRate':fp/(tn+fp) if tn+fp else None,'rows':rows,'limitations':['Archive test split is used as supplied; training provenance and split independence are unverified.','Object-class semantic name is an explicit evaluation assumption, separate from classifier output class IDs.','Single-image CPU results are not target latency, continuous episode accuracy, or field validation.']}
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ('rows','limitations')},indent=2),flush=True)
