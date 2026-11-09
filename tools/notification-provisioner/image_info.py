"""Offline RAM image verification only; never opens a serial port."""
import argparse
import json
from pathlib import Path
from provision import inspect_image
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image',type=Path,default=Path(__file__).resolve().parent/'build/hatchai_usb_provisioner.bin')
parser.add_argument('--write-manifest',action='store_true')
args=parser.parse_args()
_,report=inspect_image(args.image)
if args.write_manifest:
    args.image.with_suffix('.manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(report,indent=2))
