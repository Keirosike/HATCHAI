"""Supervised HATCHAI USB/RAM commissioning. Default is offline plan, never a write."""
import argparse
import base64
import contextlib
import ctypes
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import struct
import sys
import time
import zlib

DEVICE = 'hatchai-inc01-controller'
PROTOCOL = b'HATCHAI-NVS-USB-v1'
PREFIX = 'HATCHAI-USB-1'
PROOF = b'HATCHAI-NVS-READBACK-v1'
BACKUP_MAGIC = b'HATCHAI-FLASH-BACKUP-v1\0'
FLASH_SIZE = 0x400000
FLASH_READ_CHUNK = 0x10000
NVS_START, NVS_END = 0x9000, 0xE000
ROOT = Path(__file__).resolve().parent
STAGE_LABELS={10:'request_received',20:'request_decrypted',21:'record_and_snapshot_valid',
 30:'nvs_init_begin',31:'nvs_init_end',32:'digest_begin',33:'digest_end',40:'write_gate_enabled',
 50:'namespace_open_begin',51:'namespace_open_end',60:'journal_begin',61:'journal_end',
 62:'disable_begin',63:'disable_end',64:'slot_begin',65:'slot_verified',66:'selector_begin',
 67:'selector_verified',68:'activation_begin',69:'activation_verified',72:'nvs_set_result',
 73:'commit_begin',74:'commit_end',75:'reopen_begin',76:'reopen_end',90:'session_stopped'}


class Failure(Exception):
    """Messages in this exception must be fixed, sanitized text only."""


STAGES = frozenset({'internal','credential-validate','serial-open','rom-reset-sync','identity-security',
    'stub-start','flash-identify','flash-parameters','read-baud','flash-read-1','flash-read-2',
    'partition-validate','nvs-validate','backup-save','ram-image-validate','ram-transfer',
    'usb-handshake','credential-inspect','credential-operation','credential-readback',
    'post-readback','preservation-verify','receipt-save'})
ERROR_TYPES = frozenset({'FatalError','UnsupportedCommandError','NotImplementedInROMError','SerialException',
    'SerialTimeoutException','TimeoutError','PermissionError','FileNotFoundError','FileExistsError',
    'ModuleNotFoundError','ImportError','OSError','ValueError','TypeError','AttributeError','MemoryError',
    'EOFError','KeyboardInterrupt'})
RAM_STARTUP_ERRORS = frozenset({'incompatible_layout','storage_unavailable','preservation_unavailable',
    'chip_incompatible','flash_init_failed','flash_size_invalid','flash_size_query_failed','flash_size_mismatch','layout_read_failed','layout_table_invalid',
    'layout_entries_invalid','layout_nvs_invalid','layout_flags_unsupported','layout_unknown',
    'storage_init_failed','storage_open_failed','preservation_heap_unavailable','preservation_scan_failed','raw_nvs_invalid',
    'authorization_validation_failed','readonly_nvs_init_refused'})


class DiagnosticFailure(Failure):
    def __init__(self, stage, error, offset=None, length=None):
        stage = stage if stage in STAGES else 'internal'
        kind = type(error).__name__
        kind = kind if kind in ERROR_TYPES else 'UnexpectedError'
        location = ''
        if (isinstance(offset, int) and isinstance(length, int) and
                0 <= offset < FLASH_SIZE and 0 < length <= FLASH_READ_CHUNK and
                offset + length <= FLASH_SIZE):
            location = f'; offset=0x{offset:06x}; length={length}'
        super().__init__(f'stage={stage}; error={kind}{location}; details suppressed. Keep loads isolated; no automatic retry was made.')


@contextlib.contextmanager
def operation(stage, offset=None, length=None, announce=True):
    stage = stage if stage in STAGES else 'internal'
    if announce:
        print(f'[stage] {stage}', file=sys.stderr, flush=True)
    try:
        yield
    except Failure:
        raise
    except (Exception, KeyboardInterrupt) as error:
        raise DiagnosticFailure(stage,error,offset,length) from None


def close_port(esp):
    # Preserve the original failure; cleanup never resets or reconnects the board.
    if esp is not None:
        try:esp._port.close()
        except Exception:pass


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2,'STOP: invalid command-line options. Use --help; never supply credentials in arguments.\n')


def need(condition, message):
    if not condition:
        raise Failure(message)


