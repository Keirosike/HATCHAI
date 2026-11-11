"""Offline release inventory. Never opens serial ports or changes cloud state."""
import hashlib
import json
import pathlib
import struct

ROOT = pathlib.Path(__file__).resolve().parents[1]

def partitions(data):
    result = []
    for at in range(0, min(len(data), 0xC00), 32):
        magic, kind, subtype, offset, size, label, flags = struct.unpack('<HBBII16sI', data[at:at+32])
        if magic != 0x50AA:
            break
        if not size or offset + size > 0x1000000:
            raise ValueError('Invalid partition bounds')
        if any(offset < old['offset'] + old['size'] and old['offset'] < offset + size for old in result):
            raise ValueError('Overlapping partitions')
        result.append(dict(type=kind, subtype=subtype, offset=offset, size=size,
                           label=label.split(b'\0')[0].decode('ascii'), flags=flags))
    if not result:
        raise ValueError('No partition entries')
    return result

def inventory(root=ROOT):
    specs = [('controller', '.pio/build/esp32dev/firmware.bin', '.pio/build/esp32dev/partitions.bin', 0, 0),
             ('filesystem', '.pio/build/esp32dev/spiffs.bin', '.pio/build/esp32dev/partitions.bin', 1, 0x82),
             ('upper', 'test/.build/camera-images/upper.bin', 'test/.build/camera-sprint3/partition_table/partition-table.bin', 0, 0),
             ('lower', 'test/.build/camera-images/lower.bin', 'test/.build/camera-sprint3/partition_table/partition-table.bin', 0, 0)]
    report = []
    for board, image, table, kind, subtype in specs:
        entries = partitions((root/table).read_bytes())
        candidates = [p for p in entries if p['type'] == kind and (kind == 0 or p['subtype'] == subtype)]
        if kind == 0:
            candidates = [p for p in candidates if p['offset'] == 0x10000]
        if len(candidates) != 1:
            raise ValueError('Ambiguous partition: ' + board)
        p = candidates[0]; data = (root/image).read_bytes()
        if len(data) > p['size'] or (kind == 0 and (not data or data[0] != 0xE9)):
            raise ValueError('Image invalid or does not fit: ' + board)
        if any(p['offset'] + p['size'] > (0x400000 if board in ('controller', 'filesystem') else 0x1000000) for p in entries):
            raise ValueError('Flash capacity exceeded')
        report.append(dict(board=board, path=image, bytes=len(data), partition_bytes=p['size'],
                           offset=hex(p['offset']), remaining=p['size']-len(data), sha256=hashlib.sha256(data).hexdigest()))
    return report

if __name__ == '__main__':
    print(json.dumps({'artifacts': inventory(), 'hardware_verified': False,
                      'note': 'Hashes and fit only; source provenance and physical flash capacity require separate verification.'}, indent=2))
