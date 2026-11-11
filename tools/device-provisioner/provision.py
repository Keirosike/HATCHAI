"""Independent RAM-only HATCHAI device provisioning. Default plan is offline."""
import argparse,base64,contextlib,ctypes,datetime,hashlib,hmac,io,ipaddress,json,os,pathlib,re,struct,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parent
BOARDS={'controller':('esp32',0,'hatchai-inc01-controller','controller-sync-v1',0x400000,0x5000),
        'upper':('esp32s3',1,'hatchai-inc01-cam01','upper-camera-v1',0x1000000,0x6000),
        'lower':('esp32s3',2,'hatchai-inc01-cam02','lower-camera-v1',0x1000000,0x6000)}
EXPECTED_MACS={'controller':'b03fd35b6134','upper':'d885accba598','lower':'d885acca0c00'}
FORMAT='<BB6s32s65s65s33s65s80s'
class Refused(Exception):pass
class ReadFailure(Refused):
 def __init__(self,offset,kind):
  self.offset=offset
  self.kind=kind if kind in ('FatalError','SerialException','SerialTimeoutException','TimeoutError','OSError') else 'ReadError'
  super().__init__('flash_read_failed')
class SafeParser(argparse.ArgumentParser):
 def error(self,message):self.exit(2,"STOP: invalid options; use --help. Never supply secrets in arguments.\n")

def need(ok,code):
 if not ok:raise Refused(code)
def sha(b):return hashlib.sha256(b).digest()
def unique(pairs):
 d={}
 for k,v in pairs:
  need(k not in d,'duplicate_json');d[k]=v
 return d

def bundle(path):
 # PowerShell's ConvertFrom-SecureString record is NOT a raw CryptProtectData blob.
 # stdout is private process capture; never forwarded to terminal or exceptions.
 script="$ErrorActionPreference='Stop';$p=[Console]::In.ReadToEnd();$s=ConvertTo-SecureString ([IO.File]::ReadAllText($p));$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}"
 r=subprocess.run(['powershell','-NoProfile','-NonInteractive','-Command',script],input=str(path),text=True,capture_output=True,timeout=30)
 need(r.returncode==0,'dpapi_decrypt_failed')
 try:d=json.loads(r.stdout,object_pairs_hook=unique)
 except Exception:raise Refused('bundle_invalid') from None
 need(d.get('version')==1 and len(d.get('records',[]))==3,'bundle_invalid')
 keys=[]
 for name,(_,_,device,kid,_,_) in BOARDS.items():
  records=[r for r in d['records'] if r.get('device')==device and r.get('keyId')==kid]
  need(len(records)==1,'bundle_identity');r=records[0]
  need(r.get('binding')==('TELEMETRY_DEVICE_KEYS' if name=='controller' else 'CAMERA_EVENT_KEYS') and re.fullmatch(r'[A-Za-z0-9_-]{43}',r.get('key','')),'bundle_key')
  key=base64.urlsafe_b64decode(r['key']+'=');need(len(key)==32 and key not in keys,'bundle_key');keys.append(key)
 return d

def field(value,maximum):
 need(isinstance(value,str) and '\0' not in value,'invalid_text')
 b=value.encode('utf-8');need(len(b)<maximum,'oversized_text');return b+b'\0'*(maximum-len(b))
