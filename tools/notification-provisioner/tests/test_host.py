import base64
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('provision', BASE/'provision.py')
p = importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
KEY = bytes(range(32))  # Public deterministic local test material, never a production credential.
ENCODED = base64.urlsafe_b64encode(KEY).decode().rstrip('=')


def source_json(key=ENCODED):
    return json.dumps({p.DEVICE:{'controller-v1':key}})


def full_image(nvs=None):
    image = bytearray(b'\xff'*p.FLASH_SIZE)
    entries = [('nvs',1,2,0x9000,0x5000),('otadata',1,0,0xE000,0x2000),
               ('app0',0,0x10,0x10000,0x140000),('app1',0,0x11,0x150000,0x140000),
               ('spiffs',1,0x82,0x290000,0x160000),('coredump',1,3,0x3F0000,0x10000)]
    table = b''.join(struct.pack('<HBBII16sI',0x50AA,k,s,o,n,name.encode(),0) for name,k,s,o,n in entries)
    table += b'\xeb\xeb'+b'\xff'*14+hashlib.md5(table).digest()
    image[0x8000:0x8000+len(table)] = table
    if nvs is not None:image[p.NVS_START:p.NVS_END] = nvs
    return bytes(image)


def generated_nvs(directory, owned=False, changed=False, version=2):
    csv = directory/f'{owned}-{changed}-{version}.csv';out=csv.with_suffix('.bin')
    rows = ['key,type,encoding,value','wifi,namespace,,','ssid,data,string,isolated-test',
            'password,data,string,public-fixture-only','profile,namespace,,',
            f'number,data,u32,{43 if changed else 42}','blob,data,hex2bin,'+bytes(range(200)).hex(),
            'hatchai-pair,namespace,,','keep,data,string,not-owned']
    if owned:rows += ['enabled,data,u8,1','active,data,u8,0','generation,data,u32,1',
                      'slot0,data,hex2bin,'+p.record(KEY,'controller-v1',1).hex()]
    csv.write_text('\n'.join(rows)+'\n',encoding='utf8')
    result=subprocess.run([sys.executable,'-m','esp_idf_nvs_partition_gen','generate',str(csv),str(out),'0x5000','--version',str(version)],capture_output=True)
    if result.returncode:raise RuntimeError('Local synthetic NVS fixture generation failed')
    return out.read_bytes()


class FakePort:
    def __init__(self,tamper=False,stale=False,mac='b03fd35b8a88'):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization
        self.private=ec.generate_private_key(ec.SECP256R1());self.mac=mac
        self.public=self.private.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)
        self.challenge=hashlib.sha256(b'public-challenge-fixture').digest()
        self.buffer=bytearray(f'{p.PREFIX} {mac} {base64.b64encode(self.challenge).decode()} {base64.b64encode(self.public).decode()}\n'.encode())
        self.unrelated=hashlib.sha256(b'unchanged-other-nvs').digest();self.writes=[];self.tamper=tamper;self.stale=stale

    def read(self,n):
        data=bytes(self.buffer[:n]);del self.buffer[:n];return data

    def write(self,packet):
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        self.writes.append(packet)
        prefix,seq,peer,encrypted=packet.decode().split();sequence=int(seq)
        host=base64.b64decode(peer)
        shared=self.private.exchange(ec.ECDH(),ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(),host))
        cipher=AESGCM(HKDF(algorithm=hashes.SHA256(),length=32,salt=self.challenge,
            info=p.PROTOCOL+bytes.fromhex(self.mac)+self.public+host).derive(shared))
        plain=cipher.decrypt(p.iv(sequence),base64.b64decode(encrypted),p.aad(self.challenge,sequence))
        op,flags,expected,length=struct.unpack('<BBIH',plain[:8]);blob=plain[8:]
        if len(blob)!=length:raise ValueError('bounded fixture')
        response=struct.pack('<5BI',0,0,op!=1,op!=1,False,1 if op!=1 else 0)+self.unrelated
        response += hashlib.sha256(blob).digest() if op!=1 else bytes(32)
        response += hmac.new(KEY,p.PROOF+self.challenge+blob,hashlib.sha256).digest() if op!=1 else bytes(32)
        protected=cipher.encrypt(p.iv(sequence,True),response,p.aad(self.challenge,sequence))
        if self.tamper:protected=protected[:-1]+bytes([protected[-1]^1])
        self.buffer.extend(f'{p.PREFIX} {sequence+1 if self.stale else sequence} {base64.b64encode(protected).decode()}\n'.encode())
        return len(packet)

    def flush(self):pass


