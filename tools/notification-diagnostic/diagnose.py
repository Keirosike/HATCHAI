"""Explicit supervised RAM diagnostic; never calls provisioning or loads credentials."""
import argparse
import contextlib
import hashlib
import io
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'notification-provisioner'))
import provision as p

def run(args):
    image=Path(__file__).resolve().parent/'build/hatchai_readonly_diagnostic.bin'
    _,report=p.inspect_image(image,args.sha256)
    print('Verified diagnostic SHA-256: '+report['sha256'])
    p.need(args.execute and args.loads_isolated,'Explicit diagnostic execution and isolated loads required.')
    p.need(input('Type DIAGNOSE b03fd35b8a88: ')=='DIAGNOSE b03fd35b8a88','Confirmation refused.')
    connection=SimpleNamespace(port=args.port,baud=57600,expected_mac='b03fd35b8a88')
    before=p.snapshot(connection,twice=True)
    p.nvs_entries(before[p.NVS_START:p.NVS_END],include_owned=True)
    # Baseline contains secrets: retain encrypted, never print or save plaintext.
    target=Path(args.backup)
    p.save_private(target,p.backup_payload(before,connection.expected_mac))
    image,_=p.inspect_image(image,args.sha256)
    esp=None;passed=False
    codes={'identity_failed','security_failed','flash_init_failed','flash_query_failed','flash_mismatch','table_failed','table_ok','nvs_failed','nvs_raw_ok','pass'}
    try:
        esp=p.connect(connection)
        with contextlib.redirect_stdout(io.StringIO()):
            for segment in image.segments:
                size=len(segment.data);block=esp.ESP_RAM_BLOCK
                esp.mem_begin(size,(size+block-1)//block,block,segment.addr)
                for sequence,at in enumerate(range(0,size,block)):esp.mem_block(segment.data[at:at+block],sequence)
            esp.mem_finish(image.entrypoint)
        esp._port.timeout=.25;deadline=time.monotonic()+30;buffer=bytearray()
        while time.monotonic()<deadline:
            value=esp._port.read(1)
            if not value:continue
            if value==b'\n':
                line=buffer.decode('ascii',errors='ignore').strip();buffer.clear()
                if line.startswith('HDIAG ') and line[6:] in codes:
                    print(line)
                    if line[6:]=='pass':passed=True;break
                    if line.endswith('_failed') or line.endswith('_mismatch'):break
                elif re.fullmatch(r'HDIAG sizes physical=[0-9]{1,10} usable=[0-9]{1,10} rom=[0-9]{1,10}',line):print(line)
            elif len(buffer)<192:buffer.extend(value)
            else:raise p.Failure('Oversized diagnostic line.')
    finally:p.close_port(esp)
    # Always compare the entire flash, including NVS, after a normal diagnostic
    # result. A transfer exception requires separate before/after recovery review.
    after=p.snapshot(connection,twice=True)
    p.need(hashlib.sha256(before).digest()==hashlib.sha256(after).digest(),'Full flash changed; stop and preserve encrypted baseline.')
    p.nvs_entries(after[p.NVS_START:p.NVS_END],include_owned=True)
    p.need(passed,'Diagnostic did not pass; full flash remained identical.')
    print('PASS: diagnostic completed and all 4 MB remained byte-for-byte identical.')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true');parser.add_argument('--loads-isolated',action='store_true')
    parser.add_argument('--port',default='COM3');parser.add_argument('--sha256',required=True)
    parser.add_argument('--backup',required=True,help='New encrypted baseline path; existing files are refused.')
    try:run(parser.parse_args())
    except p.Failure as error:print('STOP: '+str(error),file=sys.stderr);sys.exit(1)
    except (Exception,KeyboardInterrupt) as error:print('STOP: '+str(p.DiagnosticFailure('internal',error)),file=sys.stderr);sys.exit(1)
