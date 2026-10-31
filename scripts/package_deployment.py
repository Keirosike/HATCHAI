"""Package only current PlatformIO firmware and SPIFFS inputs; never upload."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='release/HatchAI-deployment.zip')
    args = parser.parse_args()
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to(ROOT) or output.suffix.lower() != '.zip':
        raise SystemExit('Choose a ZIP path inside this workspace.')
    if output.exists():
        raise SystemExit('Package already exists; choose a new --output path.')

    sources = [ROOT / 'platformio.ini']
    sources += sorted((ROOT / 'src').glob('*.cpp'))
    sources += sorted((ROOT / 'include').glob('*.h'))
    sources += sorted(p for p in (ROOT / 'data').rglob('*') if p.is_file())
    files = {p.relative_to(ROOT).as_posix(): p.read_bytes() for p in sources}
    files['README.md'] = (ROOT / 'docs' / 'DEPLOYMENT.md').read_bytes()
    manifest = {name: hashlib.sha256(content).hexdigest()
                for name, content in sorted(files.items())}
    files['source-manifest.json'] = (json.dumps(manifest, indent=2) + '\n').encode('utf-8')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            archive.writestr('HatchAI/' + name, content)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip():
            raise SystemExit('Package integrity check failed.')
        for name, digest in manifest.items():
            if hashlib.sha256(archive.read('HatchAI/' + name)).hexdigest() != digest:
                raise SystemExit('Package hash mismatch: ' + name)
    print(json.dumps({'archive': str(output), 'files': len(files),
                      'bytes': output.stat().st_size, 'hashesVerified': True}, indent=2))


if __name__ == '__main__':
    main()