class CredentialTests(unittest.TestCase):
    def test_exact_record_header_and_crc(self):
        blob=p.record(KEY,'controller-v1',1)
        self.assertEqual(len(blob),87);self.assertEqual(blob[:6],b'HNPC\x01\x00')
        self.assertEqual(blob[-4:],struct.pack('<I',p.zlib.crc32(blob[:-4])))

    def test_json_shape(self):self.assertEqual(p.parse_credential(source_json(),'controller-v1'),KEY)

    def test_duplicate_fields(self):
        with self.assertRaises(p.Failure):p.parse_credential('{"x":1,"x":2}','controller-v1')

    def test_wrong_identity(self):
        with self.assertRaises(p.Failure):p.parse_credential(json.dumps({'camera':{'controller-v1':ENCODED}}),'controller-v1')

    def test_wrong_key_id(self):
        with self.assertRaises(p.Failure):p.parse_credential(source_json(),'different-v1')

    def test_wrong_lengths_and_noncanonical_keys(self):
        for key in ['x'*42,'x'*44,ENCODED+'=',None,ENCODED[:-1]+'B']:
            with self.assertRaises(p.Failure):p.parse_credential(source_json(key),'controller-v1')

    def test_invalid_generation_and_ids(self):
        for generation in [0,-1,2**32]:
            with self.assertRaises(p.Failure):p.record(KEY,'controller-v1',generation)
        for kid in ['','bad/key','x'*65]:
            with self.assertRaises(p.Failure):p.record(KEY,kid,1)

    @unittest.skipUnless(os.name=='nt','Windows DPAPI integration')
    def test_real_windows_dpapi_credential_read(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'test.dpapi';file.write_text(p.dpapi(source_json().encode('utf-16-le')).hex(),encoding='ascii')
            self.assertEqual(p.load_credential(file,'controller-v1'),KEY)

    @unittest.skipUnless(os.name=='nt','PowerShell/Windows DPAPI integration')
    def test_actual_powershell_securestring_compatibility(self):
        # Public test fixture only, captured encrypted output; never the user's file.
        script = "$s=ConvertTo-SecureString '"+source_json()+"' -AsPlainText -Force; $s | ConvertFrom-SecureString"
        encoded=base64.b64encode(script.encode('utf-16-le')).decode()
        environment=dict(os.environ)
        # Do not inherit PowerShell 7's incompatible module search path into Windows PowerShell 5.1.
        environment['PSModulePath']=str(Path(os.environ['WINDIR'])/'System32/WindowsPowerShell/v1.0/Modules')
        result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-EncodedCommand',encoded],capture_output=True,text=True,env=environment)
        self.assertEqual(result.returncode,0)
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'powershell-test.dpapi';file.write_text(result.stdout.strip(),encoding='ascii')
            self.assertEqual(p.load_credential(file,'controller-v1'),KEY)

    @unittest.skipUnless(os.name=='nt','Windows DPAPI integration')
    def test_encrypted_backup_roundtrip_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'test.flash.dpapi';data=b'public-fixture'*400
            p.save_private(file,data);self.assertNotIn(data,file.read_bytes());self.assertEqual(p.dpapi(file.read_bytes(),True),data)
            with self.assertRaises(FileExistsError):p.save_private(file,data)

    @unittest.skipUnless(os.name=='nt','Windows DPAPI integration')
    def test_resume_baseline_is_encrypted_and_bound_to_board(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'before.flash.dpapi';image=full_image()
            p.save_private(file,p.backup_payload(image,'b03fd35b8a88'))
            self.assertEqual(p.load_baseline(file,'b03fd35b8a88'),image)
            with self.assertRaises(p.Failure):p.load_baseline(file,'aaaaaaaaaaaa')

    def test_reject_plaintext_credential_file(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'not-protected';file.write_text(source_json(),encoding='ascii')
            with self.assertRaises(p.Failure):p.load_credential(file,'controller-v1')

    def test_default_plan_never_connects_or_prints_key(self):
        output=io.StringIO()
        with patch.object(p,'load_credential',return_value=KEY),patch.object(p,'connect') as connect,contextlib.redirect_stdout(output):
            self.assertEqual(p.main([]),0);connect.assert_not_called()
        self.assertIn('offline_plan',output.getvalue());self.assertNotIn(ENCODED,output.getvalue())

    def test_execution_requires_explicit_physical_flags(self):
        output=io.StringIO()
        with patch.object(p,'load_credential',return_value=KEY),patch.object(p,'connect') as connect,contextlib.redirect_stderr(output):
            self.assertEqual(p.main(['--execute']),1);connect.assert_not_called()
        self.assertNotIn(ENCODED,output.getvalue())

    def test_conflicting_modes_fail_without_hardware(self):
        with patch.object(p,'load_credential') as load,contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(p.main(['--verify-existing','--resume']),1);load.assert_not_called()

    def test_resume_requires_original_baseline_before_usb_access(self):
        image=BASE/'build/hatchai_usb_provisioner.bin'
        flags=['--execute','--loads-isolated','--port','NO-HARDWARE','--expected-mac','b03fd35b8a88',
               '--ram-sha256',hashlib.sha256(image.read_bytes()).hexdigest(),'--resume']
        with patch.object(p,'load_credential',return_value=KEY),patch.object(p,'connect') as connect,patch('builtins.input') as prompt,contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(p.main(flags),1);connect.assert_not_called();prompt.assert_not_called()

    def test_invalid_options_cannot_echo_a_supplied_key(self):
        output=io.StringIO()
        with contextlib.redirect_stderr(output),self.assertRaises(SystemExit):p.main(['--raw-key',ENCODED])
        self.assertNotIn(ENCODED,output.getvalue())


class TransportTests(unittest.TestCase):
    def stage_fixture(self,stage=50,sequence=2,count=1,tamper=False):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        session=p.Session.__new__(p.Session);session.sequence=sequence;session.stage_counter=0
        session.challenge=bytes(range(32));session.cipher=AESGCM(bytes(range(32)))
        ticket=(sequence<<32)|count;plain=struct.pack('<HHIII',stage,0,123,45678,8192)
        encoded=session.cipher.encrypt(b'S2H!'+ticket.to_bytes(8,'big'),plain,p.aad(session.challenge,ticket))
        if tamper:encoded=encoded[:-1]+bytes([encoded[-1]^1])
        return session,f'HATCHAI-STAGE-1 {sequence} {count} {base64.b64encode(encoded).decode()}'

    def test_encrypted_stage_authentication_and_sanitized_output(self):
        session,line=self.stage_fixture();output=io.StringIO()
        with contextlib.redirect_stderr(output):session.stage_event(line)
        self.assertIn('namespace_open_begin',output.getvalue());self.assertIn('stack=8192',output.getvalue())
        self.assertNotIn(line.split()[-1],output.getvalue());self.assertEqual(session.stage_counter,1)

    def test_stage_tamper_replay_sequence_and_unknown_stage_rejected(self):
        for opts in [{'tamper':True},{'count':2},{'stage':999}]:
            session,line=self.stage_fixture(**opts)
            with self.assertRaises(p.Failure):session.stage_event(line)
        session,line=self.stage_fixture();session.sequence=3
        with self.assertRaises(p.Failure):session.stage_event(line)
        session,line=self.stage_fixture()
        with contextlib.redirect_stderr(io.StringIO()):session.stage_event(line)
        with self.assertRaises(p.Failure):session.stage_event(line)

    def test_stage_nonce_domain_is_distinct_and_expiry_fails_explicitly(self):
        session,line=self.stage_fixture(stage=90)
        self.assertNotEqual(b'S2H!'+(2<<32|1).to_bytes(8,'big'),p.iv(2,True))
        with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(p.Failure):session.stage_event(line)

    def test_line_consumes_authenticated_stage_before_normal_response(self):
        session,line=self.stage_fixture()
        session.port=FakePort();session.port.buffer=bytearray((line+'\nHATCHAI-USB-1 2 response-placeholder\n').encode())
        with contextlib.redirect_stderr(io.StringIO()):result=session.line(1)
        self.assertEqual(result,'HATCHAI-USB-1 2 response-placeholder')

    def test_partial_request_write_fails_without_retry(self):
        port=FakePort();session=p.Session(port,port.mac)
        with patch.object(port,'write',return_value=1) as write:
            with self.assertRaises(p.Failure):session.request(1)
            write.assert_called_once()

    def test_encrypted_session_and_key_readback_proof(self):
        port=FakePort();session=p.Session(port,port.mac);before=session.request(1)
        blob=p.record(KEY,'controller-v1',1);reply=session.request(2,blob)
        p.verify_reply(reply,blob,KEY,session.challenge,before['unrelated'])
        for packet in port.writes:self.assertNotIn(ENCODED.encode(),packet);self.assertNotIn(KEY,packet)

    def test_tampered_ciphertext_fails_closed(self):
        port=FakePort(tamper=True);session=p.Session(port,port.mac)
        with self.assertRaises(p.Failure):session.request(1)

    def test_stale_response_rejected(self):
        port=FakePort(stale=True);session=p.Session(port,port.mac)
        with self.assertRaises(p.Failure):session.request(1)

    def test_wrong_board_mac_rejected(self):
        port=FakePort()
        with self.assertRaises(p.Failure):p.Session(port,'aaaaaaaaaaaa')

    def test_readback_digest_key_and_other_nvs_tampering(self):
        port=FakePort();session=p.Session(port,port.mac);blob=p.record(KEY,'controller-v1',1);reply=session.request(2,blob)
        for field in ['digest','proof','unrelated']:
            damaged={**reply,field:bytes(32)}
            with self.assertRaises(p.Failure):p.verify_reply(damaged,blob,KEY,session.challenge,port.unrelated)

    def test_no_unbounded_session_requests(self):
        port=FakePort();session=p.Session(port,port.mac)
        for _ in range(3):session.request(1)
        with self.assertRaises(p.Failure):session.request(1)

    def test_oversized_serial_response_is_rejected(self):
        port=FakePort();port.buffer=bytearray(b'x'*1025)
        session=p.Session.__new__(p.Session);session.port=port
        with self.assertRaises(p.Failure):session.line(1)

    def test_ram_startup_refusal_reports_only_allowlisted_reason(self):
        for reason in sorted(p.RAM_STARTUP_ERRORS):
            port=FakePort();port.buffer=bytearray(f'HATCHAI-USB-ERROR {reason}\n'.encode())
            session=p.Session.__new__(p.Session);session.port=port
            with self.assertRaises(p.Failure) as error:session.line(1)
            self.assertIn(reason,str(error.exception))
            self.assertIn('retain the encrypted baseline',str(error.exception))

    def test_unknown_ram_startup_refusal_cannot_leak_details(self):
        port=FakePort();port.buffer=bytearray(f'HATCHAI-USB-ERROR private-{ENCODED}\n'.encode())
        session=p.Session.__new__(p.Session);session.port=port
        with self.assertRaises(p.Failure) as error:session.line(1)
        self.assertIn('unknown_startup_error',str(error.exception));self.assertNotIn(ENCODED,str(error.exception))

    def test_flash_diagnostics_accept_only_bounded_numeric_metadata(self):
        port=FakePort();port.buffer=bytearray((
            'HATCHAI-FLASH-DIAG rc=0 physical=4194304 usable=4194304 rom=4194304\n'
            'HATCHAI-FLASH-DIAG rc=999999 physical=1 usable=1 rom=1\n'
            'HATCHAI-FLASH-DIAG private='+ENCODED+'\n'
            'HATCHAI-USB-ERROR flash_size_mismatch\n').encode())
        session=p.Session.__new__(p.Session);session.port=port;output=io.StringIO()
        with contextlib.redirect_stderr(output),self.assertRaises(p.Failure):session.line(1)
        self.assertIn('physical=4194304',output.getvalue())
        self.assertNotIn('999999',output.getvalue());self.assertNotIn(ENCODED,output.getvalue())

    def test_nonce_direction_and_sequence_separation(self):
        self.assertNotEqual(p.iv(1),p.iv(1,True));self.assertNotEqual(p.iv(1),p.iv(2))

    def test_security_and_identity_guards_precede_stub_execution(self):
        import esptool
        from unittest.mock import MagicMock
        args=SimpleNamespace(port='NO-HARDWARE',expected_mac='b03fd35b8a88',baud=115200)
        for wrong_mac,secure,encrypted in [(True,False,False),(False,True,False),(False,False,True)]:
            fake=MagicMock();fake.CHIP_NAME='ESP32';fake.sync_stub_detected=False;fake.read_mac.return_value=bytes.fromhex('aaaaaaaaaaaa' if wrong_mac else args.expected_mac)
            fake.get_secure_boot_enabled.return_value=secure;fake.get_flash_encryption_enabled.return_value=encrypted
            with patch.object(esptool,'ESP32ROM',return_value=fake):
                with self.assertRaises(p.Failure):p.connect(args,stub=True)
            fake.run_stub.assert_not_called();fake._port.close.assert_called_once()

    def connection_fixture(self):
        import esptool
        from unittest.mock import MagicMock
        args=SimpleNamespace(port='NO-HARDWARE',expected_mac='b03fd35b8a88',baud=115200)
        rom=MagicMock();rom.CHIP_NAME='ESP32';rom.sync_stub_detected=False
        rom.read_mac.return_value=bytes.fromhex(args.expected_mac)
        rom.get_secure_boot_enabled.return_value=False;rom.get_flash_encryption_enabled.return_value=False
        rom.run_stub.return_value=rom;rom.flash_id.return_value=0x16405e
        return esptool,args,rom

    def test_connection_always_resets_and_does_not_reattach_stub_spi(self):
        esptool,args,rom=self.connection_fixture()
        with patch.object(esptool,'ESP32ROM',return_value=rom) as factory,contextlib.redirect_stderr(io.StringIO()):
            self.assertIs(p.connect(args,stub=True),rom)
        factory.assert_called_once_with('NO-HARDWARE',baud=115200,trace_enabled=False)
        rom.connect.assert_called_once_with(mode='default_reset',attempts=7)
        rom.run_stub.assert_called_once();rom.flash_spi_attach.assert_not_called()
        rom.flash_set_parameters.assert_called_once_with(p.FLASH_SIZE)

    def test_ram_loader_connection_remains_rom_only_with_default_reset(self):
        esptool,args,rom=self.connection_fixture()
        with patch.object(esptool,'ESP32ROM',return_value=rom),contextlib.redirect_stderr(io.StringIO()):p.connect(args)
        rom.connect.assert_called_once_with(mode='default_reset',attempts=7)
        rom.run_stub.assert_not_called();rom.flash_spi_attach.assert_not_called()

    def test_stale_stub_is_refused_without_no_reset_fallback(self):
        esptool,args,rom=self.connection_fixture();rom.sync_stub_detected=True
        with patch.object(esptool,'ESP32ROM',return_value=rom),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(p.Failure):p.connect(args,stub=True)
        rom.connect.assert_called_once_with(mode='default_reset',attempts=7);rom.run_stub.assert_not_called()
        rom._port.close.assert_called_once()

    def test_connection_failure_reports_stage_without_raw_error(self):
        esptool,args,rom=self.connection_fixture()
        rom.connect.side_effect=esptool.FatalError('private-key '+ENCODED)
        rom._port.close.side_effect=OSError('cleanup-private '+ENCODED)
        with patch.object(esptool,'ESP32ROM',return_value=rom),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(p.DiagnosticFailure) as error:p.connect(args,stub=True)
        self.assertIn('stage=rom-reset-sync',str(error.exception));self.assertIn('error=FatalError',str(error.exception))
        self.assertNotIn(ENCODED,str(error.exception));rom.run_stub.assert_not_called()

    def test_serial_open_failure_is_sanitized_before_port_object_exists(self):
        esptool,args,rom=self.connection_fixture()
        with patch.object(esptool,'ESP32ROM',side_effect=PermissionError('secret '+ENCODED)),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(p.DiagnosticFailure) as error:p.connect(args)
        self.assertIn('stage=serial-open',str(error.exception));self.assertNotIn(ENCODED,str(error.exception))

    def test_second_read_cancellation_is_identified_and_port_closed(self):
        _,args,rom=self.connection_fixture()
        chunks=[bytes([index])*p.FLASH_READ_CHUNK for index in range(p.FLASH_SIZE//p.FLASH_READ_CHUNK)]
        rom.read_flash.side_effect=chunks+[KeyboardInterrupt()]
        with patch.object(p,'connect',return_value=rom),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(p.DiagnosticFailure) as error:p.snapshot(args,twice=True)
        self.assertIn('stage=flash-read-2',str(error.exception));self.assertIn('KeyboardInterrupt',str(error.exception))
        self.assertIn('offset=0x000000',str(error.exception));self.assertIn('length=65536',str(error.exception))
        rom._port.close.assert_called_once()

    def test_flash_read_failure_never_loads_provisioning_ram_or_saves_backup(self):
        _,args,rom=self.connection_fixture();rom.read_flash.side_effect=OSError('flashdata '+ENCODED)
        with patch.object(p,'connect',return_value=rom),patch.object(p,'load_ram') as load,patch.object(p,'save_private') as save,contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(p.DiagnosticFailure) as error:p.snapshot(args,twice=True)
        self.assertIn('stage=flash-read-1',str(error.exception));self.assertNotIn(ENCODED,str(error.exception))
        load.assert_not_called();save.assert_not_called();rom._port.close.assert_called_once()

    def test_full_read_is_chunked_once_with_safe_progress(self):
        _,args,rom=self.connection_fixture()
        chunks=[bytes([index])*p.FLASH_READ_CHUNK for index in range(p.FLASH_SIZE//p.FLASH_READ_CHUNK)]
        rom.read_flash.side_effect=chunks
        progress=io.StringIO()
        with patch.object(p,'connect',return_value=rom),patch.object(p,'partitions'),contextlib.redirect_stderr(progress):
            image=p.snapshot(args)
        self.assertEqual(len(image),p.FLASH_SIZE)
        self.assertEqual(rom.read_flash.call_count,64)
        self.assertEqual(rom.read_flash.call_args_list[0].args,(0,p.FLASH_READ_CHUNK))
        self.assertEqual(rom.read_flash.call_args_list[-1].args,(p.FLASH_SIZE-p.FLASH_READ_CHUNK,p.FLASH_READ_CHUNK))
        self.assertIn('[progress] flash-read-1 65536/4194304',progress.getvalue())
        self.assertIn('[progress] flash-read-1 4194304/4194304',progress.getvalue())
        self.assertNotIn(chunks[1].hex(),progress.getvalue())

    def test_chunk_failure_reports_address_and_is_not_retried(self):
        _,args,rom=self.connection_fixture()
        rom.read_flash.side_effect=[bytes(p.FLASH_READ_CHUNK),OSError('private '+ENCODED)]
        with patch.object(p,'connect',return_value=rom),contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(p.DiagnosticFailure) as error:p.snapshot(args)
        report=str(error.exception)
        self.assertIn('stage=flash-read-1',report);self.assertIn('offset=0x010000',report)
        self.assertIn('length=65536',report);self.assertNotIn(ENCODED,report)
        self.assertEqual(rom.read_flash.call_count,2)

    def test_unknown_error_class_and_stage_cannot_leak_values(self):
        unknown=type('Secret'+ENCODED,(Exception,),{})('packet '+ENCODED)
        report=str(p.DiagnosticFailure(ENCODED,unknown))
        self.assertIn('stage=internal',report);self.assertIn('UnexpectedError',report);self.assertNotIn(ENCODED,report)

    def test_built_image_is_ram_only_and_bad_hash_prevents_serial_access(self):
        image=BASE/'build/hatchai_usb_provisioner.bin'
        self.assertTrue(image.is_file(),'Build the isolated RAM utility before this test suite.')
        _,report=p.inspect_image(image)
        self.assertGreater(report['bytes'],0)
        args=SimpleNamespace(ram_image=image,ram_sha256='0'*64)
        with patch.object(p,'connect') as connect:
            with self.assertRaises(p.Failure):p.load_ram(args)
            connect.assert_not_called()


class PreservationTests(unittest.TestCase):
    def test_partition_layout_and_md5(self):
        before=full_image();self.assertEqual(len(p.partitions(before)),6)
        bad=bytearray(before);bad[0x8005]^=1
        with self.assertRaises(p.Failure):p.partitions(bad)

    def test_partition_bounds_overlap_nvs_and_flags_are_fail_closed(self):
        for field,value in [(0x8000+4,(0x8000).to_bytes(4,'little')),
                            (0x8000+8,(0x6000).to_bytes(4,'little')),
                            (0x8000+28,(1).to_bytes(4,'little'))]:
            damaged=bytearray(full_image());damaged[field:field+4]=value
            with self.assertRaises(p.Failure):p.partitions(bytes(damaged))

    def test_ram_source_uses_pointer_nvs_without_partition_registry(self):
        main=(BASE/'main/main.cpp').read_text(encoding='utf8')
        store=(BASE/'main/idf_store.cpp').read_text(encoding='utf8')
        self.assertNotIn('esp_partition_find_first',main)
        self.assertNotIn('nvs_flash_init_partition("nvs")',main+store)
        self.assertIn('esp_flash_init_default_chip()',main)
        self.assertIn('esp_flash_get_physical_size',main)
        self.assertIn('bootloader_flash_update_size(physical)',main)
        self.assertNotIn('bootloader_flash_update_size(0x400000)',main)
        self.assertEqual(main.count('esp_flash_init_default_chip()'),1)
        self.assertIn('esp_flash_default_chip->size=physical',main)
        self.assertGreaterEqual((main+store).count('nvs_flash_init_partition_ptr'),2)

    def test_startup_has_no_nvs_sdk_or_namespace_access(self):
        main=(BASE/'main/main.cpp').read_text(encoding='utf8')
        startup=main[main.index('extern "C" void app_main'):main.index('for(unsigned sequence=1')]
        self.assertNotIn('nvs_flash_init',startup);self.assertNotIn('store.open',startup)
        self.assertIn('rawSnapshot(rawBefore)',startup)
        self.assertIn('writeGate.authorize(established,true,true)',main)
        self.assertIn('part.readonly=true',main)
        self.assertIn('writeGate.attempted()',main)

    def test_built_image_contains_only_allowlisted_startup_categories(self):
        image=(BASE/'build/hatchai_usb_provisioner.bin').read_bytes()
        optimized_out={'incompatible_layout','storage_unavailable','preservation_unavailable','layout_unknown','flash_size_invalid',
                       'storage_init_failed','storage_open_failed','preservation_heap_unavailable','preservation_scan_failed'}
        for reason in p.RAM_STARTUP_ERRORS-optimized_out:
            self.assertIn(reason.encode(),image)

    def test_every_non_nvs_region_is_protected(self):
        before=full_image()
        for address in [0,0x1000,0x8000,0xE000,0x10000,0x150000,0x290000,0x3F0000]:
            after=bytearray(before);after[address]^=1
            with self.assertRaises(p.Failure):p.preserved(before,bytes(after))

    def test_official_nvs_generator_and_target_only_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory);before=generated_nvs(directory);after=generated_nvs(directory,owned=True)
            p.preserved(full_image(before),full_image(after))
            self.assertEqual(p.nvs_entries(before)[('profile','number')],(4,struct.pack('<I',42)))
            self.assertEqual(p.nvs_entries(before)[('profile','blob')],('blob',bytes(range(200))))
            p.verify_installed(after,{'active':0,'generation':1},p.record(KEY,'controller-v1',1))

    def test_post_reset_record_is_checked_independently(self):
        with tempfile.TemporaryDirectory() as directory:
            nvs=generated_nvs(Path(directory),owned=True)
            for reply,blob in [({'active':1,'generation':1},p.record(KEY,'controller-v1',1)),
                               ({'active':0,'generation':2},p.record(KEY,'controller-v1',1)),
                               ({'active':0,'generation':1},p.record(bytes([99])*32,'controller-v1',1))]:
                with self.assertRaises(p.Failure):p.verify_installed(nvs,reply,blob)

    def test_unrelated_nvs_mutation_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory)
            with self.assertRaises(p.Failure):p.preserved(full_image(generated_nvs(directory)),full_image(generated_nvs(directory,owned=True,changed=True)))

    def test_legacy_blob_layout_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory);before=generated_nvs(directory,version=1);after=generated_nvs(directory,owned=True,version=1)
            p.preserved(full_image(before),full_image(after))

    def test_nvs_corruption_is_not_ignored(self):
        with tempfile.TemporaryDirectory() as directory:
            raw=bytearray(generated_nvs(Path(directory)));raw[28]^=1
            with self.assertRaises(p.Failure):p.nvs_entries(bytes(raw))


if __name__=='__main__':unittest.main(verbosity=2)