def dpapi(data, decrypt=False):
    need(os.name == 'nt', 'Windows DPAPI is required.')
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]

    raw = ctypes.create_string_buffer(data, len(data))
    source = Blob(len(data), ctypes.cast(raw, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptProtectData.restype = wintypes.BOOL
    crypt.CryptUnprotectData.argtypes = [ctypes.POINTER(Blob), ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptUnprotectData.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    try:
        if decrypt:
            ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
        else:
            ok = crypt.CryptProtectData(ctypes.byref(source), 'HATCHAI private backup', None, None, None, 1, ctypes.byref(output))
        need(ok, 'DPAPI operation failed. Use the same Windows account and computer.')
        return ctypes.string_at(output.data, output.size)
    finally:
        ctypes.memset(raw, 0, len(data))
        if output.data:
            ctypes.memset(output.data, 0, output.size)
            kernel.LocalFree(ctypes.cast(output.data, ctypes.c_void_p))


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, 'Duplicate credential JSON fields are not accepted.')
        value[key] = item
    return value


def parse_credential(text, key_id):
    try:
        value = json.loads(text, object_pairs_hook=unique_object)
        need(isinstance(value, dict) and set(value) == {DEVICE}, 'Credential controller identity mismatch.')
        keys = value[DEVICE]
        need(isinstance(keys, dict) and set(keys) == {key_id}, 'Credential key ID mismatch or unexpected entries.')
        encoded = keys[key_id]
        need(isinstance(encoded, str) and re.fullmatch(r'[A-Za-z0-9_-]{43}', encoded), 'Credential must encode exactly 32 raw bytes.')
        key = base64.urlsafe_b64decode(encoded + '=')
        need(len(key) == 32 and base64.urlsafe_b64encode(key).decode().rstrip('=') == encoded, 'Noncanonical credential encoding.')
        return key
    except Failure:
        raise
    except Exception:
        raise Failure('Protected credential JSON is invalid.') from None


def load_credential(path, key_id):
    need(path.is_file() and 0 < path.stat().st_size <= 65536, 'Protected credential file missing or oversized.')
    try:
        encoded = path.read_text(encoding='ascii').strip()
        need(re.fullmatch(r'[0-9a-fA-F]+', encoded) and encoded.lower().startswith('01000000d08c9ddf'), 'Expected a Windows DPAPI SecureString file.')
        plain = dpapi(bytes.fromhex(encoded), decrypt=True)
        need(len(plain) <= 4096, 'Protected credential JSON is oversized.')
        return parse_credential(plain.decode('utf-16-le').lstrip('\ufeff'), key_id)
    except Failure:
        raise
    except Exception:
        raise Failure('Unable to read the protected credential.') from None


def record(key, key_id, generation):
    need(isinstance(key, bytes) and len(key) == 32, 'Invalid raw key length.')
    need(re.fullmatch(r'[A-Za-z0-9_-]{1,64}', key_id), 'Invalid key ID.')
    need(isinstance(generation, int) and 0 < generation <= 0xFFFFFFFF, 'Invalid generation.')
    device, kid = DEVICE.encode(), key_id.encode()
    length = 14 + len(device) + len(kid) + 32 + 4
    need(length <= 160, 'Credential record exceeds the existing codec capacity.')
    body = struct.pack('<4s6BI', b'HNPC', 1, 0, length, len(device), len(kid), 32, generation) + device + kid + key
    return body + struct.pack('<I', zlib.crc32(body))


def partitions(data):
    need(len(data) == FLASH_SIZE, 'Full 4 MB flash snapshot required.')
    table = data[0x8000:0x8C00]
    entries, cursor = [], 0
    while cursor + 32 <= len(table) and table[cursor:cursor+2] == b'\xaa\x50':
        _, kind, subtype, start, size, label, flags = struct.unpack('<HBBII16sI', table[cursor:cursor+32])
        name = label.split(b'\0')[0].decode('ascii')
        need(start >= 0x9000 and size > 0 and start + size <= FLASH_SIZE and start % 0x1000 == 0, 'Unsafe partition boundaries.')
        entries.append((name, kind, subtype, start, size, flags));cursor += 32
    need(table[cursor:cursor+16] == b'\xeb\xeb' + b'\xff'*14 and hashlib.md5(table[:cursor]).digest() == table[cursor+16:cursor+32], 'Partition-table checksum mismatch.')
    ranges = sorted((e[3], e[3]+e[4]) for e in entries)
    need(all(a[1] <= b[0] for a, b in zip(ranges, ranges[1:])), 'Overlapping partitions.')
    expected = [('nvs',1,2,0x9000,0x5000,0), ('otadata',1,0,0xE000,0x2000,0),
                ('app0',0,0x10,0x10000,0x140000,0), ('app1',0,0x11,0x150000,0x140000,0),
                ('spiffs',1,0x82,0x290000,0x160000,0), ('coredump',1,3,0x3F0000,0x10000,0)]
    need(entries == expected, 'Installed partition layout differs from the reviewed 4 MB layout.')
    return entries


def preserved(before, after):
    need(len(before) == len(after) == FLASH_SIZE, 'Incomplete flash preservation check.')
    need(hmac.compare_digest(before[:NVS_START], after[:NVS_START]) and hmac.compare_digest(before[NVS_END:], after[NVS_END:]),
         'STOP: bytes outside NVS changed. Keep loads isolated; preserve backups for recovery.')
    need(nvs_entries(before[NVS_START:NVS_END]) == nvs_entries(after[NVS_START:NVS_END]),
         'STOP: unrelated NVS keys changed. Keep loads isolated; preserve backups for recovery.')


def nvs_entries(data, include_owned=False):
    """Strict, read-only NVS v1/v2 logical comparison. Never dump entry values."""
    need(len(data) == 0x5000, 'Unexpected NVS size.')
    namespaces, records, chunks, indexes = {}, {}, {}, {}

    def add(target, key, value):
        need(key not in target or target[key] == value, 'Ambiguous live NVS records; service is required.')
        target[key] = value

    for start in range(0,len(data),4096):
        page = data[start:start+4096]
        if page[:32] == b'\xff'*32:
            need(page == b'\xff'*4096, 'Incomplete erased NVS page; service is required.');continue
        state = int.from_bytes(page[:4],'little')
        need(state in (0xFFFFFFFE,0xFFFFFFFC) and page[8] in (0xFE,0xFF), 'Unsupported or recovering NVS page; service is required.')
        need(zlib.crc32(page[4:28],0xFFFFFFFF) == int.from_bytes(page[28:32],'little'), 'NVS page checksum failed.')
        slot = 0
        while slot < 126:
            bitmap = (page[32+slot//4] >> (2*(slot%4))) & 3
            if bitmap != 2:
                need(bitmap in (0,3), 'Invalid NVS entry bitmap.');slot += 1;continue
            raw = page[64+slot*32:96+slot*32]
            namespace, kind, span, chunk = raw[:4]
            need(1 <= span <= 126-slot, 'Invalid NVS entry span.')
            need(zlib.crc32(raw[:4]+raw[8:],0xFFFFFFFF) == int.from_bytes(raw[4:8],'little'), 'NVS entry checksum failed.')
            key_bytes = raw[8:24]
            need(b'\0' in key_bytes, 'Invalid NVS key.')
            try:key = key_bytes.split(b'\0')[0].decode('ascii')
            except Exception:raise Failure('Unsupported NVS key encoding.') from None
            need(key and all(32 <= ord(c) < 127 for c in key), 'Invalid NVS key name.')
            payload = raw[24:32]
            identity = (namespace,key)
            if kind in (1,0x11,2,0x12,4,0x14,8,0x18):
                need(span == 1, 'Invalid numeric NVS span.')
                value = payload[:kind & 15]
                if namespace == 0:
                    need(kind == 1 and value[0] not in (0,255), 'Invalid NVS namespace declaration.')
                    add(namespaces,value[0],key)
                else:add(records,identity,(kind,value))
            elif kind in (0x21,0x41,0x42):
                length = int.from_bytes(payload[:2],'little')
                need(0 <= length <= (span-1)*32 and (kind != 0x21 or length > 0), 'Invalid variable NVS length.')
                for child in range(slot+1,slot+span):
                    need((page[32+child//4] >> (2*(child%4))) & 3 == 2, 'Incomplete variable NVS entry.')
                value = page[96+slot*32:64+(slot+span)*32][:length]
                need(zlib.crc32(value,0xFFFFFFFF) == int.from_bytes(payload[4:8],'little'), 'NVS payload checksum failed.')
                if kind == 0x42:add(chunks,(namespace,key,chunk),value)
                else:add(records,identity,('blob' if kind == 0x41 else kind,value))
            elif kind == 0x48:
                need(span == 1, 'Invalid NVS blob index.')
                add(indexes,identity,(int.from_bytes(payload[:4],'little'),payload[4],payload[5]))
            else:raise Failure('Unsupported NVS entry type; service is required.')
            slot += span
    for identity,(length,count,first) in indexes.items():
        need(count <= 128 and (count > 0 or length == 0), 'Invalid NVS blob chunk count.')
        parts = [chunks.get((*identity,(first+i)&255)) for i in range(count)]
        need(all(part is not None for part in parts), 'Incomplete NVS blob chunks.')
        value = b''.join(parts)
        need(len(value) == length, 'NVS blob length mismatch.')
        add(records,identity,('blob',value))
    result = {}
    owned = {'active','enabled','generation','slot0','slot1','usb-pending'}
    for (namespace,key),value in records.items():
        need(namespace in namespaces, 'NVS key references an unknown namespace.')
        name = namespaces[namespace]
        if name == 'hatchai-pair' and key in owned and not include_owned:continue
        result[(name,key)] = value
    for name in namespaces.values():
        if name != 'hatchai-pair':result[(name,None)] = None
    return result


def verify_installed(nvs, reply, blob):
    values=nvs_entries(nvs,include_owned=True)
    prefix='hatchai-pair'
    need(values.get((prefix,'enabled')) == (1,b'\x01') and
         values.get((prefix,'active')) == (1,bytes([reply['active']])) and
         values.get((prefix,'generation')) == (4,struct.pack('<I',reply['generation'])) and
         (prefix,'usb-pending') not in values, 'Post-reset NVS metadata did not match verified activation.')
    slot=values.get((prefix,'slot0' if reply['active']==0 else 'slot1'))
    need(slot is not None and slot[0]=='blob' and hmac.compare_digest(slot[1],blob), 'Post-reset credential bytes did not match.')


def aad(challenge, sequence):
    return PROTOCOL + challenge + sequence.to_bytes(8, 'big')


def iv(sequence, response=False):
    return (b'D2H!' if response else b'H2D!') + sequence.to_bytes(8, 'big')


def derive(private, device_public, host_public, challenge, mac):
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    need(len(device_public) == 65 and device_public[0] == 4 and len(challenge) == 32, 'Invalid USB session parameters.')
    peer = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), device_public)
    shared = private.exchange(ec.ECDH(), peer)
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=challenge,
                info=PROTOCOL+bytes.fromhex(mac)+device_public+host_public).derive(shared)


class Session:
    def __init__(self, port, mac):
        from cryptography.hazmat.primitives.asymmetric import ec
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        self.port, self.sequence = port, 0
        line = self.line(20).split()
        need(len(line) == 4 and line[0] == PREFIX and line[1] == mac, 'RAM utility identity/handshake mismatch.')
        self.challenge = base64.b64decode(line[2], validate=True)
        device_public = base64.b64decode(line[3], validate=True)
        private = ec.generate_private_key(ec.SECP256R1())
        self.public = private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.cipher = AESGCM(derive(private, device_public, self.public, self.challenge, mac))

    def line(self, seconds):
        deadline, value = time.monotonic()+seconds, bytearray()
        while time.monotonic() < deadline:
            byte = self.port.read(1)
            if not byte:continue
            if byte == b'\n':
                text = value.decode('ascii', errors='ignore').strip();value.clear()
                if text.startswith('HATCHAI-STAGE-1 '):
                    self.stage_event(text)
                    continue
                if re.fullmatch(r'HATCHAI-FLASH-DIAG rc=[0-9]{1,5} physical=[0-9]{1,10} usable=[0-9]{1,10} rom=[0-9]{1,10}',text):
                    numbers=[int(n) for n in re.findall(r'=([0-9]+)',text)]
                    if numbers[0]<=65535 and all(n<=0xffffffff for n in numbers[1:]):
                        print('[flash] '+text.split(' ',1)[1],file=sys.stderr,flush=True)
                if text.startswith('HATCHAI-USB-ERROR'):
                    fields = text.split()
                    reason = fields[1] if len(fields) == 2 and fields[1] in RAM_STARTUP_ERRORS else 'unknown_startup_error'
                    raise Failure(f'RAM utility refusal: {reason}. Stop and retain the encrypted baseline; inspect the last operation stage before choosing recovery.')
                if text.startswith(PREFIX):return text
            elif byte != b'\r':
                need(len(value) < 1023, 'Oversized serial response.');value.extend(byte)
        raise Failure('USB session timed out. Keep loads isolated and use the documented resume procedure.')

    def stage_event(self,text):
        try:
            fields=text.split()
            need(len(fields)==4 and fields[1]==str(self.sequence), 'Stale diagnostic stage.')
            count=int(fields[2]);need(1<=count<=96 and count==getattr(self,'stage_counter',0)+1,'Invalid diagnostic ordering.')
            ticket=(self.sequence<<32)|count
            encrypted=base64.b64decode(fields[3],validate=True)
            need(len(encrypted)==32,'Invalid diagnostic envelope.')
            plain=self.cipher.decrypt(b'S2H!'+ticket.to_bytes(8,'big'),encrypted,aad(self.challenge,ticket))
            need(len(plain)==16,'Invalid diagnostic payload.')
            stage,rc,elapsed,heap,stack=struct.unpack('<HHIII',plain)
            need(stage in STAGE_LABELS,'Unknown diagnostic stage.')
            self.stage_counter=count
            print(f'[ram-stage] {STAGE_LABELS[stage]} rc={rc} elapsed_ms={elapsed} heap={heap} stack={stack}',file=sys.stderr,flush=True)
            need(stage!=90,'RAM session stopped before completion. Retain the encrypted baseline; do not automatically retry.')
        except Failure:raise
        except Exception:raise Failure('Diagnostic stage authentication failed.') from None

    def request(self, op, blob=b'', resume=False, replace=False, expected=0):
        self.sequence += 1
        self.stage_counter=0
        need(self.sequence <= 3 and len(blob) <= 160, 'USB session bound exceeded.')
        message = struct.pack('<BBIH', op, int(resume) | (int(replace)<<1), expected, len(blob)) + blob
        encrypted = self.cipher.encrypt(iv(self.sequence), message, aad(self.challenge, self.sequence))
        packet = f'{PREFIX} {self.sequence} {base64.b64encode(self.public).decode()} {base64.b64encode(encrypted).decode()}\n'.encode()
        need(self.port.write(packet)==len(packet),'Incomplete USB request transmission. Retain the encrypted baseline.');self.port.flush()
        fields = self.line(30).split()
        need(len(fields) == 3 and fields[1] == str(self.sequence), 'Stale or malformed USB response.')
        try:reply = self.cipher.decrypt(iv(self.sequence, True), base64.b64decode(fields[2], validate=True), aad(self.challenge, self.sequence))
        except Exception:raise Failure('USB response authentication failed.') from None
        need(len(reply) == 105, 'Invalid bounded USB response.')
        code, active, enabled, valid, pending, generation = struct.unpack('<5BI', reply[:9])
        need(enabled <= 1 and valid <= 1 and pending <= 1, 'Invalid credential metadata response.')
        return {'code': code, 'active': active, 'enabled': bool(enabled), 'valid': bool(valid), 'pending': bool(pending),
                'generation': generation, 'unrelated': reply[9:41], 'digest': reply[41:73], 'proof': reply[73:105]}


def connect(args, stub=False):
    import esptool
    need(esptool.__version__ in ('4.11.0','4.12.0'), 'Use the documented esptool 4.11/4.12 environment.')
    with contextlib.redirect_stdout(io.StringIO()):
        esp = None
        try:
            with operation('serial-open'):
                esp = esptool.ESP32ROM(args.port, baud=115200, trace_enabled=False)
            with operation('rom-reset-sync'):
                # Always reset into a fresh ROM loader. No no-reset fallback or retry of writes.
                esp.connect(mode='default_reset', attempts=7)
                need(not esp.sync_stub_detected, 'Fresh ROM loader required. Close other tools and re-enter download mode; no no-reset fallback is allowed.')
            with operation('identity-security'):
                need(esp.CHIP_NAME == 'ESP32', 'Classic ESP32 required.')
                need(bytes(esp.read_mac()).hex() == args.expected_mac, 'Connected ESP32 MAC differs from explicit confirmation.')
                need(not esp.get_secure_boot_enabled() and not esp.get_flash_encryption_enabled(), 'Protected device requires a separately reviewed commissioning method.')
            if stub:
                with operation('stub-start'):
                    esp = esp.run_stub()
                # The default stub already initializes flash. Like esptool CLI, do not
                # send a redundant explicit SPI-attach/pin override after starting it.
                with operation('flash-identify'):
                    need(((esp.flash_id() >> 16) & 0xFF) == 22, 'Actual flash is not 4 MB.')
                with operation('flash-parameters'):
                    esp.flash_set_parameters(FLASH_SIZE)
                if args.baud != 115200:
                    with operation('read-baud'):esp.change_baud(args.baud)
            return esp
        except (Exception,KeyboardInterrupt):
            close_port(esp);raise


def read_full_flash(esp, stage):
    """Read bounded, independently digested windows without exposing their data."""
    print(f'[stage] {stage}', file=sys.stderr, flush=True)
    image = bytearray(FLASH_SIZE)
    for offset in range(0, FLASH_SIZE, FLASH_READ_CHUNK):
        length = min(FLASH_READ_CHUNK, FLASH_SIZE - offset)
        with operation(stage, offset, length, announce=False):
            chunk = esp.read_flash(offset, length)
            need(len(chunk) == length, 'Incomplete full flash backup.')
            image[offset:offset + length] = chunk
        print(f'[progress] {stage} {offset + length}/{FLASH_SIZE}', file=sys.stderr, flush=True)
    return bytes(image)


def snapshot(args, twice=False):
    esp = connect(args, stub=True)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            data = read_full_flash(esp, 'flash-read-1')
            if twice:
                second = read_full_flash(esp, 'flash-read-2')
                with operation('flash-read-2', announce=False):
                    need(hmac.compare_digest(data, second), 'Two flash reads differ. Resolve USB/power stability before any write.')
        with operation('partition-validate'):partitions(data)
        return data
    finally:close_port(esp)


def inspect_image(path, expected=None):
    import esptool
    encoded = path.read_bytes()
    checksum = hashlib.sha256(encoded).hexdigest()
    need(expected is None or checksum == expected.lower(), 'RAM image changed or hash does not match the reviewed build.')
    image = esptool.cmds.LoadFirmwareImage('esp32', str(path))
    need(image.chip_id == 0, 'RAM image is not for classic ESP32.')
    need(image.checksum == image.calculate_checksum() and image.append_digest and image.stored_digest == image.calc_digest,
         'RAM image checksum or validation hash failed.')
    intervals=[]
    for segment in image.segments:
        ranges = [(0x3FFAE000,0x40000000), (0x40080000,0x400AA000), (0x400C0000,0x400C2000), (0x50000000,0x50002000)]
        need(any(start <= segment.addr and segment.addr+len(segment.data) <= end for start,end in ranges), 'Utility contains flash-mapped or unsafe image segments.')
        intervals.append((segment.addr,segment.addr+len(segment.data)))
    intervals.sort()
    need(all(a[1] <= b[0] for a,b in zip(intervals,intervals[1:])), 'Overlapping RAM image segments.')
    need(any(0x40080000 <= start <= image.entrypoint < end <= 0x400AA000 for start,end in intervals), 'Unexpected RAM entrypoint.')
    return image, {'bytes':len(encoded),'sha256':checksum,'entrypoint':hex(image.entrypoint),
                   'segments':[{'start':hex(a),'endExclusive':hex(b),'bytes':b-a} for a,b in intervals]}


def load_ram(args):
    with operation('ram-image-validate'):image,report = inspect_image(args.ram_image,args.ram_sha256)
    print('[ram-image] verified-sha256='+report['sha256'],file=sys.stderr,flush=True)
    esp = connect(args)
    try:
        with operation('ram-transfer'), contextlib.redirect_stdout(io.StringIO()):
            # ROM memory commands only; no write_flash/erase/eFuse API is used.
            for segment in image.segments:
                size, address = len(segment.data), segment.addr
                esp.mem_begin(size, (size+esp.ESP_RAM_BLOCK-1)//esp.ESP_RAM_BLOCK, esp.ESP_RAM_BLOCK, address)
                for sequence, at in enumerate(range(0,size,esp.ESP_RAM_BLOCK)):
                    esp.mem_block(segment.data[at:at+esp.ESP_RAM_BLOCK], sequence)
            esp.mem_finish(image.entrypoint)
        esp._port.timeout = .25
        return esp
    except (Exception,KeyboardInterrupt):close_port(esp);raise


def verify_reply(reply, blob, key, challenge, before):
    need(reply['code'] in (0,1), 'Provisioning was refused or interrupted. Use inspect/resume; do not erase NVS.')
    need(reply['valid'] and reply['enabled'] and not reply['pending'] and reply['active'] <= 1, 'Credential activation/readback was not confirmed.')
    need(reply['generation'] == struct.unpack('<I',blob[10:14])[0], 'Readback generation mismatch.')
    need(hmac.compare_digest(reply['unrelated'],before), 'Unrelated NVS entries changed. Keep loads isolated.')
    need(hmac.compare_digest(reply['digest'],hashlib.sha256(blob).digest()), 'Persisted record digest mismatch.')
    need(hmac.compare_digest(reply['proof'],hmac.new(key,PROOF+challenge+blob,hashlib.sha256).digest()), 'Persisted key proof mismatch.')


def save_private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('xb') as output:output.write(dpapi(data))
    need(hmac.compare_digest(dpapi(path.read_bytes(), decrypt=True),data), 'Encrypted backup readback failed. No provisioning is permitted.')


def backup_payload(data, mac):
    need(len(data)==FLASH_SIZE and re.fullmatch('[0-9a-f]{12}',mac), 'Invalid private backup input.')
    return BACKUP_MAGIC+bytes.fromhex(mac)+data


def load_baseline(path, mac):
    need(path.is_file() and FLASH_SIZE <= path.stat().st_size <= FLASH_SIZE+65536, 'Original encrypted baseline backup is missing or invalid.')
    decoded=dpapi(path.read_bytes(),decrypt=True)
    header=BACKUP_MAGIC+bytes.fromhex(mac)
    need(decoded.startswith(header) and len(decoded)==len(header)+FLASH_SIZE, 'Baseline backup belongs to another board or format.')
    data=decoded[len(header):];partitions(data);nvs_entries(data[NVS_START:NVS_END]);return data


def execute(args, key, blob):
    need(args.loads_isolated and args.port and re.fullmatch('[0-9a-f]{12}', args.expected_mac or ''), 'Execution requires port, expected MAC and --loads-isolated.')
    need(args.ram_image.is_file(), 'Build the isolated RAM image first.')
    need(args.ram_sha256 and re.fullmatch('[0-9a-fA-F]{64}',args.ram_sha256), 'Execution requires --ram-sha256 from the reviewed RAM image.')
    need(hashlib.sha256(args.ram_image.read_bytes()).hexdigest() == args.ram_sha256.lower(), 'RAM image hash mismatch.')
    if args.replace_existing:
        need(args.expected_generation is not None and args.generation == args.expected_generation+1, 'Replacement requires the expected old generation and exactly the next generation.')
    else:need(args.expected_generation is None, 'Expected generation is only used for explicitly approved replacement.')
    need(not args.resume or args.baseline_backup is not None, 'Resume requires --baseline-backup from the original interrupted attempt.')
    baseline=load_baseline(args.baseline_backup,args.expected_mac) if args.baseline_backup else None
    print('Controller will stop. Keep all heater/motor loads isolated and BOOT held for this session.')
    need(input(f'Type STOPPED {args.expected_mac} to continue: ').strip() == f'STOPPED {args.expected_mac}', 'Physical confirmation declined.')
    print('Reading full flash twice and preparing an encrypted backup; this can take several minutes.')
    before = snapshot(args, twice=True)
    with operation('nvs-validate'):nvs_entries(before[NVS_START:NVS_END])
    if baseline is not None:preserved(baseline,before)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    folder = Path(os.environ['LOCALAPPDATA'])/'HATCHAI-Provisioning'/'backups'
    backup = folder/f'{args.expected_mac}-{stamp}.before.flash.dpapi'
    with operation('backup-save'):save_private(backup, backup_payload(before,args.expected_mac))
    print('Encrypted pre-write backup: '+str(backup))
    esp = load_ram(args)
    try:
        with operation('usb-handshake'):session = Session(esp._port, args.expected_mac)
        with operation('credential-inspect'):info = session.request(1)
        need(info['code'] == 0, 'RAM utility could not inspect credential storage.')
        need(hmac.compare_digest(info['unrelated'],hashlib.sha256(before[NVS_START:NVS_END]).digest()), 'RAM raw NVS snapshot differs from encrypted baseline.')
        raw=nvs_entries(before[NVS_START:NVS_END],include_owned=True)
        owned={key:value for (namespace,key),value in raw.items() if namespace=='hatchai-pair' and key in {'active','enabled','generation','slot0','slot1','usb-pending'}}
        info['pending']='usb-pending' in owned
        # Metadata is taken from the independently parsed baseline, never from
        # an NVS_READWRITE open during startup. Core validates it again later.
        info['active']=owned.get('active',(1,b'\xff'))[1][0] if owned.get('active',(1,b'\xff'))[1] else 255
        info['enabled']=owned.get('enabled')==(1,b'\x01')
        info['generation']=int.from_bytes(owned.get('generation',(4,b'\x00'*4))[1],'little')
        print(json.dumps({k: info[k] for k in ('enabled','valid','pending','active','generation')}))
        if info['pending']:need(args.resume and not args.verify_existing, 'Pending transaction exists. Use --resume with the same protected file and generation.')
        elif owned or info['valid'] or info['generation'] or info['active'] != 255 or info['enabled']:
            need(args.replace_existing or args.verify_existing, 'Existing credentials detected. Replacement was not authorized.')
        label = 'VERIFY' if args.verify_existing else 'REPLACE' if args.replace_existing else 'RESUME' if args.resume else 'PROVISION'
        need(input(f'Type {label} {args.expected_mac} to authorize this NVS operation: ').strip() == f'{label} {args.expected_mac}', 'Write confirmation declined.')
        with operation('credential-operation'):
            reply = session.request(3 if args.verify_existing else 2, blob, args.resume, args.replace_existing, args.expected_generation or 0)
        with operation('credential-readback'):verify_reply(reply, blob, key, session.challenge, info['unrelated'])
    finally:close_port(esp)
    print('Credential readback verified; checking all flash bytes outside NVS.')
    after = snapshot(args)
    with operation('backup-save'):save_private(folder/f'{args.expected_mac}-{stamp}.after.flash.dpapi', backup_payload(after,args.expected_mac))
    with operation('preservation-verify'):
        preserved(before, after)
        if baseline is not None:preserved(baseline,after)
    with operation('post-readback'):verify_installed(after[NVS_START:NVS_END],reply,blob)
    receipt = {'deviceId': DEVICE, 'keyId': args.key_id, 'generation': args.generation, 'mac': args.expected_mac,
               'ramImageSha256': hashlib.sha256(args.ram_image.read_bytes()).hexdigest(),
               'outsideNvsPreserved': True, 'unrelatedNvsPreserved': True, 'readbackVerified': True, 'postResetRecordVerified': True,
               'originalBaselineCompared': baseline is not None}
    receipt_path = folder/f'{args.expected_mac}-{stamp}.receipt.json'
    with operation('receipt-save'):
        with receipt_path.open('x',encoding='utf8') as output:json.dump(receipt,output,indent=2)
    print('PASS: credential verified; unrelated NVS and all non-NVS flash preserved.')
    print('Board remains in USB/download mode. Restart the installed application only under supervision.')


def main(argv=None):
    parser = SafeParser(description=__doc__)
    parser.add_argument('--credential',type=Path,default=Path(os.environ.get('LOCALAPPDATA','.'))/'HATCHAI-Provisioning/controller-v1.dpapi')
    parser.add_argument('--key-id',default='controller-v1')
    parser.add_argument('--generation',type=int,default=1)
    parser.add_argument('--ram-image',type=Path,default=ROOT/'build/hatchai_usb_provisioner.bin')
    parser.add_argument('--ram-sha256')
    parser.add_argument('--execute',action='store_true')
    parser.add_argument('--loads-isolated',action='store_true')
    parser.add_argument('--port')
    parser.add_argument('--expected-mac')
    parser.add_argument('--baud',type=int,choices=[57600,115200,230400,460800],default=115200)
    parser.add_argument('--resume',action='store_true')
    parser.add_argument('--baseline-backup',type=Path)
    parser.add_argument('--verify-existing',action='store_true')
    parser.add_argument('--replace-existing',action='store_true')
    parser.add_argument('--expected-generation',type=int)
    args = parser.parse_args(argv)
    try:
        need(re.fullmatch(r'[A-Za-z0-9_-]{1,64}',args.key_id), 'Invalid key ID.')
        need(not args.verify_existing or not(args.resume or args.replace_existing), 'Verification cannot be combined with writes or replacement.')
        with operation('credential-validate'):
            key = load_credential(args.credential,args.key_id);blob = record(key,args.key_id,args.generation)
        if not args.execute:
            print(json.dumps({'mode':'offline_plan','deviceId':DEVICE,'keyId':args.key_id,'generation':args.generation,'recordBytes':len(blob),'hardwareAccess':False}))
            return 0
        if args.expected_mac:args.expected_mac=args.expected_mac.replace(':','').lower()
        execute(args,key,blob)
        return 0
    except Failure as error:
        print('STOP: '+str(error),file=sys.stderr);return 1
    except (Exception,KeyboardInterrupt) as error:
        # Never print exception repr/tracebacks: third-party errors can contain packet data.
        print('STOP: '+str(DiagnosticFailure('internal',error)),file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
