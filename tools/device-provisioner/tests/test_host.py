import base64,hashlib,importlib.util,io,json,pathlib,struct,types,unittest,tempfile
from contextlib import redirect_stdout
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('device_setup',ROOT/'provision.py')
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class Host(unittest.TestCase):
 def test_actual_image_manifest_roundtrip(self):
  for board in p.BOARDS:
   image=ROOT/('build-'+board)/'hatchai_device_setup.bin'
   if not image.exists():self.skipTest('Build RAM images first')
   _,report=p.image_check(board,image)
   self.assertEqual(report,json.loads(image.with_suffix('.manifest.json').read_text()))
 def test_installed_loader_api(self):
  import esptool
  from esptool.targets.esp32s3 import ESP32S3ROM
  self.assertEqual(ESP32S3ROM.CHIP_NAME,'ESP32-S3')
  self.assertTrue(hasattr(esptool,'ESP32ROM'))
 def test_reviewed_board_configuration(self):
  configs=json.loads((ROOT/'boards.json').read_text())
  self.assertEqual(len(configs['boards']),3)
  for config in configs['boards']:
   board=config['board'];self.assertEqual(config['mac'],p.EXPECTED_MACS[board]);self.assertEqual(config['deviceId'],p.BOARDS[board][2]);self.assertEqual(config['keyId'],p.BOARDS[board][3]);self.assertNotIn('port',config)
 def test_three_roles(self):
  for role in p.BOARDS:
   wifi=None if role=='controller' else {'ssid':'router','password':'synthetic-password','controller-url':'http://192.168.1.2'}
   data=p.plan(role,p.EXPECTED_MACS[role],bytes(32),wifi)
   self.assertEqual(len(data),348)
   self.assertEqual(struct.unpack(p.FORMAT,data)[1],p.BOARDS[role][1])
 def test_swapped_camera_macs(self):
  wifi={'ssid':'router','password':'abcdefgh','controller-url':'http://192.168.1.2'}
  for board,wrong in [('upper','lower'),('lower','upper')]:
   with self.assertRaisesRegex(p.Refused,'board_role_mac'):p.plan(board,p.EXPECTED_MACS[wrong],bytes(32),wifi)
 def test_wrong_mac_never_opens_port(self):
  args=types.SimpleNamespace(board='upper',mac=p.EXPECTED_MACS['lower'])
  with patch('builtins.__import__',side_effect=AssertionError('No serial imports permitted')):
   with self.assertRaisesRegex(p.Refused,'board_role_mac'):p.connect(args)
 def test_reported_controller_mismatch_fails_before_serial(self):
  args=types.SimpleNamespace(board='controller',mac='b03fd35b8a88')
  with patch('builtins.__import__',side_effect=AssertionError('No serial imports permitted')):
   with self.assertRaisesRegex(p.Refused,'board_role_mac'):p.connect(args)
  with self.assertRaisesRegex(p.Refused,'board_role_mac'):p.plan('controller',args.mac,bytes(32))
 def test_flash_read_error_is_offset_only(self):
  error=type('FatalError',(Exception,),{})
  esp=types.SimpleNamespace(read_flash=lambda *args:(_ for _ in ()).throw(error('sensitive serial buffer')), _port=types.SimpleNamespace(close=lambda:None))
  with patch.object(p,'connect',return_value=esp):
   with self.assertRaises(p.ReadFailure) as caught:p.snapshot(types.SimpleNamespace(board='controller'))
  self.assertEqual(caught.exception.offset,0);self.assertEqual(caught.exception.kind,'FatalError');self.assertNotIn('sensitive',str(caught.exception))
 def test_absent_port_fails_before_open(self):
  args=types.SimpleNamespace(board='controller',mac=p.EXPECTED_MACS['controller'],port='COM3')
  with patch('serial.tools.list_ports.comports',return_value=[]),patch('esptool.ESP32ROM',side_effect=AssertionError('must not open')):
   with self.assertRaisesRegex(p.Refused,'serial_port_unavailable'):p.connect(args)
 def test_serial_open_error_is_sanitized(self):
  args=types.SimpleNamespace(board='controller',mac=p.EXPECTED_MACS['controller'],port='COM3')
  with patch('serial.tools.list_ports.comports',return_value=[types.SimpleNamespace(device='COM3')]),patch('esptool.ESP32ROM',side_effect=OSError('private driver data')):
   with self.assertRaisesRegex(p.Refused,'serial_open_failed') as error:p.connect(args)
  self.assertNotIn('private',str(error.exception))
 def test_wrong_controller(self):
  with self.assertRaises(p.Refused):p.plan('controller','001122334455',bytes(32))
 def test_bad_key(self):
  for n in (0,31,33):
   with self.assertRaises(p.Refused):p.plan('controller','b03fd35b6134',bytes(n))
 def test_wifi(self):
  for url in ('http://8.8.8.8','https://192.168.1.2','http://127.0.0.1','http://192.168.1.2/path'):
   with self.assertRaises(p.Refused):p.plan('upper',p.EXPECTED_MACS['upper'],bytes(32),{'ssid':'r','password':'abcdefgh','controller-url':url})
 def test_nul_and_bounds(self):
  for ssid in ('bad\0name','x'*33):
   with self.assertRaises(p.Refused):p.plan('lower',p.EXPECTED_MACS['lower'],bytes(32),{'ssid':ssid,'password':'abcdefgh','controller-url':'http://192.168.1.2'})
 def test_serial_bounds_and_no_echo(self):
  class Port:
   def __init__(self,data):self.s=io.BytesIO(data)
   def read(self,n):return self.s.read(n)
  with self.assertRaises(p.Refused):p.line(Port(b'x'*1400+b'\n'),.1)
  with self.assertRaisesRegex(p.Refused,'agent_23'):p.line(Port(b'ignored boot output\nHDS1 STOP 23\n'),.1)
 def test_duplicate_json(self):
  with self.assertRaises(p.Refused):json.loads('{"version":1,"version":2}',object_pairs_hook=p.unique)
 def test_session_crypto_and_tamper(self):
  from cryptography.hazmat.primitives.asymmetric import ec
  from cryptography.hazmat.primitives import hashes,serialization
  from cryptography.hazmat.primitives.kdf.hkdf import HKDF
  from cryptography.hazmat.primitives.ciphers.aead import AESGCM
  a,b=ec.generate_private_key(ec.SECP256R1()),ec.generate_private_key(ec.SECP256R1())
  pub=lambda x:x.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
  context=bytes.fromhex('001122334455')+pub(a)+pub(b);challenge=bytes(range(32))
  derive=lambda secret:HKDF(algorithm=hashes.SHA256(),length=32,salt=challenge,info=context).derive(secret)
  self.assertEqual(derive(a.exchange(ec.ECDH(),b.public_key())),derive(b.exchange(ec.ECDH(),a.public_key())))
  cipher=AESGCM(derive(a.exchange(ec.ECDH(),b.public_key())));nonce=b'HOST'+b'\0'*7+b'\1'
  encrypted=cipher.encrypt(nonce,b'synthetic',challenge)
  self.assertEqual(cipher.decrypt(nonce,encrypted,challenge),b'synthetic')
  with self.assertRaises(Exception):cipher.decrypt(nonce,encrypted[:-1]+bytes((encrypted[-1]^1,)),challenge)
  with self.assertRaises(Exception):cipher.decrypt(b'DEV!'+nonce[4:],encrypted,challenge)
 def test_offline_default_has_no_serial(self):
  out=io.StringIO()
  with patch('sys.argv',['provision.py','--board','upper']),patch.object(p,'connect',side_effect=AssertionError('serial forbidden')),redirect_stdout(out):p.main()
  self.assertFalse(json.loads(out.getvalue())['writes'])
 def session(self,accepted=True,tamper=False,wrong_role=False):
  from cryptography.hazmat.primitives.asymmetric import ec
  from cryptography.hazmat.primitives import hashes,serialization
  from cryptography.hazmat.primitives.kdf.hkdf import HKDF
  from cryptography.hazmat.primitives.ciphers.aead import AESGCM
  device=ec.generate_private_key(ec.SECP256R1());challenge=bytes(range(32))
  public=device.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
  mac='b03fd35b6134'
  class Port:
   timeout=.25;writes=0
   def __init__(self):
    role=1 if wrong_role else 0
    self.buffer=io.BytesIO(('HDS1 '+str(role)+' '+mac+' 4194304 4194304 4194304 '+base64.b64encode(challenge).decode()+' '+base64.b64encode(public).decode()+'\n').encode())
   def read(self,n):return self.buffer.read(n)
   def write(self,packet):
    self.writes+=1;fields=packet.split();peer=base64.b64decode(fields[1]);other=ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),peer)
    key=HKDF(algorithm=hashes.SHA256(),length=32,salt=challenge,info=bytes.fromhex(mac)+public+peer).derive(device.exchange(ec.ECDH(),other))
    cipher=AESGCM(key);plain=cipher.decrypt(b'HOST'+b'\0'*7+b'\1',base64.b64decode(fields[2]),challenge)
    assert plain[1]==0xA5
    response=cipher.encrypt(b'DEV!'+b'\0'*7+b'\1',bytes((0,))+p.sha(plain[2:])+bytes(32),challenge)
    if tamper:response=response[:-1]+bytes((response[-1]^1,))
    self.buffer=io.BytesIO(b'HDS1 RESULT '+base64.b64encode(response)+b'\n');return len(packet)
   def flush(self):pass
   def close(self):pass
  port=Port()
  esp=types.SimpleNamespace(_port=port,ESP_RAM_BLOCK=4096,mem_begin=lambda *a:None,mem_block=lambda *a:None,mem_finish=lambda *a:None)
  image=types.SimpleNamespace(segments=[],entrypoint=1)
  report={'sha256':'a'*64};before=bytes(0x400000)
  record={'device':'hatchai-inc01-controller','key':base64.urlsafe_b64encode(bytes(range(32))).decode().rstrip('=')}
  with tempfile.TemporaryDirectory() as directory:
   path=pathlib.Path(directory)/'agent.bin';path.with_suffix('.manifest.json').write_text(json.dumps(report))
   args=types.SimpleNamespace(action='provision',image=path,sha256='a'*64,port='MOCK',board='controller',mac=mac,bundle=None,resume=False,replace=False)
   out=io.StringIO()
   with patch.object(p,'connect',return_value=esp),patch.object(p,'snapshot',return_value=before) as snapshots,patch.object(p,'image_check',return_value=(image,report)),patch.object(p,'bundle',return_value={'records':[record]}),patch.object(p,'dpapi_encrypt',return_value=b'protected synthetic backup'),patch.dict(p.os.environ,{'LOCALAPPDATA':directory}),patch('builtins.input',return_value='PROVISION CONTROLLER '+mac if accepted else 'wrong'),redirect_stdout(out):
    if accepted and not tamper and not wrong_role:p.run(args)
    else:
     with self.assertRaises(Exception):p.run(args)
   self.assertEqual(snapshots.call_count,2) # baseline + post, even cancellation
   self.assertEqual(port.writes,1 if accepted and not wrong_role else 0)
   self.assertNotIn(record['key'],out.getvalue())
   receipts=list(pathlib.Path(directory).rglob('*.receipt.json'))
   if accepted and not tamper and not wrong_role:self.assertTrue(json.loads(receipts[0].read_text())['success'])
   else:self.assertFalse(receipts)
 def test_mock_full_encrypted_session(self):self.session()
 def test_mock_rejected_confirmation(self):self.session(accepted=False)
 def test_mock_tampered_response(self):self.session(tamper=True)
 def test_mock_wrong_camera_handshake(self):self.session(wrong_role=True)
if __name__=='__main__':unittest.main()