def plan(board,mac,key,wifi=None):
 need(board in BOARDS and re.fullmatch('[0-9a-f]{12}',mac or ''),'target_invalid')
 need(mac==EXPECTED_MACS[board],'board_role_mac')
 chip,role,device,kid,_,_=BOARDS[board]
 need(len(key)==32,'key_length')
 if board=='controller':need(mac=='b03fd35b6134' and wifi is None,'controller_identity');ssid=password=url=''
 else:
  need(isinstance(wifi,dict) and set(wifi)=={'ssid','password','controller-url'},'wifi_required')
  ssid,password,url=wifi['ssid'],wifi['password'],wifi['controller-url']
  need(isinstance(ssid,str) and len(ssid.encode()) in range(1,33) and isinstance(password,str) and len(password.encode()) in range(8,64),'wifi_invalid')
  need(isinstance(url,str) and url.startswith('http://'),'controller_url')
  try:ip=ipaddress.IPv4Address(url[7:])
  except Exception:raise Refused('controller_url') from None
  need(str(ip)==url[7:] and any(ip in ipaddress.ip_network(n) for n in ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')),'controller_url')
 return struct.pack(FORMAT,1,role,bytes.fromhex(mac),key,field(device,65),field(kid,65),field(ssid,33),field(password,65),field(url,80))

def dpapi_encrypt(data):
 need(os.name=='nt','windows_required')
 from ctypes import wintypes
 class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
 raw=ctypes.create_string_buffer(data,len(data));source=Blob(len(data),ctypes.cast(raw,ctypes.POINTER(ctypes.c_ubyte)));out=Blob()
 crypt=ctypes.WinDLL('crypt32');kernel=ctypes.WinDLL('kernel32')
 crypt.CryptProtectData.argtypes=[ctypes.POINTER(Blob),wintypes.LPCWSTR,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(Blob)]
 kernel.LocalFree.argtypes=[ctypes.c_void_p]
 try:
  need(crypt.CryptProtectData(ctypes.byref(source),'HATCHAI device backup',None,None,None,1,ctypes.byref(out)),'backup_encrypt')
  return ctypes.string_at(out.data,out.size)
 finally:
  ctypes.memset(raw,0,len(data))
  if out.data:ctypes.memset(out.data,0,out.size);kernel.LocalFree(out.data)

def image_check(board,path,expected=None):
 import esptool
 encoded=path.read_bytes();digest=sha(encoded).hex();need(expected is None or hmac.compare_digest(digest,expected.lower()),'image_hash')
 image=esptool.cmds.LoadFirmwareImage(BOARDS[board][0],str(path));image.verify()
 need(image.calculate_checksum()==image.checksum,'image_checksum')
 need(image.append_digest and hmac.compare_digest(image.stored_digest,image.calc_digest),'image_digest')
 ranges=[(0x3ffae000,0x40000000),(0x40080000,0x400c0000),(0x50000000,0x50002000)] if board=='controller' else [(0x3fc80000,0x3fd00000),(0x40370000,0x403e0000),(0x600fe000,0x60100000),(0x50000000,0x50002000)]
 spans=[]
 for s in image.segments:
  need(len(s.data)>0 and any(a<=s.addr<s.addr+len(s.data)<=b for a,b in ranges),'not_ram_image')
  need(all(s.addr+len(s.data)<=a or s.addr>=b for a,b in spans),'image_overlap');spans.append((s.addr,s.addr+len(s.data)))
 need(any(a<=image.entrypoint<b for a,b in spans),'entrypoint')
 report={'version':1,'board':board,'expectedMac':EXPECTED_MACS[board],'chip':BOARDS[board][0],'sha256':digest,'bytes':len(encoded),'entrypoint':image.entrypoint,'segments':[list(pair) for pair in spans],'ram_only':True}
 return image,report

def connect(args,stub=False):
 need(args.mac==EXPECTED_MACS[args.board],'board_role_mac')
 from serial.tools import list_ports
 need(any(p.device.casefold()==args.port.casefold() for p in list_ports.comports()),'serial_port_unavailable')
 import esptool
 need(esptool.__version__ in ('4.11.0','4.12.0'),'esptool_version')
 from esptool.targets.esp32s3 import ESP32S3ROM
 cls=esptool.ESP32ROM if args.board=='controller' else ESP32S3ROM
 try:esp=cls(args.port,baud=115200,trace_enabled=False)
 except Exception:raise Refused('serial_open_failed') from None
 try:
  with contextlib.redirect_stdout(io.StringIO()):
   esp.connect(mode='default_reset',attempts=7)
   need(not esp.sync_stub_detected,'fresh_rom_required')
   need(esp.CHIP_NAME==('ESP32' if args.board=='controller' else 'ESP32-S3') and bytes(esp.read_mac()).hex()==args.mac,'board_identity')
   need(not esp.get_secure_boot_enabled() and not esp.get_flash_encryption_enabled(),'protected_board')
   if stub:
    esp=esp.run_stub();capacity=1<<((esp.flash_id()>>16)&255);need(capacity==BOARDS[args.board][4],'physical_capacity')
    esp.flash_set_parameters(capacity)
    if args.baud!=115200:esp.change_baud(args.baud)
  return esp
 except BaseException:esp._port.close();raise

def snapshot(args,twice=False):
 esp=connect(args,True)
 try:
  def read():
   pieces=[]
   for at in range(0,BOARDS[args.board][4],65536):
    try:
     with contextlib.redirect_stdout(io.StringIO()):b=esp.read_flash(at,65536)
    except Exception as error:raise ReadFailure(at,type(error).__name__) from None
    need(len(b)==65536,'short_flash_read');pieces.append(b)
    if (at+65536)%1048576==0:print('[read] bytes='+str(at+65536))
   return b''.join(pieces)
  first=read()
  if twice:need(hmac.compare_digest(first,read()),'snapshot_mismatch')
  return first
 finally:esp._port.close()

def line(port,seconds=30):
 deadline=time.monotonic()+seconds;data=bytearray()
 while time.monotonic()<deadline:
  b=port.read(1)
  if not b:continue
  if b==b'\n':
   if data.startswith(b'HDS1 STOP '):
    fields=data.decode('ascii').split();need(len(fields)==3 and fields[2].isdigit(),'agent_refused')
    raise Refused('agent_'+fields[2])
   if data.startswith(b'HDS1 '):return data.decode('ascii')
   data.clear()
  elif b!=b'\r':
   need(len(data)<1399,'serial_bounds');data+=b
 raise Refused('usb_timeout')

def run(args):
 from cryptography.hazmat.primitives.asymmetric import ec
 from cryptography.hazmat.primitives import hashes,serialization
 from cryptography.hazmat.primitives.kdf.hkdf import HKDF
 from cryptography.hazmat.primitives.ciphers.aead import AESGCM
 need(args.image is not None and args.sha256 is not None and args.port,'explicit_image_required')
 image,report=image_check(args.board,args.image,args.sha256)
 manifest=json.loads(args.image.with_suffix('.manifest.json').read_text(encoding='utf-8'));need(manifest==report,'manifest_mismatch')
 diagnostic=args.action=='diagnose'
 payload=None
 if not diagnostic:
  d=bundle(args.bundle);record=next(r for r in d['records'] if r['device']==BOARDS[args.board][2]);key=base64.urlsafe_b64decode(record['key']+'=')
 wifi=None
 if not diagnostic and args.board!='controller':
  import getpass,warnings
  warnings.filterwarnings('error',category=getpass.GetPassWarning)
  wifi={'ssid':input('Router SSID: '),'password':getpass.getpass('Router password (hidden): '),'controller-url':input('Controller router-side URL (http://private-ip): ')}
 if not diagnostic:payload=plan(args.board,args.mac,key,wifi)
 print('Reading two matching snapshots before RAM execution; no writes authorized.')
 before=snapshot(args,True)
 directory=pathlib.Path(os.environ['LOCALAPPDATA'])/'HATCHAI-Provisioning'/'device-backups';directory.mkdir(parents=True,exist_ok=True)
 name=args.board+'-'+args.mac+'-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 with (directory/(name+'.before.dpapi')).open('xb') as f:f.write(dpapi_encrypt(before))
 print('Encrypted baseline saved. RAM SHA256='+report['sha256'])
 esp=connect(args);submitted=False;executed=False;handshake=False;verified=False;result=None
 try:
  with contextlib.redirect_stdout(io.StringIO()):
   for s in image.segments:
    esp.mem_begin(len(s.data),(len(s.data)+esp.ESP_RAM_BLOCK-1)//esp.ESP_RAM_BLOCK,esp.ESP_RAM_BLOCK,s.addr)
    for seq,at in enumerate(range(0,len(s.data),esp.ESP_RAM_BLOCK)):esp.mem_block(s.data[at:at+esp.ESP_RAM_BLOCK],seq)
   executed=True
   esp.mem_finish(image.entrypoint)
  esp._port.timeout=.25
  parts=line(esp._port,40).split()
  need(len(parts)==8 and parts[0]=='HDS1' and parts[1]==str(BOARDS[args.board][1]) and parts[2]==args.mac,'agent_identity')
  need(all(int(n)==BOARDS[args.board][4] for n in parts[3:6]),'agent_capacity')
  handshake=True
  if diagnostic:
   return
  challenge=base64.b64decode(parts[6],validate=True);public=base64.b64decode(parts[7],validate=True)
  need(len(challenge)==32 and len(public)==65,'agent_handshake')
  private=ec.generate_private_key(ec.SECP256R1());peer=ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),public)
  host=private.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
  session=HKDF(algorithm=hashes.SHA256(),length=32,salt=challenge,info=bytes.fromhex(args.mac)+public+host).derive(private.exchange(ec.ECDH(),peer))
  prompt=('REPLACE' if args.replace else 'RESUME' if args.resume else 'PROVISION')+' '+args.board.upper()+' '+args.mac
  need(input('Type '+prompt+' to authorize: ')==prompt,'authorization_refused')
  cipher=AESGCM(session);flags=int(args.resume)|(int(args.replace)<<1)
  encrypted=cipher.encrypt(b'HOST'+b'\0'*7+b'\1',bytes((flags,0xA5))+payload,challenge)
  packet=b'HDS1 '+base64.b64encode(host)+b' '+base64.b64encode(encrypted)+b'\n'
  submitted=True;need(esp._port.write(packet)==len(packet),'serial_write');esp._port.flush()
  response=line(esp._port,45).split();need(len(response)==3 and response[:2]==['HDS1','RESULT'],'agent_refused')
  result=cipher.decrypt(b'DEV!'+b'\0'*7+b'\1',base64.b64decode(response[2],validate=True),challenge)
  need(len(result)==65 and result[0]<=8 and hmac.compare_digest(result[1:33],sha(payload)),'transaction_response_invalid')
  if result[0]!=0:raise Refused('transaction_'+str(result[0]))
  verified=True
 finally:
  esp._port.close()
  if executed:
   print('Verifying flash preservation; do not disconnect or restart.')
   after=snapshot(args,True);start=0x9000;end=start+BOARDS[args.board][5]
   with (directory/(name+'.after.dpapi')).open('xb') as f:f.write(dpapi_encrypt(after))
   need(hmac.compare_digest(before[:start],after[:start]) and hmac.compare_digest(before[end:],after[end:]),'outside_nvs_changed')
   if not submitted:
    need(hmac.compare_digest(before,after),'preauthorization_flash_changed')
    if diagnostic and handshake:print('PASS: read-only RAM startup; complete flash byte-for-byte identical. No credential request submitted.')
    else:print('PASS: flash preservation only; provisioning/startup completion not confirmed.')
   if result is not None and len(result)==65:
    receipt={'board':args.board,'mac':args.mac,'imageSha256':report['sha256'],'planHash':sha(payload).hex(),'unrelatedDigest':result[33:].hex(),'beforeSha256':sha(before).hex(),'afterSha256':sha(after).hex(),'outsideNvsPreserved':True,'success':verified}
    (directory/(name+'.receipt.json')).write_text(json.dumps(receipt,indent=2),encoding='utf-8')
 print('PASS: credential values freshly read back; unrelated logical NVS digest unchanged; all bytes outside NVS identical. Restart only under supervision.')


def main():
 parser=SafeParser(description=__doc__)
 parser.add_argument('action',choices=['plan','manifest','diagnose','provision'],nargs='?',default='plan')
 parser.add_argument('--board',choices=BOARDS,required=True);parser.add_argument('--mac');parser.add_argument('--port')
 parser.add_argument('--image',type=pathlib.Path);parser.add_argument('--sha256');parser.add_argument('--baud',type=int,choices=[57600,115200],default=57600)
 parser.add_argument('--bundle',type=pathlib.Path,default=pathlib.Path(os.environ.get('LOCALAPPDATA','.'))/'HATCHAI-Provisioning/sprint4-devices.dpapi')
 parser.add_argument('--resume',action='store_true');parser.add_argument('--replace',action='store_true')
 args=parser.parse_args()
 try:
  if args.action=='plan':
   print(json.dumps({'board':args.board,'chip':BOARDS[args.board][0],'expectedMac':EXPECTED_MACS[args.board],'device':BOARDS[args.board][2],'keyId':BOARDS[args.board][3],'namespace':'hatchai-sync' if args.board=='controller' else 'hatchai-cloud','wifiNamespace':None if args.board=='controller' else 'hatchai-wifi','writes':False}));return
  if args.action=='manifest':
   need(args.image is not None,'image_required');_,report=image_check(args.board,args.image)
   args.image.with_suffix('.manifest.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report));return
  need(re.fullmatch('[0-9a-f]{12}',args.mac or ''),'mac_required')
  need(args.mac==EXPECTED_MACS[args.board],'board_role_mac')
  need(not(args.resume and args.replace),'ambiguous_authorization')
  if args.action=='provision':need(sys.stdin.isatty(),'interactive_console_required')
  run(args)
 except (Exception,KeyboardInterrupt) as e:
  # Never print raw serial data, decrypted values, tracebacks or SDK messages.
  code=str(e) if isinstance(e,Refused) and re.fullmatch('[a-z_]+|agent_[0-9]{1,2}|transaction_[0-9]' ,str(e)) else 'operation_failed'
  location=(' offset=0x%06x length=65536 error=%s'%(e.offset,e.kind)) if isinstance(e,ReadFailure) else ''
  print('STOP: '+code+location+'. Keep loads isolated. Retain encrypted backups; do not erase or automatically retry.',file=sys.stderr);return 1
 return 0
if __name__=='__main__':sys.exit(main())
